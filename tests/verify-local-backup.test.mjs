import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {createStorage} from '../src/server/storage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(root, 'scripts/verify-local-backup.mjs');

async function createBackupFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'roboref-backup-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const dataDirectory = path.join(directory, 'seed', 'data');
  const storage = await createStorage(root, dataDirectory);
  storage.database
    .prepare(
      'INSERT INTO prompts (id,title,meeting_type,purpose,owner,department,created_at,created_by,active_version_id) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    .run(
      'test-prompt',
      'synthetic confidential marker',
      'Test',
      'Test purpose',
      'Test owner',
      'Test department',
      '2026-11-03T00:00:00.000Z',
      'test-user',
      null,
    );
  storage.close();
  const backupDirectory = path.join(directory, 'backups');
  await mkdir(backupDirectory, {recursive: true});
  const backup = path.join(backupDirectory, 'beslutningslog-2026-11-03.sqlite');
  await copyFile(path.join(dataDirectory, 'beslutningslog.sqlite'), backup);
  return {directory, backup};
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('backup verification opens an isolated copy and leaves its source unchanged', async (t) => {
  const {backup} = await createBackupFixture(t);
  const before = sha256(await readFile(backup));
  const result = spawnSync(process.execPath, [verifier, backup], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.integrity, 'ok');
  assert.equal(report.foreignKeyViolations, 0);
  assert.equal(report.recordCounts.prompts, 1);
  assert.equal(report.originalChanged, false);
  assert.equal(sha256(await readFile(backup)), before);
  assert.doesNotMatch(result.stdout, /synthetic confidential marker/);
});

test('backup verification reports a damaged file and preserves it', async (t) => {
  const {directory} = await createBackupFixture(t);
  const backupDirectory = path.join(directory, 'damaged', 'backups');
  await mkdir(backupDirectory, {recursive: true});
  const backup = path.join(backupDirectory, 'beslutningslog-2026-11-03.sqlite');
  await writeFile(backup, 'not a SQLite database');
  const before = sha256(await readFile(backup));
  const result = spawnSync(process.execPath, [verifier, backup], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Backupkontrollen fejlede/);
  assert.equal(sha256(await readFile(backup)), before);
});

test('backup verification refuses a file in the live data folder', async (t) => {
  const {directory} = await createBackupFixture(t);
  const dataDirectory = path.join(directory, 'data');
  await mkdir(dataDirectory, {recursive: true});
  const activeDatabase = path.join(dataDirectory, 'beslutningslog.sqlite');
  await writeFile(activeDatabase, 'leave unchanged');
  const before = sha256(await readFile(activeDatabase));
  const result = spawnSync(process.execPath, [verifier, activeDatabase], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Vælg en dateret beslutningslog-backup/);
  assert.equal(sha256(await readFile(activeDatabase)), before);
});
