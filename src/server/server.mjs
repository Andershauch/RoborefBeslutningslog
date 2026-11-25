import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  loadDotEnv,
  parseRoborefConfig,
  parseServerSettings,
  parsePolicy,
  parseAuthConfig,
} from './config.mjs';
import {openInBrowser} from './open-browser.mjs';
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 24) {
  console.error(
    `Roboref Beslutningslog kræver Node.js 24 eller nyere. Du bruger version ${process.versions.node}. Hent den nyeste LTS-version på https://nodejs.org og prøv igen.`,
  );
  process.exit(1);
}
// Importeres først her, så ældre Node-versioner får ovenstående besked i stedet for en teknisk fejl.
const {API_VERSION, createLocalApplication} = await import('./app.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  loadedEnv = loadDotEnv(root),
  roboref = parseRoborefConfig();
let settings;
let policy;
let authConfig;
try {
  settings = parseServerSettings(process.env, root);
  policy = parsePolicy(process.env);
  authConfig = parseAuthConfig(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const {port, dataDirectory, host} = settings,
  origin = `http://127.0.0.1:${port}`,
  noOpen = process.argv.includes('--no-open') || authConfig.mode === 'oidc';
function openBrowser() {
  if (!noOpen) openInBrowser(origin);
}
try {
  const response = await fetch(origin + '/api/health', {signal: AbortSignal.timeout(800)}),
    health = await response.json();
  if (response.ok && health.app === 'roboref-beslutningslog') {
    if (health.apiVersion !== API_VERSION) {
      console.error(
        'En tidligere version af Roboref kører stadig. Luk det gamle startvindue, og start appen igen.',
      );
      process.exit(1);
    }
    console.log('Roboref kører allerede på ' + origin);
    openBrowser();
    process.exit(0);
  }
} catch {
  /* ingen anden udgave kører; start en ny */
}
const app = await createLocalApplication({
  root,
  port,
  dataDirectory,
  roboref,
  policy,
  authConfig,
});
const server = createServer(async (req, res) => {
  try {
    // Med login kommer trafikken via en HTTPS-proxy med den offentlige adresse som Host.
    // Sundhedstjek (/api/health) må komme fra alle værter, så proxy og overvågning virker.
    const publicHost = app.publicOrigin ? new URL(app.publicOrigin).host : null;
    const allowedHosts = publicHost ? [publicHost] : [`127.0.0.1:${port}`, `localhost:${port}`];
    const isHealthCheck = Boolean(publicHost) && req.url === '/api/health';
    if (!isHealthCheck && !allowedHosts.includes(req.headers.host)) {
      res.writeHead(403);
      res.end('Adgang afvist.');
      return;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 350000) {
          res.writeHead(413, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: 'Filen er for stor.'}));
          return;
        }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    const base = app.publicOrigin ?? `http://${req.headers.host}`;
    const request = new Request(`${base}${req.url}`, {
        method: req.method,
        headers,
        ...(body ? {body} : {}),
      }),
      response = await app.handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) res.writeHead(500, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: 'Den lokale server kunne ikke behandle forespørgslen.'}));
  }
});
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Port ${port} er optaget af et andet program. Luk det, eller sæt ROBOREF_PORT i .env.`
      : error.message,
  );
  app.close();
  process.exitCode = 1;
});
function roborefStatus() {
  if (roboref.configured) return 'Roboref: forbundet til ' + roboref.host + '.';
  return (
    'Roboref: ikke sat op' +
    (loadedEnv ? '' : ' (ingen .env fundet)') +
    '. ' +
    roboref.problems.join(' ') +
    ' Se .env.example.'
  );
}
server.listen(port, host, () => {
  const login = app.authMode === 'oidc';
  console.log(
    [
      '',
      login ? 'Roboref · Beslutningslog (login med Entra ID)' : 'Roboref · Lokal beslutningslog',
      '',
      'Åbn: ' + (app.publicOrigin ?? origin),
      'Dine registreringer gemmes automatisk i:',
      app.filename,
      '',
      roborefStatus(),
      '',
      login
        ? `Login: Entra ID. Appen lytter på ${host}:${port}; sæt en HTTPS-proxy foran.`
        : 'Appen kører kun på denne computer.',
      'Luk dette vindue, eller tryk Ctrl+C, når du vil stoppe.',
      '',
    ].join('\n'),
  );
  openBrowser();
});
function stop() {
  server.close(() => {
    app.close();
    process.exit(0);
  });
  server.closeAllConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
