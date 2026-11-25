import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLocalApplication} from '../src/server/app.mjs';
import {roborefRequest} from '../src/server/roboref-api.mjs';

// Valideringen af handlinger på eksisterende versioner og Roboref-proxyens fejlbaner.
const origin = 'http://127.0.0.1:5188';
let app;
let directory;

afterEach(async () => {
  app?.close();
  app = null;
  if (directory) await rm(directory, {recursive: true, force: true});
  directory = null;
});

async function start() {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-validation-test-'));
  app = await createLocalApplication({dataDirectory: directory});
}

const post = (body) =>
  app.handle(
    new Request(`${origin}/api/log`, {
      method: 'POST',
      headers: {Origin: origin, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    }),
  );
const state = async () => (await app.handle(new Request(`${origin}/api/log`))).json();

const source = {
  system: 'Roboref',
  id: 7,
  title: 'Mødetype',
  validFrom: '2026-01-01T00:00:00Z',
  validTo: null,
  field: 'instruction',
};
const upload = (extra = {}) =>
  post({
    action: 'upload',
    filename: 'roboref.md',
    content: '# Fra Roboref\n',
    initialVersion: 1,
    title: 'Mødetype',
    meetingType: 'Type',
    department: 'Afdeling',
    owner: 'Ejer',
    purpose: 'Formål',
    changes: 'Import',
    reason: 'Årsag',
    outcome: 'Effekt',
    rationale: 'Begrundelse',
    source,
    ...extra,
  });

test('a Roboref review is only accepted for the meeting type the version came from', async () => {
  await start();
  const saved = await (await upload({title: 'Roboref-prompt'})).json();
  const review = {
    action: 'review_roboref',
    versionId: saved.versionId,
    sourceId: 7,
    validFrom: '2026-02-01T00:00:00Z',
    reason: 'Gennemgået',
    fields: ['instruction'],
  };

  assert.equal((await post({...review, sourceId: 8})).status, 400, 'forkert mødetype');
  assert.equal((await post({...review, sourceId: 'x'})).status, 400);
  assert.equal((await post({...review, sourceId: 0})).status, 400);
  assert.equal((await post({...review, validFrom: 'ikke en dato'})).status, 400);
  assert.equal((await post({...review, reason: ''})).status, 400);
  assert.equal((await post({...review, versionId: 'findes-ikke'})).status, 404);

  const manual = await (await post({action: 'upload', ...(await manualPayload())})).json();
  assert.equal(
    (await post({...review, versionId: manual.versionId})).status,
    400,
    'version uden Roboref-kilde',
  );

  const many = Array.from({length: 40}, (_, i) => `felt${i}`);
  const accepted = await post({...review, fields: [...many, 42, null, 'x'.repeat(100)]});
  assert.equal(accepted.status, 200);
  const event = (await state()).events.find((e) => e.action === 'roboref_reviewed');
  assert.equal(JSON.parse(event.detail).fields.length, 20, 'højst 20 felter, kun korte tekster');
  assert.equal(
    (await state()).events.filter((e) => e.action === 'roboref_reviewed').length,
    1,
    'afviste kald skrev intet',
  );
});

function manualPayload() {
  return {
    filename: 'manuel.md',
    content: '# Manuel\n',
    initialVersion: 1,
    title: 'Manuel',
    meetingType: 'Type',
    department: 'Afdeling',
    owner: 'Ejer',
    purpose: 'Formål',
    changes: 'Import',
    reason: 'Årsag',
    outcome: 'Effekt',
    rationale: 'Begrundelse',
  };
}

test('source information on an upload must be complete and well-formed', async () => {
  await start();
  const bad = [
    {...source, system: 'Anden'},
    {...source, field: 'andet'},
    {...source, id: 0},
    {...source, id: 1.5},
    {...source, title: 'x'.repeat(301)},
    {...source, validFrom: 'ikke en dato'},
    {...source, validTo: 'ikke en dato'},
    {...source, validTo: 5},
    'tekst',
    null,
  ];
  for (const value of bad) {
    assert.equal(
      (await upload({source: value, title: 'Kilde'})).status,
      400,
      JSON.stringify(value),
    );
  }
  assert.equal(
    (await upload({source: {...source, validTo: '2026-03-01T00:00:00Z'}, title: 'Gyldig'})).status,
    201,
  );
  assert.equal((await state()).prompts.length, 2, 'eksempelprompten og den gyldige');
});

test('archive and restore need an existing prompt with a version, and are recorded', async () => {
  await start();
  assert.equal((await post({action: 'archive', promptId: 'findes-ikke'})).status, 404);
  assert.equal((await post({action: 'archive'})).status, 400);
  const {prompts} = await state();
  assert.equal((await post({action: 'archive', promptId: prompts[0].id})).status, 200);
  assert.equal((await post({action: 'restore', promptId: prompts[0].id})).status, 200);
  const actions = (await state()).events.map((e) => e.action);
  assert.deepEqual(
    actions.filter((a) => a === 'archived' || a === 'restored'),
    ['restored', 'archived'],
  );
});

test('reject, approve and compare refuse unknown or inconsistent targets', async () => {
  await start();
  const {versions} = await state();
  const id = versions[0].id;
  assert.equal((await post({action: 'reject', versionId: 'findes-ikke', reason: 'x'})).status, 404);
  assert.equal((await post({action: 'reject', versionId: id})).status, 400, 'begrundelse påkrævet');
  assert.equal(
    (await post({action: 'approve', versionId: 'findes-ikke', confirmation: 'x'})).status,
    404,
  );
  assert.equal(
    (await post({action: 'approve', versionId: id})).status,
    400,
    'bekræftelse påkrævet',
  );
  assert.equal(
    (
      await post({
        action: 'approve',
        versionId: id,
        confirmation: 'ok',
        effectiveDate: '2999-01-01',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post({
        action: 'approve',
        versionId: id,
        confirmation: 'ok',
        effectiveDate: '2026-02-30',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post({
        action: 'approve',
        versionId: id,
        confirmation: 'ok',
        effectiveDate: '28-10-2026',
      })
    ).status,
    400,
  );
  assert.equal(
    (await post({action: 'compare', ...(await manualPayload())})).status,
    400,
    'ny prompt kan ikke sammenlignes',
  );
  assert.equal(
    (await post({action: 'upload', ...(await manualPayload()), promptId: 'findes-ikke'})).status,
    404,
  );

  assert.equal((await post({action: 'reject', versionId: id, reason: 'Ikke egnet'})).status, 200);
  assert.equal(
    (await post({action: 'reject', versionId: id, reason: 'Igen'})).status,
    409,
    'kan kun afvises én gang',
  );
  assert.equal(
    (await post({action: 'approve', versionId: id, confirmation: 'ok'})).status,
    409,
    'afvist kan ikke godkendes',
  );
});

// --- Roboref-proxy -------------------------------------------------------------------------

const config = {
  configured: true,
  apiKey: 'nøgle',
  baseUrl: 'https://roboref.example/api/v2',
  host: 'roboref.example',
};
const proxy = (body, remoteFetch, raw) =>
  roborefRequest(
    new Request(`${origin}/api/roboref`, {
      method: 'POST',
      headers: {origin, 'Content-Type': 'application/json'},
      body: raw ?? JSON.stringify(body),
    }),
    origin,
    config,
    remoteFetch,
  );
const ok = (data) => async () => ({ok: true, json: async () => data});

test('the Roboref proxy rejects malformed requests before contacting Roboref', async () => {
  let calls = 0;
  const remote = async () => {
    calls++;
    return {ok: true, json: async () => []};
  };
  for (const raw of ['', '{', 'null', '[]', '"x"', '42']) {
    assert.equal((await proxy(null, remote, raw)).status, 400, JSON.stringify(raw));
  }
  for (const body of [
    {},
    {action: 'slet'},
    {action: 'history'},
    {action: 'history', id: '147'},
    {action: 'history', id: -1},
    {action: 'history', id: 1.5},
    {action: 'history', id: 2 ** 60},
  ]) {
    assert.equal((await proxy(body, remote)).status, 400, JSON.stringify(body));
  }
  assert.equal((await proxy({action: 'list', padding: 'x'.repeat(10_001)}, remote)).status, 413);
  assert.equal(calls, 0);
});

test('the Roboref proxy turns every upstream problem into a safe, generic message', async () => {
  const secret = config.apiKey;
  const failures = [
    async () => ({ok: false, status: 500}),
    async () => ({ok: false, status: 403}),
    async () => {
      throw new Error(`timeout mod ${secret}`);
    },
    async () => {
      throw new DOMException('Timeout', 'TimeoutError');
    },
    ok({fejl: 'ikke en liste'}),
    ok('tekst'),
    async () => ({
      ok: true,
      json: async () => Promise.reject(new SyntaxError('Unexpected token <')),
    }),
  ];
  for (const remote of failures) {
    const response = await proxy({action: 'list'}, remote);
    assert.ok([401, 502].includes(response.status), `status ${response.status}`);
    assert.doesNotMatch(
      await response.text(),
      new RegExp(secret + '|Unexpected token|timeout mod'),
    );
  }
  assert.equal((await proxy({action: 'list'}, async () => ({ok: false, status: 401}))).status, 401);
});

test('the Roboref proxy keeps only well-formed items', async () => {
  const list = await proxy(
    {action: 'list'},
    ok([
      null,
      {id: 0},
      {id: 'x'},
      {id: 3},
      {id: 4, title: 'Fire', isDraft: 1, teams: ['A', 5, null]},
    ]),
  );
  assert.deepEqual((await list.json()).items, [
    {id: 3, title: 'Uden navn', isDraft: false, teams: []},
    {id: 4, title: 'Fire', isDraft: true, teams: ['A']},
  ]);

  const history = await proxy(
    {action: 'history', id: 3},
    ok([
      {instruction: 'gammel', validFrom: '2026-01-01T00:00:00Z'},
      {instruction: 'ny', validFrom: '2026-02-01T00:00:00Z', validTo: null},
      {instruction: 5, validFrom: '2026-03-01T00:00:00Z'},
      {instruction: 'uden dato'},
      {instruction: 'dårlig dato', validFrom: 'i går'},
      null,
    ]),
  );
  assert.deepEqual(
    (await history.json()).items.map((item) => item.instruction),
    ['ny', 'gammel'],
  );
});
