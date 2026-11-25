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
  return {port, dataDirectory};
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
    identityVerified: false,
  };
}
