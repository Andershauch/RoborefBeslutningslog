import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SignJWT, exportJWK, generateKeyPair} from 'jose';
import {createLocalApplication} from '../src/server/app.mjs';
import {parseAuthConfig} from '../src/server/config.mjs';

// Hele login-flowet mod en simuleret Entra ID: rigtige signerede tokens, PKCE, state og nonce.
// Udbyderen kan bevidst sende forkerte, forfalskede eller utilstrækkelige tokens.
const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT_ID = 'klient-id-123';
const CLIENT_SECRET = 'hemmelighed-der-aldrig-maa-vises';
const LOCAL_ORIGIN = 'http://127.0.0.1:5188';
const HTTPS_ORIGIN = 'https://beslutningslog.example';

let provider;
let app;
let directory;

afterEach(async () => {
  app?.close();
  app = null;
  await provider?.stop();
  provider = null;
  if (directory) await rm(directory, {recursive: true, force: true});
  directory = null;
});

async function startProvider() {
  const {publicKey, privateKey} = await generateKeyPair('RS256', {extractable: true});
  const other = await generateKeyPair('RS256', {extractable: true});
  const jwk = {...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig'};
  const codes = new Map();
  const state = {
    // Hvad næste login skal indeholde, og hvordan udbyderen skal opføre sig forkert.
    claims: {},
    issuer: null,
    audience: null,
    nonce: null,
    expiresIn: '10m',
    signWithOtherKey: false,
    base: '',
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, state.base);
    const json = (body, status = 200) => {
      res.writeHead(status, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(body));
    };
    const issuer = `${state.base}/${TENANT}/v2.0`;
    if (url.pathname === `/${TENANT}/v2.0/.well-known/openid-configuration`) {
      return json({
        issuer,
        authorization_endpoint: `${state.base}/${TENANT}/oauth2/v2.0/authorize`,
        token_endpoint: `${state.base}/${TENANT}/oauth2/v2.0/token`,
        jwks_uri: `${state.base}/${TENANT}/discovery/v2.0/keys`,
        end_session_endpoint: `${state.base}/${TENANT}/oauth2/v2.0/logout`,
      });
    }
    if (url.pathname === `/${TENANT}/discovery/v2.0/keys`) return json({keys: [jwk]});
    if (url.pathname === `/${TENANT}/oauth2/v2.0/authorize`) {
      const q = url.searchParams;
      if (
        q.get('client_id') !== CLIENT_ID ||
        q.get('code_challenge_method') !== 'S256' ||
        q.get('response_type') !== 'code'
      ) {
        return json({error: 'invalid_request'}, 400);
      }
      const code = `kode-${codes.size + 1}`;
      codes.set(code, {
        nonce: q.get('nonce'),
        challenge: q.get('code_challenge'),
        redirectUri: q.get('redirect_uri'),
        claims: state.claims,
        used: false,
      });
      const back = new URL(q.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state'));
      res.writeHead(302, {Location: back.toString()});
      return res.end();
    }
    if (url.pathname === `/${TENANT}/oauth2/v2.0/token` && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        const form = new URLSearchParams(body);
        const entry = codes.get(form.get('code'));
        const verifierOk =
          entry &&
          createHash('sha256')
            .update(form.get('code_verifier') ?? '')
            .digest('base64url') === entry.challenge;
        if (
          !entry ||
          entry.used ||
          !verifierOk ||
          form.get('client_secret') !== CLIENT_SECRET ||
          form.get('client_id') !== CLIENT_ID ||
          form.get('redirect_uri') !== entry.redirectUri
        ) {
          return json({error: 'invalid_grant'}, 400);
        }
        entry.used = true;
        const token = await new SignJWT({
          nonce: state.nonce ?? entry.nonce,
          tid: TENANT,
          ...entry.claims,
        })
          .setProtectedHeader({alg: 'RS256', kid: 'k1'})
          .setIssuer(state.issuer ?? issuer)
          .setAudience(state.audience ?? CLIENT_ID)
          .setIssuedAt()
          .setExpirationTime(state.expiresIn)
          .sign(state.signWithOtherKey ? other.privateKey : privateKey);
        json({id_token: token, access_token: 'ikke-brugt', token_type: 'Bearer'});
      });
      return;
    }
    json({error: 'findes ikke'}, 404);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.base = `http://127.0.0.1:${server.address().port}`;
  return {
    state,
    issuer: `${state.base}/${TENANT}/v2.0`,
    stop: () => new Promise((resolve) => (server.listening ? server.close(resolve) : resolve())),
    closeNow: () => new Promise((resolve) => server.close(resolve)),
  };
}

const goodClaims = {
  oid: 'bruger-oid-1',
  name: 'Mette Hansen',
  preferred_username: 'mette@kommune.example',
  roles: ['editor', 'approver'],
  amr: ['pwd', 'mfa'],
};

async function start({publicOrigin = LOCAL_ORIGIN, mfa = true} = {}) {
  provider = await startProvider();
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-oidc-test-'));
  const authConfig = parseAuthConfig({
    ROBOREF_AUTH_MODE: 'oidc',
    ROBOREF_OIDC_ISSUER: provider.issuer,
    ROBOREF_OIDC_CLIENT_ID: CLIENT_ID,
    ROBOREF_OIDC_CLIENT_SECRET: CLIENT_SECRET,
    ROBOREF_PUBLIC_URL: publicOrigin,
    ROBOREF_REQUIRE_MFA: String(mfa),
  });
  app = await createLocalApplication({dataDirectory: directory, authConfig});
  return {origin: publicOrigin};
}

const setCookies = (response) => response.headers.getSetCookie();
const cookieValue = (response, name) =>
  setCookies(response)
    .map((line) => line.split(';')[0])
    .find((pair) => pair.startsWith(name + '='));

// Gennemfører login: /auth/login -> udbyderen -> /auth/callback. Returnerer alle trin.
async function signIn(claims, {origin = LOCAL_ORIGIN, cookieOverride} = {}) {
  provider.state.claims = claims;
  const login = await app.handle(new Request(`${origin}/auth/login`));
  assert.equal(login.status, 302, 'login sender brugeren videre');
  const loginName = setCookies(login)[0].split('=')[0];
  const loginCookie = cookieValue(login, loginName);
  const authorize = await fetch(login.headers.get('location'), {redirect: 'manual'});
  assert.equal(authorize.status, 302);
  const callbackUrl = new URL(authorize.headers.get('location'));
  const callback = await app.handle(
    new Request(origin + callbackUrl.pathname + callbackUrl.search, {
      headers: {cookie: cookieOverride ?? loginCookie},
    }),
  );
  return {login, loginCookie, callbackUrl, callback};
}

const authed = (origin, cookie, pathname = '/api/log', init = {}) =>
  app.handle(new Request(origin + pathname, {...init, headers: {cookie, ...(init.headers ?? {})}}));

test('a full login creates a session with the roles from the token and a hardened cookie', async () => {
  await start();
  const {callback} = await signIn(goodClaims);
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), '/');
  const raw = setCookies(callback).find((line) => line.startsWith('roboref_session='));
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /SameSite=Lax/);
  assert.match(raw, /Path=\//);
  assert.doesNotMatch(raw, /Domain=/);
  const cookie = raw.split(';')[0];

  assert.equal((await authed(LOCAL_ORIGIN, cookie)).status, 200);
  const bootstrap = await (await authed(LOCAL_ORIGIN, cookie, '/bootstrap.js')).text();
  assert.match(bootstrap, /"roles":\["editor","approver"\]/);
  assert.match(bootstrap, /"verified":true/);
  assert.match(bootstrap, /"authMode":"oidc"/);
  assert.match(bootstrap, /Mette Hansen/);
  assert.equal((await authed(LOCAL_ORIGIN, cookie, '/')).status, 200);
});

test('the session key is never stored in clear text, and the client secret is never exposed', async () => {
  await start();
  const {callback, login} = await signIn(goodClaims);
  const value = cookieValue(callback, 'roboref_session').split('=')[1];
  const hash = createHash('sha256').update(value).digest('hex');
  const database = new DatabaseSync(path.join(directory, 'beslutningslog.sqlite'), {
    readOnly: true,
  });
  try {
    const stored = database
      .prepare('SELECT token_hash FROM sessions')
      .all()
      .map((row) => row.token_hash);
    assert.deepEqual(stored, [hash]);
    assert.notEqual(stored[0], value);
  } finally {
    database.close();
  }
  for (const response of [login, callback]) {
    assert.doesNotMatch(await response.clone().text(), new RegExp(CLIENT_SECRET));
    assert.equal(response.headers.get('location')?.includes(CLIENT_SECRET) ?? false, false);
  }
});

test('unauthenticated users are sent to login, and nothing is readable without a session', async () => {
  await start();
  const home = await app.handle(new Request(`${LOCAL_ORIGIN}/`));
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/auth/login');
  for (const pathname of ['/api/log', '/api/export', '/api/content?id=x', '/bootstrap.js']) {
    assert.equal((await app.handle(new Request(LOCAL_ORIGIN + pathname))).status, 401, pathname);
  }
  assert.equal(
    (await app.handle(new Request(`${LOCAL_ORIGIN}/app.css`))).status,
    200,
    'statiske filer kræver ikke login',
  );
});

test('the login redirect uses code flow with PKCE, state and nonce, and ignores a returnTo parameter', async () => {
  await start();
  const response = await app.handle(
    new Request(`${LOCAL_ORIGIN}/auth/login?returnTo=https://evil.example`),
  );
  const url = new URL(response.headers.get('location'));
  assert.equal(url.origin + url.pathname, `${provider.state.base}/${TENANT}/oauth2/v2.0/authorize`);
  const q = url.searchParams;
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('client_id'), CLIENT_ID);
  assert.equal(q.get('redirect_uri'), `${LOCAL_ORIGIN}/auth/callback`);
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.match(q.get('scope'), /\bopenid\b/);
  for (const name of ['state', 'nonce', 'code_challenge'])
    assert.ok(q.get(name)?.length >= 20, name);
  assert.doesNotMatch(response.headers.get('location'), /evil\.example/);
  assert.match(setCookies(response)[0], /HttpOnly/);
});

test('the login cannot be completed from another browser, replayed, or started elsewhere', async () => {
  await start();
  const first = await signIn(goodClaims, {cookieOverride: 'roboref_login=en-anden-browsers-state'});
  assert.equal(first.callback.status, 400, 'state skal passe til browserens cookie');
  assert.equal(cookieValue(first.callback, 'roboref_session'), undefined);

  const none = await signIn(goodClaims, {cookieOverride: 'x=y'});
  assert.equal(none.callback.status, 400, 'uden cookie afvises svaret');

  const ok = await signIn(goodClaims);
  assert.equal(ok.callback.status, 303);
  const replay = await app.handle(
    new Request(LOCAL_ORIGIN + ok.callbackUrl.pathname + ok.callbackUrl.search, {
      headers: {cookie: ok.loginCookie},
    }),
  );
  assert.equal(replay.status, 400, 'samme svar kan ikke bruges to gange');
  assert.equal(cookieValue(replay, 'roboref_session'), undefined);
});

test('a forged, mis-addressed, expired or wrongly bound id token is rejected', async () => {
  await start();
  const attacks = {
    'forkert målgruppe (audience)': {audience: 'en-anden-app'},
    'forkert udsteder (issuer)': {issuer: 'https://login.example/andet/v2.0'},
    'udløbet token': {expiresIn: '-10m'},
    'signeret med en anden nøgle': {signWithOtherKey: true},
    'forkert nonce': {nonce: 'en-anden-nonce'},
  };
  for (const [name, change] of Object.entries(attacks)) {
    Object.assign(
      provider.state,
      {issuer: null, audience: null, nonce: null, expiresIn: '10m', signWithOtherKey: false},
      change,
    );
    const {callback} = await signIn(goodClaims);
    assert.equal(callback.status, 400, name);
    assert.equal(cookieValue(callback, 'roboref_session'), undefined, name);
    assert.doesNotMatch(
      await callback.text(),
      /eyJ|jwt|signature/i,
      `${name}: ingen tekniske detaljer`,
    );
  }
  Object.assign(provider.state, {
    issuer: null,
    audience: null,
    nonce: null,
    expiresIn: '10m',
    signWithOtherKey: false,
  });
  const wrongTenant = await signIn({...goodClaims, tid: '99999999-2222-3333-4444-555555555555'});
  assert.equal(wrongTenant.callback.status, 400, 'bruger fra en anden organisation');
  assert.equal((await signIn(goodClaims)).callback.status, 303, 'et korrekt token virker stadig');
});

test('two-factor is required by default, and can be switched off explicitly', async () => {
  await start();
  const noMfa = await signIn({...goodClaims, amr: ['pwd']});
  assert.equal(noMfa.callback.status, 403);
  assert.match(await noMfa.callback.text(), /to-faktor/i);
  assert.equal(cookieValue(noMfa.callback, 'roboref_session'), undefined);
  const missing = await signIn({...goodClaims, amr: undefined});
  assert.equal(
    missing.callback.status,
    403,
    'uden amr-oplysning antages to-faktor ikke gennemført',
  );

  app.close();
  await provider.stop();
  await rm(directory, {recursive: true, force: true});
  await start({mfa: false});
  assert.equal((await signIn({...goodClaims, amr: ['pwd']})).callback.status, 303);
});

test('users without a valid role get no access, and unknown roles are ignored', async () => {
  await start();
  for (const roles of [undefined, [], ['superuser'], ['ADMIN'], 'admin']) {
    const {callback} = await signIn({...goodClaims, roles});
    assert.equal(callback.status, 403, JSON.stringify(roles));
    assert.match(await callback.text(), /Ingen adgang/);
    assert.equal(cookieValue(callback, 'roboref_session'), undefined);
  }
  const {callback} = await signIn({...goodClaims, roles: ['reader', 'superuser', 'reader']});
  const cookie = cookieValue(callback, 'roboref_session');
  assert.match(
    await (await authed(LOCAL_ORIGIN, cookie, '/bootstrap.js')).text(),
    /"roles":\["reader"\]/,
  );
  const write = await authed(LOCAL_ORIGIN, cookie, '/api/log', {
    method: 'POST',
    headers: {Origin: LOCAL_ORIGIN, 'Content-Type': 'application/json'},
    body: JSON.stringify({action: 'upload'}),
  });
  assert.equal(write.status, 403, 'en læser kan ikke skrive');
});

test('actions are recorded as verified under the name from the token', async () => {
  await start();
  const {callback} = await signIn(goodClaims);
  const cookie = cookieValue(callback, 'roboref_session');
  const upload = await authed(LOCAL_ORIGIN, cookie, '/api/log', {
    method: 'POST',
    headers: {Origin: LOCAL_ORIGIN, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      action: 'upload',
      filename: 'a.md',
      content: '# A\n',
      initialVersion: 1,
      title: 'T',
      meetingType: 'M',
      department: 'D',
      owner: 'O',
      purpose: 'P',
      changes: 'c',
      reason: 'r',
      outcome: 'o',
      rationale: 'b',
    }),
  });
  assert.equal(upload.status, 201);
  const {events, versions} = await (await authed(LOCAL_ORIGIN, cookie)).json();
  assert.equal(events[0].identity_verified, 1);
  assert.equal(events[0].actor_name, 'Mette Hansen');
  assert.equal(events[0].actor_email, 'mette@kommune.example');
  assert.equal(events[0].actor_id, 'entra:bruger-oid-1');
  assert.equal(versions[0].author_name, 'Mette Hansen');
});

test('logout ends the session, only from the app itself, and redirects to the provider', async () => {
  await start();
  const {callback} = await signIn(goodClaims);
  const cookie = cookieValue(callback, 'roboref_session');

  const foreign = await authed(LOCAL_ORIGIN, cookie, '/auth/logout', {
    method: 'POST',
    headers: {Origin: 'http://evil.example'},
  });
  assert.equal(foreign.status, 403, 'logout kan ikke udløses fra et andet websted');
  assert.equal((await authed(LOCAL_ORIGIN, cookie)).status, 200, 'sessionen er uændret');
  const byGet = await authed(LOCAL_ORIGIN, cookie, '/auth/logout', {method: 'GET'});
  assert.equal(byGet.status, 403, 'kun POST kan logge ud');
  assert.equal((await authed(LOCAL_ORIGIN, cookie)).status, 200, 'en GET afslutter ikke sessionen');

  const out = await authed(LOCAL_ORIGIN, cookie, '/auth/logout', {
    method: 'POST',
    headers: {Origin: LOCAL_ORIGIN},
  });
  assert.equal(out.status, 200);
  const {redirect} = await out.json();
  assert.match(redirect, new RegExp(`${TENANT}/oauth2/v2.0/logout`));
  assert.match(
    decodeURIComponent(redirect),
    /post_logout_redirect_uri=http:\/\/127\.0\.0\.1:5188\//,
  );
  assert.match(setCookies(out)[0], /Max-Age=0/);
  assert.equal(
    (await authed(LOCAL_ORIGIN, cookie)).status,
    401,
    'den gamle nøgle virker ikke mere',
  );
});

test('an expired session is refused and removed', async () => {
  await start();
  const {callback} = await signIn(goodClaims);
  const cookie = cookieValue(callback, 'roboref_session');
  assert.equal((await authed(LOCAL_ORIGIN, cookie)).status, 200);
  const database = new DatabaseSync(path.join(directory, 'beslutningslog.sqlite'));
  try {
    database.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    assert.equal((await authed(LOCAL_ORIGIN, cookie)).status, 401);
    assert.equal(database.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  } finally {
    database.close();
  }
});

test('requests for another address, or writes from another origin, are refused even with a valid session', async () => {
  await start();
  const {callback} = await signIn(goodClaims);
  const cookie = cookieValue(callback, 'roboref_session');
  assert.equal((await authed('http://evil.example', cookie)).status, 403);
  assert.equal(
    (await authed('http://localhost:5188', cookie)).status,
    403,
    'kun den offentlige adresse accepteres',
  );
  const forged = await authed(LOCAL_ORIGIN, cookie, '/api/log', {
    method: 'POST',
    headers: {Origin: 'http://evil.example', 'Content-Type': 'application/json'},
    body: '{"action":"upload"}',
  });
  assert.equal(forged.status, 403);
});

test('an unreachable login provider gives a clear message and the app keeps working', async () => {
  await start();
  await provider.closeNow();
  const response = await app.handle(new Request(`${LOCAL_ORIGIN}/auth/login`));
  assert.equal(response.status, 502);
  assert.match(await response.text(), /ikke tilgængeligt/);
  assert.equal((await app.handle(new Request(`${LOCAL_ORIGIN}/api/health`))).status, 200);
});

test('over HTTPS the cookies use the __Host- prefix and the Secure flag', async () => {
  await start({publicOrigin: HTTPS_ORIGIN});
  const login = await app.handle(new Request(`${HTTPS_ORIGIN}/auth/login`));
  const loginLine = setCookies(login)[0];
  assert.match(loginLine, /^__Host-roboref_login=/);
  assert.match(loginLine, /; Secure/);
  assert.match(loginLine, /HttpOnly/);

  const {callback} = await signIn(goodClaims, {origin: HTTPS_ORIGIN});
  assert.equal(callback.status, 303);
  const sessionLine = setCookies(callback).find((line) =>
    line.startsWith('__Host-roboref_session='),
  );
  assert.match(sessionLine, /; Secure/);
  assert.match(sessionLine, /HttpOnly/);
  assert.match(sessionLine, /SameSite=Lax/);
  const cookie = sessionLine.split(';')[0];
  assert.equal((await authed(HTTPS_ORIGIN, cookie)).status, 200);
  const post = await authed(HTTPS_ORIGIN, cookie, '/api/log', {
    method: 'POST',
    headers: {Origin: HTTPS_ORIGIN, 'Content-Type': 'application/json'},
    body: '{"action":"nope"}',
  });
  assert.equal(post.status, 400, 'Origin-kontrollen bruger den offentlige adresse');
});

// --- Opsætning ---------------------------------------------------------------------------------

const valid = {
  ROBOREF_AUTH_MODE: 'oidc',
  ROBOREF_OIDC_ISSUER: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  ROBOREF_OIDC_CLIENT_ID: CLIENT_ID,
  ROBOREF_OIDC_CLIENT_SECRET: CLIENT_SECRET,
  ROBOREF_PUBLIC_URL: HTTPS_ORIGIN,
};

test('the auth configuration defaults to local and validates every setting', () => {
  assert.deepEqual(parseAuthConfig({}), {mode: 'local'});
  assert.deepEqual(parseAuthConfig({ROBOREF_AUTH_MODE: ' LOCAL '}), {mode: 'local'});
  assert.throws(() => parseAuthConfig({ROBOREF_AUTH_MODE: 'ldap'}), /local eller oidc/);

  const config = parseAuthConfig(valid);
  assert.equal(config.tenantId, TENANT);
  assert.equal(config.requireMfa, true, 'to-faktor kræves som standard');
  assert.equal(config.sessionHours, 8);
  assert.equal(config.publicOrigin, HTTPS_ORIGIN);

  assert.throws(
    () => parseAuthConfig({ROBOREF_AUTH_MODE: 'oidc'}),
    (error) =>
      ['ISSUER', 'CLIENT_ID', 'CLIENT_SECRET', 'PUBLIC_URL'].every((name) =>
        error.message.includes(name),
      ),
  );
  const bad = (change, pattern) =>
    assert.throws(() => parseAuthConfig({...valid, ...change}), pattern);
  bad({ROBOREF_OIDC_ISSUER: 'http://login.microsoftonline.com/x/v2.0'}, /https/);
  bad({ROBOREF_PUBLIC_URL: 'http://beslutningslog.example'}, /https/);
  bad({ROBOREF_PUBLIC_URL: 'https://beslutningslog.example/sti'}, /uden sti/);
  bad({ROBOREF_PUBLIC_URL: 'https://bruger:kode@beslutningslog.example'}, /brugernavn/);
  bad({ROBOREF_OIDC_CLIENT_SECRET: 'har mellemrum'}, /ugyldige tegn/);
  bad({ROBOREF_REQUIRE_MFA: 'maaske'}, /true eller false/);
  bad({ROBOREF_SESSION_HOURS: '0'}, /mellem 1 og 72/);
  bad({ROBOREF_SESSION_HOURS: '100'}, /mellem 1 og 72/);
  assert.equal(
    parseAuthConfig({...valid, ROBOREF_REQUIRE_MFA: 'false', ROBOREF_SESSION_HOURS: '12'})
      .sessionHours,
    12,
  );

  try {
    parseAuthConfig({...valid, ROBOREF_OIDC_CLIENT_SECRET: 'x y'});
  } catch (error) {
    assert.doesNotMatch(error.message, /x y/, 'hemmeligheden vises aldrig i fejlen');
  }
});
