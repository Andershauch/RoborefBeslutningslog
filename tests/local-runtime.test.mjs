import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {snapshot} from '../src/client/roboref-fields.ts';
import {createLocalApplication} from '../src/server/app.mjs';
const origin = 'http://127.0.0.1:5188';
let app, directory;
afterEach(async () => {
  app?.close();
  app = null;
  if (directory) {
    if (
      path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith('roboref-local-test-')
    )
      throw new Error('Refusing to remove unexpected test directory');
    await rm(directory, {recursive: true, force: true});
    directory = null;
  }
});
async function start(seedExample = true) {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-local-test-'));
  app = await createLocalApplication({dataDirectory: directory, seedExample});
}
const get = (p) => app.handle(new Request(origin + p));
const post = (body) =>
  app.handle(
    new Request(origin + '/api/log', {
      method: 'POST',
      headers: {Origin: origin, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    }),
  );
test('the offline homepage serves local assets, data bootstrap and an honest local identity', async () => {
  await start();
  const home = await get('/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.ok(html.includes('/local-client.js'));
  assert.ok(html.includes('/bootstrap.js'));
  assert.ok(!/<script[^>]+src=["']https?:/.test(html));
  assert.ok(home.headers.get('Content-Security-Policy').includes("script-src 'self'"));
  const client = await get('/local-client.js');
  assert.equal(client.status, 200);
  assert.ok((await client.text()).includes('__ROBOREF_USER__'));
  assert.equal((await get('/app.css')).status, 200);
  assert.equal((await get('/THIRD-PARTY-LICENSES.txt')).status, 200);
  const health = await (await get('/api/health')).json();
  assert.equal(health.mode, 'local');
  assert.equal(health.persistent, true);
  assert.equal((await get('/../../package.json')).status, 404);
});
test('the example prompt is imported exactly once as an unapproved baseline and persists across restarts', async () => {
  await start();
  let data = await (await get('/api/log')).json();
  assert.equal(data.prompts.length, 1);
  assert.equal(data.versions[0].number, 1);
  assert.equal(data.versions[0].approved_at, null);
  assert.equal(data.prompts[0].active_version_id, null);
  assert.equal(data.prompts[0].department, 'Eksempel');
  const v = data.versions[0];
  const content = await (await get('/api/content?id=' + v.id)).json();
  const original = await readFile(new URL('../public/eksempel-prompt.md', import.meta.url));
  assert.equal(content.content, original.toString('utf8'));
  assert.equal(v.sha256, createHash('sha256').update(original).digest('hex'));
  app.close();
  app = await createLocalApplication({dataDirectory: directory});
  data = await (await get('/api/log')).json();
  assert.equal(data.versions.length, 1);
  assert.equal(data.events.length, 1);
  assert.equal(data.versions[0].id, v.id);
  assert.equal((await readdir(path.join(directory, 'backups'))).length, 1);
});
test('local changes, approval and the original prompt survive a complete restart and full export', async () => {
  await start();
  let data = await (await get('/api/log')).json();
  const p = data.prompts[0],
    first = data.versions[0];
  assert.equal(
    (
      await post({
        action: 'approve',
        versionId: first.id,
        effectiveDate: '',
        confirmation: 'Gennemgået til den lokale vurdering.',
      })
    ).status,
    200,
  );
  const body = {
    action: 'upload',
    promptId: p.id,
    filename: 'opfoelgning-v2.md',
    content: '# Lokal afprøvning\r\nNy tekst.\r\n',
    changes: 'Ændret indhold til lokal afprøvning.',
    reason: 'Afprøve versionsforløbet.',
    outcome: 'Kontrollere at historikken bevares.',
    rationale: 'Lokal funktionstest; ikke en produktionsprompt.',
  };
  const uploaded = await post(body);
  assert.equal(uploaded.status, 201);
  const second = await uploaded.json();
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Copenhagen'}).format(
    new Date(),
  );
  assert.equal(
    (
      await post({
        action: 'approve',
        versionId: second.versionId,
        effectiveDate: today,
        confirmation: 'Afprøvet i det lokale testforløb.',
      })
    ).status,
    200,
  );
  app.close();
  app = await createLocalApplication({dataDirectory: directory});
  data = await (await get('/api/export')).json();
  assert.equal(data.versions.length, 2);
  assert.equal(data.prompts[0].active_version_id, second.versionId);
  assert.equal(data.versions[1].number, 2);
  assert.equal(data.versions[1].content, body.content);
  assert.equal(data.runtime.identityVerified, false);
  assert.equal(data.events.length, 4);
});
test('the local adapter rejects foreign hosts and cross-origin writes', async () => {
  await start(false);
  assert.equal((await app.handle(new Request('http://evil.example:5188/api/log'))).status, 403);
  const r = await app.handle(
    new Request(origin + '/api/log', {
      method: 'POST',
      headers: {Origin: 'https://evil.example', 'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'upload'}),
    }),
  );
  assert.equal(r.status, 403);
  assert.equal((await (await get('/api/log')).json()).prompts.length, 0);
});
test('a Roboref instruction and its source metadata survive a restart', async () => {
  await start();
  const data = await (await get('/api/log')).json();
  const p = data.prompts[0];
  const source = {
    system: 'Roboref',
    id: 147,
    title: 'Mødetype v16',
    field: 'instruction',
    validFrom: '2026-10-26T09:07:44.454Z',
    validTo: null,
  };
  const response = await post({
    action: 'upload',
    promptId: p.id,
    filename: 'Roboref-147.md',
    content: 'Ny instruktion fra Roboref.',
    reason: 'Fagligt behov',
    outcome: 'Bedre referat',
    rationale: 'Faglig vurdering',
    source,
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  app.close();
  app = await createLocalApplication({dataDirectory: directory});
  const exported = await (await get('/api/export')).json();
  assert.deepEqual(
    JSON.parse(exported.events.find((e) => e.version_id === created.versionId).detail).source,
    source,
  );
  assert.equal(
    exported.versions.find((v) => v.id === created.versionId).content,
    'Ny instruktion fra Roboref.',
  );
  const bad = await post({
    action: 'review_roboref',
    versionId: created.versionId,
    sourceId: 148,
    validFrom: '2026-10-27T09:00:00Z',
    reason: 'Dette er ikke den rette kilde.',
  });
  assert.equal(bad.status, 400);
  const reviewed = await post({
    action: 'review_roboref',
    versionId: created.versionId,
    sourceId: 147,
    validFrom: '2026-10-27T09:00:00Z',
    fields: ['template'],
    reason: 'Skabelonen er gennemgået og kræver ingen ændring af instruktionen.',
  });
  assert.equal(reviewed.status, 200);
  app.close();
  app = await createLocalApplication({dataDirectory: directory});
  const after = await (await get('/api/export')).json();
  const event = after.events.find((e) => e.action === 'roboref_reviewed');
  assert.equal(JSON.parse(event.detail).validFrom, '2026-10-27T09:00:00Z');
  assert.deepEqual(JSON.parse(event.detail).fields, ['template']);
  assert.match(JSON.parse(event.detail).reason, /gennemgået/);
});
test('a complete Roboref snapshot survives approval, restart and export', async () => {
  await start(false);
  const history = {
    title: 'Samtale',
    instruction: 'Indhold',
    template: 'Skabelon A',
    example: null,
    technicalTerms: ['ord'],
    extraSetting: {enabled: false},
    validFrom: '2026-10-01T00:00:00Z',
    validTo: null,
    isDraft: false,
  };
  const content = snapshot(history),
    source = {
      system: 'Roboref',
      id: 147,
      title: history.title,
      field: 'meetingType',
      validFrom: history.validFrom,
      validTo: null,
    };
  const response = await post({
    action: 'upload',
    filename: 'Roboref-147.md',
    content,
    title: 'Samtale',
    meetingType: 'Samtale',
    department: 'Test',
    owner: 'Lokal',
    initialVersion: 1,
    purpose: 'Afprøvning',
    changes: 'Første version',
    reason: 'Afprøvning',
    outcome: 'Overblik',
    rationale: 'Faglig gennemgang',
    source,
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(
    (
      await post({
        action: 'approve',
        versionId: created.versionId,
        effectiveDate: '',
        confirmation: 'Alle felter er gennemgået.',
      })
    ).status,
    200,
  );
  app.close();
  app = await createLocalApplication({dataDirectory: directory, seedExample: false});
  const data = await (await get('/api/export')).json();
  assert.equal(data.versions[0].content, content);
  assert.match(content, /Skabelon A/);
  assert.match(content, /"extraSetting"/);
  assert.match(content, /"example": null/);
  assert.equal(
    JSON.parse(
      data.events.find((e) => e.version_id === created.versionId && e.action === 'uploaded').detail,
    ).source.field,
    'meetingType',
  );
});
test('archiving and restoring a prompt preserve its versions and leave an audit trail', async () => {
  await start();
  let data = await (await get('/api/log')).json();
  const id = data.prompts[0].id,
    versionId = data.versions[0].id;
  assert.equal((await post({action: 'archive', promptId: id})).status, 200);
  app.close();
  app = await createLocalApplication({dataDirectory: directory});
  data = await (await get('/api/export')).json();
  assert.ok(data.events.some((e) => e.action === 'archived' && e.prompt_id === id));
  assert.equal(data.versions[0].id, versionId);
  assert.ok(data.versions[0].content);
  assert.equal((await post({action: 'restore', promptId: id})).status, 200);
  data = await (await get('/api/export')).json();
  assert.ok(data.events.some((e) => e.action === 'restored' && e.prompt_id === id));
  assert.equal(data.versions.length, 1);
});
test('rejected drafts retain the reason and cannot later be approved', async () => {
  await start();
  let data = await (await get('/api/log')).json();
  const id = data.versions[0].id;
  assert.equal((await post({action: 'reject', versionId: id, reason: ''})).status, 400);
  assert.equal(
    (await post({action: 'reject', versionId: id, reason: 'Den faglige afgrænsning skal ændres.'}))
      .status,
    200,
  );
  assert.equal((await post({action: 'reject', versionId: id, reason: 'Afvist igen.'})).status, 409);
  assert.equal(
    (
      await post({
        action: 'approve',
        versionId: id,
        effectiveDate: '',
        confirmation: 'Forsøg på godkendelse.',
      })
    ).status,
    409,
  );
  app.close();
  app = await createLocalApplication({dataDirectory: directory});
  data = await (await get('/api/export')).json();
  assert.equal(data.prompts[0].active_version_id, null);
  assert.equal(data.versions[0].approved_at, null);
  assert.equal(
    JSON.parse(data.events.find((e) => e.action === 'rejected').detail).reason,
    'Den faglige afgrænsning skal ændres.',
  );
});

test('the Roboref proxy uses the server-side configuration and never exposes the key to the browser', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-local-test-'));
  const seen = [];
  const roboref = {
    configured: true,
    apiKey: 'server-side-secret',
    baseUrl: 'https://roboref.example/api/v2',
    host: 'roboref.example',
  };
  const roborefFetch = async (url, options) => {
    seen.push({url, key: options.headers['api-key']});
    return {ok: true, json: async () => [{id: 5, title: 'Mødetype', teams: ['Team A']}]};
  };
  app = await createLocalApplication({
    dataDirectory: directory,
    seedExample: false,
    roboref,
    roborefFetch,
  });
  const response = await app.handle(
    new Request(origin + '/api/roboref', {
      method: 'POST',
      headers: {Origin: origin, 'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'list'}),
    }),
  );
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(seen[0].url, 'https://roboref.example/api/v2/meeting-type');
  assert.equal(seen[0].key, 'server-side-secret');
  assert.equal(text.includes('server-side-secret'), false);
  const home = await (await get('/')).text();
  const client = await (await get('/local-client.js')).text();
  assert.equal(home.includes('server-side-secret') || client.includes('server-side-secret'), false);
});
test('without Roboref configuration the app still works and reports a clear setup message', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-local-test-'));
  app = await createLocalApplication({
    dataDirectory: directory,
    seedExample: false,
    roboref: {configured: false, problems: ['ROBOREF_API_KEY mangler.']},
  });
  assert.equal((await get('/api/log')).status, 200);
  const response = await app.handle(
    new Request(origin + '/api/roboref', {
      method: 'POST',
      headers: {Origin: origin, 'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'list'}),
    }),
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /.env/);
});

test('the configured user name is recorded on actions and shown to the browser, escaped', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'roboref-local-test-'));
  app = await createLocalApplication({
    dataDirectory: directory,
    identity: {
      userId: 'local-user',
      displayName: 'Mette </script> Hansen',
      email: 'lokal@denne-computer.invalid',
      roles: ['admin'],
      identityVerified: false,
    },
  });
  const data = await (await get('/api/log')).json();
  assert.equal(data.versions[0].author_name, 'Mette </script> Hansen');
  assert.equal(data.events[0].actor_name, 'Mette </script> Hansen');
  const bootstrap = await (await get('/bootstrap.js')).text();
  assert.ok(bootstrap.includes('__ROBOREF_USER__'));
  assert.equal(
    bootstrap.includes('</script>'),
    false,
    '< skal escapes, så navnet ikke kan afslutte script-elementet',
  );
});
