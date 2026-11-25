import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLocalApplication} from '../src/server/app.mjs';
import {parsePolicy} from '../src/server/config.mjs';

// Firøjneprincippet: den, der har uploadet en version, må ikke selv godkende den (valgfrit).
const origin = 'http://127.0.0.1:5188';
let app;
let directory;

afterEach(async () => {
  app?.close();
  app = null;
  if (directory) await rm(directory, {recursive: true, force: true});
  directory = null;
});

const person = (name, roles) => ({
  userId: `id-${name}`,
  displayName: name,
  email: `${name.toLowerCase()}@example.invalid`,
  roles,
  identityVerified: true,
});
const users = {
  begge: person('Begge', ['editor', 'approver']),
  kollega: person('Kollega', ['approver']),
};

async function start(policy) {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-foureyes-test-'));
  app = await createLocalApplication({
    dataDirectory: directory,
    policy,
    auth: {
      mode: 'oidc',
      authenticate: async (request) => users[request.headers.get('x-test-user')] ?? null,
    },
  });
}

const post = (as, body) =>
  app.handle(
    new Request(`${origin}/api/log`, {
      method: 'POST',
      headers: {'x-test-user': as, Origin: origin, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    }),
  );
const state = async () =>
  (
    await app.handle(new Request(`${origin}/api/log`, {headers: {'x-test-user': 'kollega'}}))
  ).json();

const upload = {
  action: 'upload',
  filename: 'fire.md',
  content: '# Fire øjne\n',
  initialVersion: 1,
  title: 'Firøjne',
  meetingType: 'Type',
  department: 'Afdeling',
  owner: 'Ejer',
  purpose: 'Formål',
  changes: 'Første',
  reason: 'Årsag',
  outcome: 'Effekt',
  rationale: 'Begrundelse',
};

test('with four-eyes on, the uploader cannot approve their own version, a colleague can', async () => {
  await start({fourEyes: true});
  const saved = await (await post('begge', upload)).json();
  const approve = {action: 'approve', versionId: saved.versionId, confirmation: 'Gennemgået'};

  const own = await post('begge', approve);
  assert.equal(own.status, 403);
  assert.match((await own.json()).error, /firøjne/i);
  assert.equal((await state()).events.length, 1, 'afvisningen efterlod ingen spor');
  assert.equal((await state()).prompts[0].active_version_id, null);

  assert.equal((await post('kollega', approve)).status, 200);
  assert.equal((await state()).prompts[0].active_version_id, saved.versionId);
});

test('by default the uploader may approve their own version', async () => {
  await start(undefined);
  const saved = await (await post('begge', upload)).json();
  const approve = {action: 'approve', versionId: saved.versionId, confirmation: 'Gennemgået'};
  assert.equal((await post('begge', approve)).status, 200);
});

test('four-eyes applies to approval only: the uploader may still withdraw their own draft', async () => {
  await start({fourEyes: true});
  const saved = await (await post('begge', upload)).json();
  const reject = {action: 'reject', versionId: saved.versionId, reason: 'Trækkes tilbage'};
  assert.equal((await post('begge', reject)).status, 200);
});

test('the policy setting is validated', () => {
  assert.deepEqual(parsePolicy({}), {fourEyes: false});
  assert.deepEqual(parsePolicy({ROBOREF_REQUIRE_FOUR_EYES: ''}), {fourEyes: false});
  assert.deepEqual(parsePolicy({ROBOREF_REQUIRE_FOUR_EYES: ' TRUE '}), {fourEyes: true});
  assert.deepEqual(parsePolicy({ROBOREF_REQUIRE_FOUR_EYES: 'false'}), {fourEyes: false});
  for (const value of ['yes', '1', 'ja', 'sandt']) {
    assert.throws(() => parsePolicy({ROBOREF_REQUIRE_FOUR_EYES: value}), /true eller false/);
  }
});
