import {copyFile, lstat, mkdir, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStorage} from '../src/server/storage.mjs';

const source = process.argv[2];
if (!source) {
  console.error('Angiv stien til en backupfil i mappen data/backups.');
  process.exit(2);
}

const sourcePath = path.resolve(source);
const sourceInfo = await lstat(sourcePath).catch(() => null);
if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) {
  console.error('Backupfilen blev ikke fundet eller er ikke en almindelig fil.');
  process.exit(2);
}
if (
  path.basename(path.dirname(sourcePath)).toLowerCase() !== 'backups' ||
  !/^beslutningslog-[0-9]{4}-[0-9]{2}-[0-9]{2}[.]sqlite$/i.test(path.basename(sourcePath))
) {
  console.error('Vælg en dateret beslutningslog-backup fra mappen data/backups.');
  process.exit(2);
}

const tempRoot = path.resolve(os.tmpdir());
const testDirectory = await mkdtemp(path.join(tempRoot, 'roboref-backup-check-'));
const dataDirectory = path.join(testDirectory, 'data');
const copyPath = path.join(dataDirectory, 'beslutningslog.sqlite');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let storage;
try {
  await mkdir(dataDirectory, {recursive: true});
  await copyFile(sourcePath, copyPath);
  storage = await createStorage(projectRoot, dataDirectory);
  const integrity = storage.database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (integrity !== 'ok') throw new Error('SQLite-integritetskontrollen bestod ikke.');
  const tables = storage.database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('prompts','versions','events') ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  if (tables.join(',') !== 'events,prompts,versions')
    throw new Error('En eller flere af appens datatabeller mangler.');
  const violations = storage.database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length)
    throw new Error('Databasen indeholder brud på relationerne mellem tabellerne.');
  const recordCounts = Object.fromEntries(
    ['prompts', 'versions', 'events'].map((table) => [
      table,
      Number(storage.database.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count),
    ]),
  );
  console.log(
    JSON.stringify({
      ok: true,
      checkedFile: path.basename(sourcePath),
      integrity: 'ok',
      foreignKeyViolations: 0,
      recordCounts,
      originalChanged: false,
    }),
  );
} catch (error) {
  console.error('Backupkontrollen fejlede: ' + error.message);
  process.exitCode = 1;
} finally {
  storage?.close();
  const resolvedTemp = path.resolve(testDirectory);
  if (resolvedTemp.startsWith(tempRoot + path.sep))
    await rm(resolvedTemp, {recursive: true, force: true});
  else {
    console.error('Testmappen lå uden for systemets midlertidige mappe; den blev ikke slettet.');
    process.exitCode = 1;
  }
}
