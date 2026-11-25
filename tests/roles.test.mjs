import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalApplication} from '../src/server/app.mjs';
import {createStorage} from '../src/server/storage.mjs';
import {ROLES, can, isRole} from '../src/shared/roles.ts';

// Rettigheder håndhæves på serveren, uanset hvad brugerfladen viser, og hver hændelse husker,
// om identiteten var bekræftet af et login.
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const origin = 'http://127.0.0.1:5188';
let app;
let directory;

afterEach(async () => {
  app?.close();
  app = null;
  if (directory) await rm(directory, {recursive: true, force: true});
  directory = null;
});

const person = (name, roles, identityVerified = true) => ({
  userId: `id-${name}`,
  displayName: name,
  email: `${name.toLowerCase()}@example.invalid`,
  roles,
  identityVerified,
});
const users = {
  ingen: person('Ingen', []),
  laeser: person('Laeser', ['reader']),
  redaktoer: person('Redaktoer', ['editor']),
  godkender: person('Godkender', ['approver']),
  admin: person('Admin', ['admin']),
};

// En simuleret loginudbyder: brugeren vælges med headeren x-test-user. Uden header er man ikke logget ind.
async function start() {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-roles-test-'));
  app = await createLocalApplication({
    dataDirectory: directory,
    auth: {
      mode: 'oidc',
      authenticate: async (request) => users[request.headers.get('x-test-user')] ?? null,
    },
  });
}

const call = (pathname, {as, method = 'GET', body} = {}) =>
  app.handle(
    new Request(origin + pathname, {
      method,
      headers: {
        ...(as ? {'x-test-user': as} : {}),
        ...(method === 'POST' ? {Origin: origin, 'Content-Type': 'application/json'} : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const upload = {
  action: 'upload',
  filename: 'rolle.md',
  content: '# Rolle\n',
  initialVersion: 1,
  title: 'Rolletest',
  meetingType: 'Type',
  department: 'Afdeling',
  owner: 'Ejer',
  purpose: 'Formål',
  changes: 'Første',
  reason: 'Årsag',
  outcome: 'Effekt',
  rationale: 'Begrundelse',
};

test('permissions are additive and the role names are validated', () => {
  assert.deepEqual([...ROLES], ['reader', 'editor', 'approver', 'admin']);
  const matrix = {
    reader: [true, false, false],
    editor: [true, true, false],
    approver: [true, false, true],
    admin: [true, true, true],
  };
  for (const [role, [read, write, decide]] of Object.entries(matrix)) {
    assert.equal(can([role], 'read'), read, `${role} read`);
    assert.equal(can([role], 'write'), write, `${role} write`);
    assert.equal(can([role], 'decide'), decide, `${role} decide`);
  }
  assert.equal(can(['editor', 'approver'], 'write') && can(['editor', 'approver'], 'decide'), true);
  assert.equal(can([], 'read'), false, 'uden roller har man ingen rettigheder');
  assert.equal(isRole('admin'), true);
  for (const value of ['Admin', 'root', '', null, 42, undefined])
    assert.equal(isRole(value), false);
});

test('without a login nothing is readable or writable', async () => {
  await start();
  for (const [pathname, method] of [
    ['/api/log', 'GET'],
    ['/api/content?id=x', 'GET'],
    ['/api/export', 'GET'],
    ['/api/log', 'POST'],
    ['/api/roboref', 'POST'],
    ['/bootstrap.js', 'GET'],
  ]) {
    const response = await call(pathname, {method, body: method === 'POST' ? upload : undefined});
    assert.equal(response.status, 401, `${method} ${pathname}`);
    assert.doesNotMatch(await response.text(), /Rolletest|prompts/);
  }
  assert.equal((await call('/api/health')).status, 200, 'sundhedstjek kræver ikke login');
});

test('a user without roles can neither read nor write', async () => {
  await start();
  for (const pathname of ['/api/log', '/api/export']) {
    assert.equal((await call(pathname, {as: 'ingen'})).status, 403, pathname);
  }
  assert.equal((await call('/api/log', {as: 'ingen', method: 'POST', body: upload})).status, 403);
});

test('a reader can read and export but cannot change anything or use the Roboref key', async () => {
  await start();
  assert.equal((await call('/api/log', {as: 'admin', method: 'POST', body: upload})).status, 201);
  assert.equal((await call('/api/log', {as: 'laeser'})).status, 200);
  assert.equal((await call('/api/export', {as: 'laeser'})).status, 200);
  const {versions} = await (await call('/api/log', {as: 'laeser'})).json();
  assert.equal((await call(`/api/content?id=${versions[0].id}`, {as: 'laeser'})).status, 200);

  const attempts = [
    upload,
    {...upload, action: 'compare', promptId: 'x'},
    {action: 'archive', promptId: 'x'},
    {action: 'restore', promptId: 'x'},
    {action: 'review_roboref', versionId: 'x'},
    {action: 'approve', versionId: versions[0].id, confirmation: 'ok'},
    {action: 'reject', versionId: versions[0].id, reason: 'nej'},
  ];
  for (const body of attempts) {
    const response = await call('/api/log', {as: 'laeser', method: 'POST', body});
    assert.equal(response.status, 403, body.action);
    assert.match((await response.json()).error, /rettighed/);
  }
  assert.equal(
    (await call('/api/roboref', {as: 'laeser', method: 'POST', body: {action: 'list'}})).status,
    403,
  );

  const after = await (await call('/api/log', {as: 'laeser'})).json();
  assert.equal(after.events.length, 1, 'afviste handlinger efterlod ingen spor');
});

test('an editor writes but cannot decide; an approver decides but cannot write', async () => {
  await start();
  const saved = await (
    await call('/api/log', {as: 'redaktoer', method: 'POST', body: upload})
  ).json();
  const approve = {action: 'approve', versionId: saved.versionId, confirmation: 'Gennemgået'};
  assert.equal(
    (await call('/api/log', {as: 'redaktoer', method: 'POST', body: approve})).status,
    403,
  );
  assert.equal(
    (
      await call('/api/log', {
        as: 'redaktoer',
        method: 'POST',
        body: {action: 'reject', versionId: saved.versionId, reason: 'x'},
      })
    ).status,
    403,
  );
  assert.equal(
    (await call('/api/log', {as: 'godkender', method: 'POST', body: {...upload, title: 'Anden'}}))
      .status,
    403,
  );
  assert.equal(
    (await call('/api/log', {as: 'godkender', method: 'POST', body: approve})).status,
    200,
  );
});

test('every event records the verified identity of the actor and not the other way around', async () => {
  await start();
  const saved = await (
    await call('/api/log', {as: 'redaktoer', method: 'POST', body: upload})
  ).json();
  await call('/api/log', {
    as: 'godkender',
    method: 'POST',
    body: {action: 'approve', versionId: saved.versionId, confirmation: 'ok'},
  });
  const {events} = await (await call('/api/log', {as: 'laeser'})).json();
  assert.equal(events.length, 2);
  for (const event of events) assert.equal(event.identity_verified, 1);
  assert.deepEqual(events.map((event) => event.actor_name).sort(), ['Godkender', 'Redaktoer']);
});

test('an upgraded database keeps old events as unverified and records new ones with the flag', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-roles-test-'));
  const root = path.join(directory, 'root');
  const data = path.join(directory, 'data');
  await mkdir(path.join(root, 'migrations'), {recursive: true});
  await cp(
    path.join(projectRoot, 'migrations/0000_prompt_log.sql'),
    path.join(root, 'migrations/0000_prompt_log.sql'),
  );

  // Version 1.0-databasen: kun den første migration, med en hændelse uden kolonnen identity_verified.
  let storage = await createStorage(root, data);
  storage.database
    .prepare(
      "INSERT INTO prompts (id,title,meeting_type,purpose,owner,department,created_at,created_by) VALUES ('p','T','M','P','O','D','2026-01-01','u')",
    )
    .run();
  storage.database
    .prepare(
      "INSERT INTO versions (id,prompt_id,number,filename,content,sha256,changes,reason,outcome,rationale,created_at,author_id,author_name,author_email) VALUES ('v','p',1,'a.md','x','h','c','r','o','b','2026-01-01','u','Gammel bruger','g@example.invalid')",
    )
    .run();
  storage.database
    .prepare(
      "INSERT INTO events (id,prompt_id,version_id,action,occurred_at,actor_id,actor_name,actor_email,detail) VALUES ('e','p','v','uploaded','2026-01-01','u','Gammel bruger','g@example.invalid','{}')",
    )
    .run();
  storage.close();

  // Opgradering: den nye migration kommer til, og de gamle data er stadig der.
  await writeFile(
    path.join(root, 'migrations/0001_identity_verified.sql'),
    (await import('node:fs')).readFileSync(
      path.join(projectRoot, 'migrations/0001_identity_verified.sql'),
    ),
  );
  storage = await createStorage(root, data);
  try {
    const old = storage.database
      .prepare("SELECT actor_name, identity_verified FROM events WHERE id='e'")
      .get();
    assert.equal(old.actor_name, 'Gammel bruger');
    assert.equal(
      old.identity_verified,
      0,
      'gamle hændelser tilskrives aldrig en verificeret person',
    );
  } finally {
    storage.close();
  }
});
