// Login med OpenID Connect (testet mod Microsoft Entra ID). Appen ser aldrig en adgangskode:
// brugeren logger ind hos Entra ID, og vi får tilbage et signeret id-token med navn og roller.
//
// Flowet er "authorization code" med PKCE, state og nonce:
//   /auth/login    sender brugeren til loginsiden
//   /auth/callback modtager svaret, verificerer id-tokenet og opretter en session
//   /auth/logout   afslutter sessionen
// Sessionen er en tilfældig nøgle i en HttpOnly-cookie; databasen gemmer kun nøglens hash.
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {isRole} from '../../shared/roles.ts';

const LOGIN_ATTEMPT_MINUTES = 10;
const MAX_PENDING_LOGINS = 1000;
const REMOTE_TIMEOUT_MS = 15_000;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');

function safeEqual(a, b) {
  const left = Buffer.from(sha256(String(a)));
  const right = Buffer.from(sha256(String(b)));
  return timingSafeEqual(left, right);
}

function clean(value, max) {
  return [...String(value ?? '')]
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, max);
}

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c],
  );

function page(title, message, status, {retry = true} = {}) {
  const retryLink = retry ? '<p><a href="/auth/login">Prøv igen</a></p>' : '';
  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/app.css"></head><body><main style="max-width:34rem;margin:15vh auto;padding:0 1.5rem;font-family:system-ui,sans-serif;line-height:1.6"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${retryLink}</main></body></html>`;
  return new Response(html, {status, headers: {'Content-Type': 'text/html; charset=utf-8'}});
}

function isSecureUrl(urlText) {
  const url = new URL(urlText);
  return url.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

/**
 * @param {object} options
 * @param {ReturnType<import('../config.mjs').parseAuthConfig>} options.config
 * @param {import('node:sqlite').DatabaseSync} options.database
 * @param {typeof fetch} [options.fetchImpl] kan udskiftes i tests
 * @param {() => number} [options.now] kan udskiftes i tests (millisekunder)
 */
export async function createOidcAuth({
  config,
  database,
  fetchImpl = fetch,
  now = () => Date.now(),
}) {
  // jose indlæses først her, så den lokale app (uden login) ikke kræver npm install.
  const jose = await import('jose');
  const secureCookies = config.publicOrigin.startsWith('https:');
  const sessionCookie = `${secureCookies ? '__Host-' : ''}roboref_session`;
  const loginCookie = `${secureCookies ? '__Host-' : ''}roboref_login`;
  const redirectUri = `${config.publicOrigin}/auth/callback`;

  let discovery = null;
  async function discover() {
    if (!discovery) {
      discovery = (async () => {
        const response = await fetchImpl(`${config.issuer}/.well-known/openid-configuration`, {
          signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
          redirect: 'error',
        });
        if (!response.ok) throw new Error(`Opdagelse fejlede (HTTP ${response.status}).`);
        const doc = await response.json();
        if (String(doc.issuer ?? '').replace(/\/+$/, '') !== config.issuer) {
          throw new Error('Loginudbyderens adresse stemmer ikke overens med opsætningen.');
        }
        for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
          if (typeof doc[key] !== 'string' || !isSecureUrl(doc[key])) {
            throw new Error(`Loginudbyderens ${key} mangler eller er ikke sikker.`);
          }
        }
        if (doc.end_session_endpoint && !isSecureUrl(doc.end_session_endpoint))
          delete doc.end_session_endpoint;
        return {...doc, keys: jose.createRemoteJWKSet(new URL(doc.jwks_uri))};
      })().catch((error) => {
        discovery = null; // prøv igen ved næste login
        throw error;
      });
    }
    return discovery;
  }

  function cookie(name, value, maxAgeSeconds) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}; Max-Age=${maxAgeSeconds}`;
  }

  function cleanup() {
    const cutoff = new Date(now() - LOGIN_ATTEMPT_MINUTES * 60_000).toISOString();
    database.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(cutoff);
    database
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(new Date(now()).toISOString());
  }

  async function login() {
    cleanup();
    const pending = database.prepare('SELECT count(*) AS n FROM login_attempts').get().n;
    if (pending >= MAX_PENDING_LOGINS) {
      return page('Prøv igen om lidt', 'Der er for mange loginforsøg lige nu.', 429);
    }
    let doc;
    try {
      doc = await discover();
    } catch (error) {
      console.error('Login: kunne ikke kontakte loginudbyderen:', error.message);
      return page('Login er ikke tilgængeligt', 'Appen kan ikke kontakte loginsiden lige nu.', 502);
    }
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    database
      .prepare(
        'INSERT INTO login_attempts (state_hash, nonce, code_verifier, created_at) VALUES (?,?,?,?)',
      )
      .run(sha256(state), nonce, verifier, new Date(now()).toISOString());

    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        Location: url.toString(),
        'Set-Cookie': cookie(loginCookie, state, LOGIN_ATTEMPT_MINUTES * 60),
      },
    });
  }

  function deny(reason, title, message, status) {
    console.error('Login afvist:', reason);
    const response = page(title, message, status);
    response.headers.append('Set-Cookie', cookie(loginCookie, '', 0));
    return response;
  }

  async function callback(request, url) {
    const params = url.searchParams;
    if (params.get('error')) {
      return deny(
        `udbyder: ${clean(params.get('error'), 60)}`,
        'Login blev afbrudt',
        'Loginsiden meldte, at login ikke blev gennemført.',
        400,
      );
    }
    const state = params.get('state') ?? '';
    const code = params.get('code') ?? '';
    const boundState = parseCookies(request.headers.get('cookie')).get(loginCookie) ?? '';
    // State skal både findes i adressen og i browserens egen cookie: beskytter mod, at en anden
    // får brugerens browser til at gennemføre et login, som angriberen selv har startet.
    if (!state || !code || !boundState || !safeEqual(state, boundState)) {
      return deny(
        'state mangler eller passer ikke til browseren',
        'Login kunne ikke gennemføres',
        'Start loginet forfra.',
        400,
      );
    }
    // Engangsbrug: forsøget slettes, så det samme svar ikke kan afspilles igen.
    const attempt = database
      .prepare(
        'DELETE FROM login_attempts WHERE state_hash = ? RETURNING nonce, code_verifier, created_at',
      )
      .get(sha256(state));
    if (!attempt || now() - Date.parse(attempt.created_at) > LOGIN_ATTEMPT_MINUTES * 60_000) {
      return deny(
        'ukendt eller udløbet forsøg',
        'Login kunne ikke gennemføres',
        'Loginet er udløbet. Start forfra.',
        400,
      );
    }

    let doc;
    let tokens;
    try {
      doc = await discover();
      const response = await fetchImpl(doc.token_endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code_verifier: attempt.code_verifier,
        }),
        signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`Tokenudveksling afvist (HTTP ${response.status}).`);
      tokens = await response.json();
    } catch (error) {
      return deny(
        error.message,
        'Login kunne ikke gennemføres',
        'Appen kunne ikke gennemføre loginet hos loginsiden.',
        502,
      );
    }

    let claims;
    try {
      if (typeof tokens.id_token !== 'string') throw new Error('id_token mangler');
      ({payload: claims} = await jose.jwtVerify(tokens.id_token, doc.keys, {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ['RS256'],
        clockTolerance: 60,
        currentDate: new Date(now()),
      }));
      if (typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, attempt.nonce))
        throw new Error('nonce passer ikke');
      if (config.tenantId && String(claims.tid ?? '').toLowerCase() !== config.tenantId)
        throw new Error('forkert organisation (tid)');
    } catch (error) {
      return deny(
        `ugyldigt id-token: ${clean(error.message, 120)}`,
        'Login kunne ikke gennemføres',
        'Svaret fra loginsiden kunne ikke godkendes.',
        400,
      );
    }

    const subject = clean(claims.oid ?? claims.sub, 200);
    if (!subject)
      return deny(
        'id-token uden bruger-id',
        'Login kunne ikke gennemføres',
        'Svaret fra loginsiden mangler et bruger-id.',
        400,
      );

    if (config.requireMfa && !(Array.isArray(claims.amr) && claims.amr.includes('mfa'))) {
      return deny(
        'to-faktor ikke gennemført',
        'To-faktor-login kræves',
        'Du skal logge ind med to-faktor (fx Microsoft Authenticator) for at bruge Beslutningsloggen. Kontakt din IT-afdeling, hvis det ikke lykkes.',
        403,
      );
    }
    const roles = Array.isArray(claims.roles) ? [...new Set(claims.roles.filter(isRole))] : [];
    if (roles.length === 0) {
      return deny(
        'ingen gyldige roller',
        'Ingen adgang',
        'Din konto har ikke fået en rolle i Beslutningsloggen. Bed din administrator om at give dig adgang.',
        403,
      );
    }

    const user = {
      userId: `${config.tenantId ? 'entra' : 'oidc'}:${subject}`,
      displayName:
        clean(claims.name || claims.preferred_username || claims.email, 100) || 'Ukendt bruger',
      email: clean(claims.preferred_username || claims.email || claims.upn, 200),
      roles,
      identityVerified: true,
    };
    const token = randomToken();
    const expires = new Date(now() + config.sessionHours * 3_600_000).toISOString();
    database
      .prepare(
        'INSERT INTO sessions (token_hash, user_json, created_at, expires_at) VALUES (?,?,?,?)',
      )
      .run(sha256(token), JSON.stringify(user), new Date(now()).toISOString(), expires);

    const headers = new Headers({Location: '/'});
    headers.append('Set-Cookie', cookie(sessionCookie, token, config.sessionHours * 3600));
    headers.append('Set-Cookie', cookie(loginCookie, '', 0));
    // 303: browseren henter forsiden med GET, og svaret kan ikke afspilles som en POST.
    return new Response(null, {status: 303, headers});
  }

  async function logout(request) {
    if (request.method !== 'POST' || request.headers.get('origin') !== config.publicOrigin) {
      return new Response(JSON.stringify({error: 'Ugyldig forespørgsel.'}), {
        status: 403,
        headers: {'Content-Type': 'application/json'},
      });
    }
    const token = parseCookies(request.headers.get('cookie')).get(sessionCookie);
    if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    let redirect = '/';
    try {
      const doc = await discover();
      if (doc.end_session_endpoint) {
        const url = new URL(doc.end_session_endpoint);
        url.searchParams.set('post_logout_redirect_uri', config.publicOrigin + '/');
        redirect = url.toString();
      }
    } catch {
      /* uden adgang til loginsiden logges man stadig ud af appen */
    }
    return new Response(JSON.stringify({redirect}), {
      status: 200,
      headers: {'Content-Type': 'application/json', 'Set-Cookie': cookie(sessionCookie, '', 0)},
    });
  }

  return {
    mode: 'oidc',
    publicOrigin: config.publicOrigin,
    loginPath: '/auth/login',

    /** Finder den indloggede bruger ud fra session-cookien, eller null. */
    async authenticate(request) {
      const token = parseCookies(request.headers.get('cookie')).get(sessionCookie);
      if (!token) return null;
      const row = database
        .prepare('SELECT user_json, expires_at FROM sessions WHERE token_hash = ?')
        .get(sha256(token));
      if (!row) return null;
      if (Date.parse(row.expires_at) <= now()) {
        database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
        return null;
      }
      return JSON.parse(row.user_json);
    },

    /** Behandler /auth/*-adresserne. Returnerer null for alt andet. */
    async handleRoute(request, url) {
      if (url.pathname === '/auth/login' && request.method === 'GET') return login();
      if (url.pathname === '/auth/callback' && request.method === 'GET')
        return callback(request, url);
      if (url.pathname === '/auth/logout') return logout(request);
      return null;
    },
  };
}
