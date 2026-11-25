import {test, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createLogHandlers} from '../src/server/handlers/log.ts';
import {createContentHandler} from '../src/server/handlers/content.ts';
import {createExportHandler} from '../src/server/handlers/export.ts';
import {createHash} from 'node:crypto';

// Kører de rigtige handlers og SQL mod en ægte SQLite-database uden netværk.
// Batch-kald er transaktionelle, som i den lokale lagringsadapter.
let sql, beforeBatch;
const user = {
  userId: 'test-user',
  displayName: 'Testbruger',
  email: 'test@example.invalid',
  roles: ['admin'],
  identityVerified: false,
};
class Statement {
  constructor(query, args = []) {
    this.query = query;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.query, args);
  }
  async first() {
    return sql.prepare(this.query).get(...this.args) || null;
  }
  async all() {
    return {results: sql.prepare(this.query).all(...this.args)};
  }
}
const database = {
  prepare(query) {
    return new Statement(query);
  },
  async batch(statements) {
    if (beforeBatch) {
      const hook = beforeBatch;
      beforeBatch = null;
      await hook();
    }
    sql.exec('BEGIN');
    try {
      const result = statements.map((s) => {
        if (/^SELECT/i.test(s.query))
          return {results: sql.prepare(s.query).all(...s.args), meta: {changes: 0}};
        const meta = sql.prepare(s.query).run(...s.args);
        return {results: [], meta: {changes: Number(meta.changes)}};
      });
      sql.exec('COMMIT');
      return result;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
const handlerContext = {db: database, user};
const route = createLogHandlers(handlerContext),
  contentRoute = {GET: createContentHandler(handlerContext)},
  exportRoute = {GET: createExportHandler(handlerContext)};
beforeEach(() => {
  sql?.close();
  sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON;');
  // Alle migrationer i rækkefølge, som den rigtige lagring gør.
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
    sql.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  beforeBatch = null;
});
const payload = {
  action: 'upload',
  filename: 'samtale-v16.md',
  content: '# Prompt\r\nBevar borgerens udsagn.\r\n',
  title: 'Opfølgningssamtale',
  meetingType: 'Opfølgning',
  purpose: 'Referat af samtale',
  owner: 'Fagligt ansvarlig',
  department: 'Afdeling A',
  initialVersion: 16,
  changes: 'Første registrering af v16.',
  reason: 'Registrere eksisterende prompt.',
  outcome: 'Sporbar dokumentation.',
  rationale: 'Historikken skal kunne følges.',
};
function post(body, origin = 'https://app.test') {
  return route.POST(
    new Request('https://app.test/api/log', {
      method: 'POST',
      headers: {'content-type': 'application/json', origin},
      body: JSON.stringify(body),
    }),
  );
}
async function upload(extra = {}) {
  const r = await post({...payload, ...extra});
  const d = await r.json();
  assert.equal(r.status, 201, JSON.stringify(d));
  return d;
}
async function approve(v, effectiveDate = '') {
  const r = await post({
    action: 'approve',
    versionId: v.versionId,
    effectiveDate,
    confirmation: 'Fagligt gennemgået og brug bekræftet.',
  });
  return {status: r.status, data: await r.json()};
}

test('writes reject a missing or foreign Origin, and unknown actions are refused', async () => {
  assert.equal((await post(payload, 'https://other.test')).status, 403);
  assert.equal(
    (
      await route.POST(
        new Request('https://app.test/api/log', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(payload),
        }),
      )
    ).status,
    403,
  );
  assert.equal((await post({action: 'delete-everything'})).status, 400);
  assert.equal(
    (await contentRoute.GET(new Request('https://app.test/api/content?id=missing'))).status,
    404,
  );
});
test('v16 keeps exact content, CRLF, hash, metadata and one upload event', async () => {
  const v = await upload();
  const state = await (await route.GET()).json();
  assert.equal(state.prompts[0].active_version_id, null);
  assert.equal(state.versions[0].number, 16);
  assert.equal(state.events.length, 1);
  const body = await (
    await contentRoute.GET(new Request('https://app.test/api/content?id=' + v.versionId))
  ).json();
  assert.equal(body.content, payload.content);
  assert.equal(
    state.versions[0].sha256,
    createHash('sha256').update(payload.content).digest('hex'),
  );
  assert.equal(state.prompts[0].department, 'Afdeling A');
  assert.equal(state.versions[0].author_name, user.displayName);
});
test('duplicate contents, invalid extension and missing rationale are rejected', async () => {
  const v = await upload();
  assert.equal((await post({...payload, promptId: v.promptId})).status, 409);
  assert.equal((await post({...payload, filename: 'prompt.exe'})).status, 400);
  assert.equal((await post({...payload, rationale: ''})).status, 400);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM prompts').get().n, 1);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM events').get().n, 1);
});
test('new version stays draft until approved; old version and rationale remain available', async () => {
  const first = await upload();
  assert.equal((await approve(first)).status, 200);
  const second = await upload({
    promptId: first.promptId,
    content: payload.content + 'Ingen gæt.\r\n',
    changes: 'Tilføjet en regel mod gæt.',
  });
  assert.equal(
    sql.prepare('SELECT active_version_id FROM prompts').get().active_version_id,
    first.versionId,
  );
  assert.equal((await approve(second)).status, 400);
  assert.equal((await approve(second, '2026-10-28')).status, 200);
  const exported = await (await exportRoute.GET()).json();
  assert.equal(exported.versions.length, 2);
  assert.equal(exported.events.length, 4);
  assert.equal(exported.prompts[0].active_version_id, second.versionId);
  assert.equal(exported.versions[0].content, payload.content);
  assert.equal(exported.versions[1].number, 17);
  assert.equal((await approve(first)).status, 409);
});
test('invalid dates, future dates and a date earlier than current effective date are rejected', async () => {
  const first = await upload();
  assert.equal((await approve(first, '2026-02-31')).status, 400);
  assert.equal((await approve(first, '9999-01-01')).status, 400);
  assert.equal((await approve(first, '2026-10-20')).status, 200);
  const second = await upload({promptId: first.promptId, content: '# Opdateret prompt'});
  assert.equal((await approve(second, '2026-10-19')).status, 400);
});
test('concurrent uploads do not create duplicate version numbers or partial log records', async () => {
  const first = await upload();
  const replies = await Promise.all([
    post({...payload, promptId: first.promptId, content: '# Ændring A'}),
    post({...payload, promptId: first.promptId, content: '# Ændring B'}),
  ]);
  const statuses = replies.map((r) => r.status);
  assert.ok(statuses.includes(201));
  assert.ok(statuses.every((s) => s === 201 || s === 409));
  const successes = statuses.filter((s) => s === 201).length,
    rows = sql.prepare('SELECT number FROM versions ORDER BY number').all();
  assert.equal(rows.length, 1 + successes);
  assert.equal(new Set(rows.map((r) => r.number)).size, rows.length);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM events').get().n, rows.length);
});
test('competing approvals cannot silently replace each other and only the winner logs approval', async () => {
  const first = await upload();
  await approve(first);
  const a = await upload({promptId: first.promptId, content: '# Ændring A'}),
    b = await upload({promptId: first.promptId, content: '# Ændring B'});
  const replies = await Promise.all([approve(a, '2026-10-28'), approve(b, '2026-10-28')]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM events WHERE action='approved'").get().n, 2);
});
test('comparison previews need no decision text and create no version or log entry', async () => {
  const first = await upload();
  const response = await post({
    action: 'compare',
    promptId: first.promptId,
    filename: 'v17.md',
    content: payload.content.replace('Bevar', 'Gengiv'),
  });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.comparison.baseVersionId, first.versionId);
  assert.equal(preview.comparison.baseKind, 'latest');
  assert.equal(preview.beforeContent, payload.content);
  assert.equal(preview.comparison.addedLines, 1);
  assert.equal(preview.comparison.removedLines, 1);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM versions').get().n, 1);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM events').get().n, 1);
});
test('existing prompt uploads generate concrete changes on the server and retain the user rationale', async () => {
  const first = await upload();
  const response = await post({
    ...payload,
    promptId: first.promptId,
    content: payload.content.replace('Bevar', 'Gengiv'),
    changes: 'FORKERT TEKST FRA KLIENTEN',
    reason: 'Min egen begrundelse.',
    expectedBaseVersionId: first.versionId,
  });
  assert.equal(response.status, 201);
  const saved = await response.json(),
    state = await (await route.GET()).json(),
    v = state.versions.find((v) => v.id === saved.versionId),
    event = state.events.find((e) => e.version_id === saved.versionId);
  assert.ok(v.changes.includes('Bevar borgerens udsagn.'));
  assert.ok(v.changes.includes('Gengiv borgerens udsagn.'));
  assert.ok(!v.changes.includes('FORKERT'));
  assert.equal(v.reason, 'Min egen begrundelse.');
  assert.equal(JSON.parse(event.detail).comparison.baseVersionId, first.versionId);
});
test('comparison uses the current approved version even when a newer draft exists', async () => {
  const first = await upload();
  await approve(first);
  await upload({promptId: first.promptId, content: '# Mellemliggende kladde'});
  const preview = await (
    await post({
      action: 'compare',
      promptId: first.promptId,
      filename: 'v18.md',
      content: '# Ny version',
    })
  ).json();
  assert.equal(preview.comparison.baseVersionId, first.versionId);
  assert.equal(preview.comparison.baseKind, 'active');
  assert.equal(preview.beforeContent, payload.content);
  const response = await post({
    ...payload,
    promptId: first.promptId,
    content: '# Ny version',
    changes: undefined,
    expectedBaseVersionId: preview.comparison.baseVersionId,
  });
  assert.equal(response.status, 201);
  const saved = await response.json(),
    state = await (await route.GET()).json(),
    event = state.events.find((e) => e.version_id === saved.versionId);
  assert.equal(JSON.parse(event.detail).comparison.baseVersionNumber, 16);
  assert.equal(state.versions.find((v) => v.id === saved.versionId).number, 18);
});
test('a changed comparison base rejects a stale preview without adding a phantom version', async () => {
  const first = await upload();
  await approve(first);
  const draft = await upload({promptId: first.promptId, content: '# Ny kladde'});
  await approve(draft, '2026-10-28');
  const r = await post({
    ...payload,
    promptId: first.promptId,
    content: '# Nyere indhold',
    expectedBaseVersionId: first.versionId,
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'comparison_changed');
  assert.equal(sql.prepare('SELECT count(*) AS n FROM versions').get().n, 2);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM events').get().n, 4);
});
test('an approval during save cannot change the comparison silently or leave a partial event', async () => {
  const first = await upload();
  await approve(first);
  const draft = await upload({promptId: first.promptId, content: '# Ny kladde'});
  beforeBatch = async () => {
    assert.equal((await approve(draft, '2026-10-28')).status, 200);
  };
  const r = await post({
    ...payload,
    promptId: first.promptId,
    content: '# Endnu en ændring',
    expectedBaseVersionId: first.versionId,
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'comparison_changed');
  assert.equal(sql.prepare('SELECT count(*) AS n FROM versions').get().n, 2);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM events').get().n, 4);
});
test('line ending changes are documented honestly and the rationale remains mandatory', async () => {
  const first = await upload(),
    content = payload.content.replace(/\r\n/g, '\n');
  const preview = await (
    await post({action: 'compare', promptId: first.promptId, filename: 'v17.md', content})
  ).json();
  assert.equal(preview.comparison.onlyLineEndings, true);
  assert.equal(preview.comparison.addedLines, 0);
  const missing = await post({
    ...payload,
    promptId: first.promptId,
    content,
    changes: undefined,
    rationale: '',
  });
  assert.equal(missing.status, 400);
  const saved = await post({
    ...payload,
    promptId: first.promptId,
    content,
    changes: undefined,
    expectedBaseVersionId: first.versionId,
  });
  assert.equal(saved.status, 201);
  const state = await (await route.GET()).json();
  assert.ok(state.versions[0].changes.includes('Kun linjeskift'));
  assert.equal(
    (await post({action: 'compare', promptId: first.promptId, filename: 'v17.md', content})).status,
    409,
  );
});
