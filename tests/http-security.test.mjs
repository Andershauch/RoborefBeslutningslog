import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalApplication} from '../src/server/app.mjs';

// Sikkerhedstests af HTTP-laget: værtsnavne, oprindelse, størrelsesgrænser, inputvalidering,
// sikkerhedsheadere og at fejl ikke afslører interne oplysninger.
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5188;
const origin = `http://127.0.0.1:${PORT}`;
let app;
let directory;

afterEach(async () => {
  app?.close();
  app = null;
  if (directory) await rm(directory, {recursive: true, force: true});
  directory = null;
});

async function start(options = {}) {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-http-test-'));
  app = await createLocalApplication({dataDirectory: path.join(directory, 'data'), ...options});
  return app;
}

const get = (url) => app.handle(new Request(url));
const postLog = (body, headers = {}) =>
  app.handle(
    new Request(`${origin}/api/log`, {
      method: 'POST',
      headers: {Origin: origin, 'Content-Type': 'application/json', ...headers},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const prompt = {
  action: 'upload',
  filename: 'test.md',
  content: '# Test\n',
  initialVersion: 1,
  title: 'Titel',
  meetingType: 'Type',
  department: 'Afdeling',
  owner: 'Ejer',
  purpose: 'Formål',
  changes: 'Ændring',
  reason: 'Årsag',
  outcome: 'Effekt',
  rationale: 'Begrundelse',
};

test('requests for other host names, ports or schemes are refused (protects against DNS rebinding)', async () => {
  await start();
  for (const url of [
    'http://evil.example:5188/',
    'http://127.0.0.1:9999/',
    'https://127.0.0.1:5188/',
    'http://127.0.0.1.evil.example:5188/',
    'http://0.0.0.0:5188/',
  ]) {
    assert.equal((await get(url)).status, 403, url);
  }
  assert.equal((await get('http://localhost:5188/')).status, 200);
  assert.equal((await get(`${origin}/`)).status, 200);
});

test('only the listed static files are served; path tricks reach nothing else', async () => {
  await start();
  for (const pathname of [
    '/../package.json',
    '/%2e%2e/package.json',
    '/..%2f..%2fpackage.json',
    '/public/client.js',
    '/src/server/config.mjs',
    '/.env',
    '/data/beslutningslog.sqlite',
    '/migrations/0000_prompt_log.sql',
  ]) {
    const response = await get(origin + pathname);
    assert.equal(response.status, 404, pathname);
    const text = await response.text();
    assert.doesNotMatch(text, /ROBOREF_API_KEY|CREATE TABLE|"name"/);
  }
});

test('methods are restricted and unknown API routes return a JSON 404', async () => {
  await start();
  assert.equal(
    (await app.handle(new Request(`${origin}/`, {method: 'POST', body: 'x'}))).status,
    405,
  );
  assert.equal(
    (await app.handle(new Request(`${origin}/app.css`, {method: 'DELETE'}))).status,
    405,
  );
  assert.equal((await app.handle(new Request(`${origin}/`, {method: 'HEAD'}))).status, 200);
  for (const [method, pathname] of [
    ['GET', '/api/unknown'],
    ['PUT', '/api/log'],
    ['DELETE', '/api/log'],
    ['POST', '/api/export'],
    ['POST', '/api/content'],
  ]) {
    const response = await app.handle(
      new Request(origin + pathname, {method, body: method === 'GET' ? undefined : '{}'}),
    );
    assert.equal(response.status, 404, `${method} ${pathname}`);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('every kind of response carries the security headers and a strict content security policy', async () => {
  await start();
  const responses = [
    await get(`${origin}/`),
    await get(`${origin}/local-client.js`),
    await get(`${origin}/app.css`),
    await get(`${origin}/bootstrap.js`),
    await get(`${origin}/api/health`),
    await get(`${origin}/api/log`),
    await get(`${origin}/api/export`),
    await get(`${origin}/api/content?id=findes-ikke`),
    await get(`${origin}/api/unknown`),
    await get(`${origin}/findes-ikke`),
    await get('http://evil.example:5188/'),
    await postLog({action: 'upload'}),
    await postLog('{}', {Origin: 'http://evil.example'}),
  ];
  for (const response of responses) {
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', response.url);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline.*script|https?:\/\//);
  }
});

test('writes require the same Origin as the app; a missing or foreign Origin is refused', async () => {
  await start();
  for (const headers of [
    {Origin: 'http://evil.example'},
    {Origin: 'http://127.0.0.1:9999'},
    {Origin: 'null'},
  ]) {
    assert.equal((await postLog(prompt, headers)).status, 403, JSON.stringify(headers));
  }
  const noOrigin = await app.handle(
    new Request(`${origin}/api/log`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(prompt),
    }),
  );
  assert.equal(noOrigin.status, 403);
  const roboref = await app.handle(
    new Request(`${origin}/api/roboref`, {
      method: 'POST',
      headers: {Origin: 'http://evil.example'},
      body: '{"action":"list"}',
    }),
  );
  assert.equal(roboref.status, 403);
  const state = await (await get(`${origin}/api/log`)).json();
  assert.equal(state.versions.length, 1, 'kun eksempelprompten findes; intet blev skrevet');
});

test('oversized requests are refused, both when announced and when not', async () => {
  await start();
  const huge = JSON.stringify({...prompt, content: 'x'.repeat(400_000)});
  const announced = await postLog(huge, {'Content-Length': String(huge.length)});
  assert.equal(announced.status, 413);
  const unannounced = await postLog(huge);
  assert.equal(unannounced.status, 413);
  const tooLargeFile = await postLog({...prompt, content: 'x'.repeat(250_000)});
  assert.equal(tooLargeFile.status, 400, 'indhold over 200 kB afvises med forklaring');
  assert.match((await tooLargeFile.json()).error, /200 kB/);
});

test('malformed input gives a clear 400 and never a server error', async () => {
  await start();
  for (const body of [
    '',
    '{',
    'not json',
    'null',
    '[]',
    '"tekst"',
    '42',
    '{"action":"slet-alt"}',
    '{"action":123}',
  ]) {
    const response = await postLog(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof (await response.json()).error, 'string');
  }
  for (const content of [null, 42, '', '   ', 'a\u0000b', 'a�b']) {
    assert.equal((await postLog({...prompt, content})).status, 400, JSON.stringify(content));
  }
  assert.equal((await postLog({...prompt, filename: 'prompt.txt'})).status, 400);
  assert.equal((await postLog({...prompt, title: 'x'.repeat(181)})).status, 400);
  assert.equal((await postLog({...prompt, initialVersion: -5})).status, 400);
  assert.equal((await postLog({...prompt, initialVersion: 1.5})).status, 400);
  assert.equal((await postLog({...prompt, initialVersion: 'abc'})).status, 400);
  assert.equal((await postLog({...prompt, initialVersion: 100000})).status, 400);
  assert.equal((await postLog({...prompt, source: {system: 'Anden', id: 1}})).status, 400);
});

test('hostile text is stored verbatim as data and cannot damage the database', async () => {
  await start();
  const hostile = "'); DROP TABLE prompts; --";
  const markup = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const response = await postLog({
    ...prompt,
    title: hostile,
    department: markup,
    filename: 'x.md',
    content: `# ${markup}\n`,
  });
  assert.equal(response.status, 201);
  const state = await (await get(`${origin}/api/log`)).json();
  const stored = state.prompts.find((p) => p.title === hostile);
  assert.ok(stored, 'titlen er gemt uændret');
  assert.equal(stored.department, markup);
  assert.equal(state.prompts.length, 2, 'alle tabeller findes stadig');
  const exported = await (await get(`${origin}/api/export`)).json();
  assert.equal(
    exported.versions.some((v) => v.content === `# ${markup}\n`),
    true,
  );
});

test('database failures give a generic message and reveal no internals', async () => {
  await start();
  app.close();
  const read = await get(`${origin}/api/log`);
  assert.equal(read.status, 503);
  const write = await postLog(prompt);
  assert.equal(write.status, 500);
  for (const response of [read, write]) {
    const text = JSON.stringify(await response.json());
    assert.doesNotMatch(text, /sqlite|SELECT|INSERT|database is not open|node:|\\|\/Users|Error:/i);
  }
  app = null;
});

test('a missing static file returns a generic JSON error without a stack trace or paths', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-http-test-'));
  const root = path.join(directory, 'root');
  await mkdir(path.join(root, 'public'), {recursive: true});
  await cp(path.join(projectRoot, 'migrations'), path.join(root, 'migrations'), {recursive: true});
  await cp(
    path.join(projectRoot, 'public/eksempel-prompt.md'),
    path.join(root, 'public/eksempel-prompt.md'),
  );
  app = await createLocalApplication({root, dataDirectory: path.join(directory, 'data')});
  const original = console.error;
  console.error = () => {};
  try {
    const response = await get(`${origin}/local-client.js`);
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.match(text, /gemte registreringer er bevaret/);
    assert.doesNotMatch(text, /ENOENT|client\.js|at .*\(|\\|\/Users/);
  } finally {
    console.error = original;
  }
});
