import {existsSync} from 'node:fs';
import path from 'node:path';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
// Synlige ASCII-tegn uden mellemrum. Forhindrer bl.a. linjeskift i HTTP-headeren.
const API_KEY_PATTERN = /^[\x21-\x7e]{1,4096}$/;

/**
 * Indlæser `.env` fra projektets rod, hvis filen findes.
 * Variabler, der allerede er sat i miljøet, overskrives ikke.
 */
export function loadDotEnv(root) {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

function normalizeBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('ROBOREF_BASE_URL er ikke en gyldig adresse.');
  }
  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('ROBOREF_BASE_URL skal starte med https://.');
  }
  if (url.username || url.password) {
    throw new Error('ROBOREF_BASE_URL må ikke indeholde brugernavn eller adgangskode.');
  }
  if (url.search || url.hash) {
    throw new Error('ROBOREF_BASE_URL må ikke indeholde ? eller #.');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * Læser og validerer Roboref-opsætningen fra miljøvariabler.
 * Returnerer aldrig nøglen i fejlbeskeder.
 *
 * @returns {{configured: true, apiKey: string, baseUrl: string, host: string}
 *   | {configured: false, problems: string[]}}
 */
export function parseRoborefConfig(env = process.env) {
  const apiKey = (env.ROBOREF_API_KEY ?? '').trim();
  const rawBaseUrl = (env.ROBOREF_BASE_URL ?? '').trim();
  const problems = [];

  if (!apiKey) problems.push('ROBOREF_API_KEY mangler.');
  else if (!API_KEY_PATTERN.test(apiKey))
    problems.push('ROBOREF_API_KEY indeholder ugyldige tegn eller er for lang.');

  let baseUrl = null;
  if (!rawBaseUrl) problems.push('ROBOREF_BASE_URL mangler.');
  else {
    try {
      baseUrl = normalizeBaseUrl(rawBaseUrl);
    } catch (error) {
      problems.push(error.message);
    }
  }

  if (problems.length) return {configured: false, problems};
  return {configured: true, apiKey, baseUrl, host: new URL(baseUrl).host};
}

export function describeMissingConfig(config) {
  return `Roboref er ikke sat op: ${config.problems.join(' ')} Udfyld filen .env (se .env.example), og start appen igen.`;
}

/**
 * Indstillinger for den lokale server. Begge kan sættes i `.env`.
 * ROBOREF_PORT: port på 127.0.0.1 (standard 5188).
 * ROBOREF_HOST: adresse at lytte på (standard 127.0.0.1; ændres kun bag en HTTPS-proxy).
 * ROBOREF_DATA_DIR: mappe til databasen (standard: data/ i projektet). Hvis en database
 * allerede findes i den ældre placering local-runtime/data, bruges den, så ingen data
 * 'forsvinder' ved opdatering af koden.
 */
export function parseServerSettings(env, root) {
  const rawPort = (env.ROBOREF_PORT ?? '').trim();
  let port = 5188;
  if (rawPort) {
    port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('ROBOREF_PORT skal være et heltal mellem 1024 og 65535.');
    }
  }
  const rawDirectory = (env.ROBOREF_DATA_DIR ?? '').trim();
  const legacyDirectory = path.join(root, 'local-runtime', 'data');
  const defaultDirectory = existsSync(path.join(legacyDirectory, 'beslutningslog.sqlite'))
    ? legacyDirectory
    : path.join(root, 'data');
  const dataDirectory = rawDirectory ? path.resolve(root, rawDirectory) : defaultDirectory;
  const host = (env.ROBOREF_HOST ?? '').trim() || '127.0.0.1';
  if (!/^[A-Za-z0-9.:[\]-]{1,255}$/.test(host)) {
    throw new Error('ROBOREF_HOST er ikke en gyldig adresse.');
  }
  return {port, dataDirectory, host};
}

/**
 * Organisatoriske regler. ROBOREF_REQUIRE_FOUR_EYES=true betyder, at den, der har uploadet en
 * version, ikke selv må godkende den. Giver kun mening med login (flere forskellige brugere).
 */
export function parsePolicy(env = process.env) {
  const raw = (env.ROBOREF_REQUIRE_FOUR_EYES ?? '').trim().toLowerCase();
  if (raw !== '' && raw !== 'true' && raw !== 'false') {
    throw new Error('ROBOREF_REQUIRE_FOUR_EYES skal være true eller false.');
  }
  return {fourEyes: raw === 'true'};
}

/**
 * Den bruger, som handlinger registreres på. Navnet sættes med ROBOREF_USER_NAME.
 * Identiteten er ikke verificeret (der er intet login); den er kun en lokal mærkat.
 */
export function parseIdentity(env = process.env) {
  const withoutControlCharacters = [...(env.ROBOREF_USER_NAME ?? '')]
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('');
  const name = withoutControlCharacters.trim().slice(0, 100);
  return {
    userId: 'local-user',
    displayName: name || 'Lokal bruger',
    email: 'lokal@denne-computer.invalid',
    // Den ene lokale bruger har alle rettigheder, fordi der ikke er noget login at skelne ud fra.
    roles: ['admin'],
    identityVerified: false,
  };
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

function parseHttpsUrl(name, raw, problems) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    problems.push(`${name} er ikke en gyldig adresse.`);
    return null;
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    problems.push(`${name} skal starte med https://.`);
    return null;
  }
  if (url.username || url.password || url.search || url.hash) {
    problems.push(`${name} må ikke indeholde brugernavn, adgangskode, ? eller #.`);
    return null;
  }
  return url;
}

function parseBoolean(name, raw, fallback, problems) {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  problems.push(`${name} skal være true eller false.`);
  return fallback;
}

/**
 * Login. ROBOREF_AUTH_MODE=local (standard): intet login, én bruger på din egen computer.
 * ROBOREF_AUTH_MODE=oidc: login med Entra ID (OpenID Connect) og roller; se docs/login-entra-id.md.
 * Returnerer aldrig hemmeligheden i fejlbeskeder.
 */
export function parseAuthConfig(env = process.env) {
  const mode = (env.ROBOREF_AUTH_MODE ?? '').trim().toLowerCase() || 'local';
  if (mode === 'local') return {mode: 'local'};
  if (mode !== 'oidc') throw new Error('ROBOREF_AUTH_MODE skal være local eller oidc.');

  const problems = [];
  const required = (name) => {
    const value = (env[name] ?? '').trim();
    if (!value) problems.push(`${name} mangler.`);
    return value;
  };

  const issuerRaw = required('ROBOREF_OIDC_ISSUER');
  const issuerUrl = issuerRaw ? parseHttpsUrl('ROBOREF_OIDC_ISSUER', issuerRaw, problems) : null;
  const clientId = required('ROBOREF_OIDC_CLIENT_ID');
  if (clientId && !/^[A-Za-z0-9._-]{1,200}$/.test(clientId)) {
    problems.push('ROBOREF_OIDC_CLIENT_ID indeholder ugyldige tegn.');
  }
  const clientSecret = required('ROBOREF_OIDC_CLIENT_SECRET');
  if (clientSecret && !/^[\x21-\x7e]{1,4096}$/.test(clientSecret)) {
    problems.push('ROBOREF_OIDC_CLIENT_SECRET indeholder ugyldige tegn eller er for lang.');
  }
  const publicRaw = required('ROBOREF_PUBLIC_URL');
  const publicUrl = publicRaw ? parseHttpsUrl('ROBOREF_PUBLIC_URL', publicRaw, problems) : null;
  if (publicUrl && publicUrl.pathname !== '/') {
    problems.push(
      'ROBOREF_PUBLIC_URL skal være en adresse uden sti, fx https://beslutningslog.kommune.dk.',
    );
  }

  const requireMfa = parseBoolean('ROBOREF_REQUIRE_MFA', env.ROBOREF_REQUIRE_MFA, true, problems);
  let sessionHours = 8;
  const hoursRaw = (env.ROBOREF_SESSION_HOURS ?? '').trim();
  if (hoursRaw) {
    sessionHours = Number(hoursRaw);
    if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 72) {
      problems.push('ROBOREF_SESSION_HOURS skal være et helt tal mellem 1 og 72.');
    }
  }

  if (problems.length)
    throw new Error(`Login (oidc) er ikke sat rigtigt op: ${problems.join(' ')}`);

  // Entra ID's adresse indeholder organisationens tenant-id; det kontrolleres i hvert login.
  const issuer = issuerUrl.origin + issuerUrl.pathname.replace(/\/+$/, '');
  const tenant = issuerUrl.pathname.match(
    /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/v2\.0\/?$/i,
  );
  return {
    mode: 'oidc',
    issuer,
    clientId,
    clientSecret,
    publicOrigin: publicUrl.origin,
    requireMfa,
    sessionHours,
    tenantId: tenant ? tenant[1].toLowerCase() : null,
  };
}
