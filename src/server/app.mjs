import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStorage} from './storage.mjs';
import {roborefRequest} from './roboref-api.mjs';
import {parseIdentity, parsePolicy, parseRoborefConfig} from './config.mjs';
import {createLogHandlers} from './handlers/log.ts';
import {createContentHandler} from './handlers/content.ts';
import {createExportHandler} from './handlers/export.ts';
import {can} from '../shared/roles.ts';

/** Øges, når API'et ændres, så en gammel kørende udgave kan opdages ved start. */
export const API_VERSION = 7;

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

const STATIC_FILES = {
  '/local-client.js': ['public/client.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['public/app.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['public/favicon.svg', 'image/svg+xml'],
  '/eksempel-prompt.md': ['public/eksempel-prompt.md', 'text/plain; charset=utf-8'],
  '/THIRD-PARTY-LICENSES.txt': ['public/THIRD-PARTY-LICENSES.txt', 'text/plain; charset=utf-8'],
};

const HOME_PAGE = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Roboref · Beslutningslog · Lokal</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css"><script src="/bootstrap.js" defer></script><script src="/local-client.js" defer></script></head><body><div id="root"><p class="local-loading">Åbner din lokale beslutningslog…</p></div></body></html>`;

const EXAMPLE_PROMPT = {
  action: 'upload',
  filename: 'eksempel-prompt v1.md',
  initialVersion: 1,
  title: 'Eksempelprompt',
  meetingType: 'Eksempel',
  department: 'Eksempel',
  owner: 'Eksempelejer',
  purpose: 'Vise hvordan en prompt registreres, versioneres og godkendes i Beslutningsloggen.',
  changes: 'Første registrering af den medfølgende eksempelprompt.',
  reason:
    'Give nye brugere noget at afprøve programmet på. Erstat eller arkivér den, når du registrerer din egen prompt.',
  outcome:
    'Et overskueligt udgangspunkt for at prøve upload, godkendelse, sammenligning og eksport.',
  rationale:
    'Eksempelpromten er neutral og er ikke en rigtig prompt. Den afventer gennemgang og godkendelse, ligesom alle andre versioner.',
};

/** Lokal tilstand: der er intet login, og den ene bruger har altid adgang. */
function createLocalAuth(identity) {
  return {mode: 'local', authenticate: async () => identity};
}

const jsonHeaders = {'Content-Type': 'application/json'};

function reply(body, status = 200, headers = {}) {
  return new Response(body, {status, headers: {...SECURITY_HEADERS, ...headers}});
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, {status: response.status, headers});
}

/**
 * Opretter den lokale applikation: lagring, API og statiske filer.
 * `handle(request)` er en ren funktion fra Request til Response, så den kan testes uden netværk.
 */
export async function createLocalApplication({
  root = DEFAULT_ROOT,
  dataDirectory = path.join(root, 'data'),
  port = 5188,
  seedExample = true,
  roboref = parseRoborefConfig(),
  roborefFetch = fetch,
  identity = parseIdentity(),
  policy = parsePolicy(),
  authConfig = {mode: 'local'},
  auth: injectedAuth,
} = {}) {
  const storage = await createStorage(root, dataDirectory);
  let auth;
  try {
    auth =
      injectedAuth ??
      (authConfig.mode === 'oidc'
        ? await (
            await import('./auth/oidc.mjs')
          ).createOidcAuth({config: authConfig, database: storage.database})
        : createLocalAuth(identity));
  } catch (error) {
    storage.close();
    throw error;
  }
  // Med login er appens adresse den offentlige (HTTPS) adresse; lokalt er den loopback.
  const origin = auth.publicOrigin ?? `http://127.0.0.1:${port}`;
  const allowedOrigins = auth.publicOrigin
    ? [auth.publicOrigin]
    : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  // Handlerne bygges pr. forespørgsel, så hver handling registreres på den bruger, der udførte den.
  function handlersFor(user) {
    const context = {db: storage.adapter, user, policy};
    return {
      log: createLogHandlers(context),
      content: createContentHandler(context),
      exportAll: createExportHandler(context),
    };
  }
  const forbidden = () =>
    reply(JSON.stringify({error: 'Du har ikke rettighed til denne handling.'}), 403, jsonHeaders);

  if (
    seedExample &&
    auth.mode === 'local' &&
    !storage.database.prepare('SELECT id FROM prompts LIMIT 1').get()
  ) {
    const payload = {
      ...EXAMPLE_PROMPT,
      content: readFileSync(path.join(root, 'public/eksempel-prompt.md'), 'utf8'),
    };
    // Eksempelprompten er en systemhandling og skal lykkes uanset den konfigurerede brugers roller.
    const response = await handlersFor({...identity, roles: ['admin']}).log.POST(
      new Request(`${origin}/api/log`, {
        method: 'POST',
        headers: {Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      }),
    );
    if (response.status !== 201) {
      storage.close();
      throw new Error(`Eksempelprompten kunne ikke importeres: ${await response.text()}`);
    }
  }

  async function handleApi(request, pathname) {
    if (pathname === '/api/health' && request.method === 'GET') {
      return reply(
        JSON.stringify({
          app: 'roboref-beslutningslog',
          mode: auth.mode,
          persistent: true,
          apiVersion: API_VERSION,
        }),
        200,
        jsonHeaders,
      );
    }
    const user = await auth.authenticate(request);
    if (!user) {
      return reply(JSON.stringify({error: 'Log ind for at fortsætte.'}), 401, jsonHeaders);
    }
    const {log, content, exportAll} = handlersFor(user);
    if (pathname === '/api/roboref') {
      // Roboref-integrationen bruger organisationens API-nøgle og kræver derfor skriverettighed.
      if (!can(user.roles, 'write')) return forbidden();
      return withSecurityHeaders(await roborefRequest(request, origin, roboref, roborefFetch));
    }
    if (pathname === '/api/log' && request.method === 'GET')
      return withSecurityHeaders(await log.GET());
    if (pathname === '/api/log' && request.method === 'POST')
      return withSecurityHeaders(await log.POST(request));
    if (pathname === '/api/content' && request.method === 'GET')
      return withSecurityHeaders(await content(request));
    if (pathname === '/api/export' && request.method === 'GET') {
      const response = await exportAll();
      if (!response.ok) return withSecurityHeaders(response);
      const data = await response.json();
      data.runtime = {
        mode: auth.mode,
        identityVerified: user.identityVerified,
        note: user.identityVerified
          ? 'Navnet er bekræftet af login.'
          : 'Navnet i denne udgave er ikke verificeret med login.',
      };
      return withSecurityHeaders(
        new Response(JSON.stringify(data, null, 2), {status: 200, headers: response.headers}),
      );
    }
    return reply(JSON.stringify({error: 'Forespørgslen findes ikke.'}), 404, jsonHeaders);
  }

  async function handleStatic(request, pathname) {
    if (pathname === '/bootstrap.js') {
      const user = await auth.authenticate(request);
      if (!user) {
        return reply('/* Ikke logget ind */', 401, {
          'Content-Type': 'text/javascript; charset=utf-8',
        });
      }
      const response = await handlersFor(user).log.GET();
      const data = response.ok ? await response.json() : null;
      // "<" skrives som <, så data aldrig kan afslutte script-elementet.
      const safe = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
      const script = `globalThis.__ROBOREF_INITIAL__=${safe(data)};globalThis.__ROBOREF_USER__=${safe({name: user.displayName, roles: user.roles, verified: user.identityVerified, authMode: auth.mode})};`;
      return reply(script, 200, {'Content-Type': 'text/javascript; charset=utf-8'});
    }
    const head = request.method === 'HEAD';
    if (pathname === '/') {
      // Med login sendes ikke-loggede brugere til loginsiden i stedet for at se en tom side.
      if (auth.loginPath && !(await auth.authenticate(request))) {
        return reply(null, 302, {Location: auth.loginPath});
      }
      return reply(head ? null : HOME_PAGE, 200, {'Content-Type': 'text/html; charset=utf-8'});
    }
    const file = STATIC_FILES[pathname];
    if (!file) return reply('Siden findes ikke.', 404);
    return reply(head ? null : readFileSync(path.join(root, file[0])), 200, {
      'Content-Type': file[1],
    });
  }

  async function handle(request) {
    try {
      const url = new URL(request.url);
      if (!allowedOrigins.includes(url.origin)) return reply('Adgang afvist.', 403);
      if (url.pathname.startsWith('/auth/') && auth.handleRoute) {
        const routed = await auth.handleRoute(request, url);
        if (routed) return withSecurityHeaders(routed);
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(request, url.pathname);
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return reply('Metoden understøttes ikke.', 405);
      return await handleStatic(request, url.pathname);
    } catch (error) {
      console.error('Lokal forespørgsel fejlede:', error.message);
      return reply(
        JSON.stringify({
          error: 'Forespørgslen kunne ikke behandles. Dine gemte registreringer er bevaret.',
        }),
        500,
        jsonHeaders,
      );
    }
  }

  return {
    handle,
    origin,
    publicOrigin: auth.publicOrigin,
    authMode: auth.mode,
    roboref,
    dataDirectory,
    filename: storage.filename,
    close: () => storage.close(),
  };
}
