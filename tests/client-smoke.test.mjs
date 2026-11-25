import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {createLocalApplication} from '../src/server/app.mjs';

// Indlæser den færdigbyggede klient (public/client.js) i en simuleret browser mod den rigtige
// applikation og kontrollerer, at siden tegnes. Fanger fx en defekt pakning af React.
const PORT = 5188;
const origin = `http://127.0.0.1:${PORT}`;
let app;
let directory;
let dom;

afterEach(async () => {
  dom?.window.close();
  dom = null;
  app?.close();
  app = null;
  if (directory) await rm(directory, {recursive: true, force: true});
  directory = null;
});

async function openApp(identity) {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-client-test-'));
  app = await createLocalApplication({
    dataDirectory: directory,
    port: PORT,
    ...(identity ? {identity} : {}),
  });
  return loadClient();
}

// Indlæser siden i en ny, simuleret browser mod den kørende applikation (og dens nuværende data).
async function loadClient() {
  dom?.window.close();
  const get = (pathname) => app.handle(new Request(origin + pathname));
  const html = await (await get('/')).text();
  const errors = [];

  dom = new JSDOM(html, {url: origin + '/', runScripts: 'outside-only', pretendToBeVisual: true});
  const {window} = dom;
  window.addEventListener('error', (event) => errors.push(event.message));
  // Klientens kald til /api/... sendes direkte til applikationen uden netværk.
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, origin);
    return app.handle(new Request(url, init));
  };
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};

  window.eval(await (await get('/bootstrap.js')).text());
  window.eval(await (await get('/local-client.js')).text());
  return {window, errors};
}

async function settle(window, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate(window.document.body.textContent)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('the built client renders the dashboard with the example prompt and no script errors', async () => {
  const {window, errors} = await openApp();
  await settle(window, (text) => text.includes('Eksempelprompt'));
  const text = window.document.body.textContent;
  assert.match(text, /Eksempelprompt/);
  assert.doesNotMatch(
    text,
    /Åbner din lokale beslutningslog/,
    'indlæsningsteksten skal være erstattet',
  );
  assert.deepEqual(errors, []);
});

test('the user name from the server is shown in the interface', async () => {
  const {window} = await openApp({
    userId: 'local-user',
    displayName: 'Mette Test',
    email: 'lokal@denne-computer.invalid',
    identityVerified: false,
  });
  await settle(window, (text) => text.includes('Mette Test'));
  assert.match(window.document.body.textContent, /Mette Test/);
});

test('hostile text from the database is shown as plain text and never becomes markup or script', async () => {
  const {errors} = await openApp();
  const markup = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  const response = await app.handle(
    new Request(`${origin}/api/log`, {
      method: 'POST',
      headers: {Origin: origin, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        action: 'upload',
        filename: 'xss.md',
        content: `# ${markup}\n`,
        initialVersion: 1,
        title: markup,
        meetingType: markup,
        department: markup,
        owner: markup,
        purpose: markup,
        changes: markup,
        reason: markup,
        outcome: markup,
        rationale: markup,
      }),
    }),
  );
  assert.equal(response.status, 201);

  // Indlæs siden igen, nu med den fjendtlige post i databasen.
  const refreshed = await loadClient();
  await settle(refreshed.window, (text) => text.includes('onerror'));
  const {document} = refreshed.window;
  assert.match(document.body.textContent, /<img src=x onerror=/, 'vises som tekst');
  assert.equal(document.querySelector('img[src="x"]'), null, 'intet img-element er oprettet');
  assert.equal(
    document.querySelector('#root script'),
    null,
    'intet script-element er oprettet i det tegnede indhold',
  );
  assert.equal(document.querySelector('#root img'), null, 'intet img-element er oprettet');
  assert.equal(refreshed.window.__xss, undefined, 'ingen kode blev kørt');
  assert.deepEqual([...errors, ...refreshed.errors], []);
});
