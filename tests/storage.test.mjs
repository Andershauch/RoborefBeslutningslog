import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStorage} from '../src/server/storage.mjs';

// Lagringslagets løfter om dataintegritet: migrationer køres én gang, en fejl rulles helt
// tilbage, og en gruppe af skrivninger gennemføres helt eller slet ikke.
let work;
let storage;

afterEach(async () => {
  storage?.close();
  storage = null;
  if (work) await rm(work, {recursive: true, force: true});
  work = null;
});

async function makeRoot(migrations) {
  work = await mkdtemp(path.join(tmpdir(), 'roboref-storage-test-'));
  const root = path.join(work, 'root');
  await mkdir(path.join(root, 'migrations'), {recursive: true});
  for (const [name, sql] of Object.entries(migrations)) {
    await writeFile(path.join(root, 'migrations', name), sql);
  }
  return {root, data: path.join(work, 'data')};
}

const rows = (database, sql) => database.prepare(sql).all();

test('migrations are applied once, recorded by file name, and never re-run on restart', async () => {
  const {root, data} = await makeRoot({
    '0000_start.sql': 'CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL);',
  });
  storage = await createStorage(root, data);
  storage.database.prepare("INSERT INTO notes (text) VALUES ('bevares')").run();
  storage.close();

  // En ny migration kommer til; den gamle må ikke køres igen (det ville fejle: tabellen findes).
  await writeFile(
    path.join(root, 'migrations', '0001_mere.sql'),
    'ALTER TABLE notes ADD COLUMN done INTEGER DEFAULT 0;',
  );
  storage = await createStorage(root, data);
  assert.deepEqual(
    rows(storage.database, 'SELECT name FROM local_migrations ORDER BY name').map(
      (row) => row.name,
    ),
    ['0000_start.sql', '0001_mere.sql'],
  );
  assert.deepEqual(
    rows(storage.database, 'SELECT text,done FROM notes').map((row) => ({...row})),
    [{text: 'bevares', done: 0}],
  );
});

test('a failing migration is rolled back completely and the earlier state is kept', async () => {
  const {root, data} = await makeRoot({
    '0000_start.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
  });
  storage = await createStorage(root, data);
  storage.close();
  storage = null;

  // Halvvejs gennem migrationen går det galt: tabellen b må ikke blive tilbage.
  await writeFile(
    path.join(root, 'migrations', '0001_defekt.sql'),
    'CREATE TABLE b (id INTEGER PRIMARY KEY);\nINSERT INTO findes_ikke VALUES (1);',
  );
  await assert.rejects(createStorage(root, data), /findes_ikke/);

  const database = new DatabaseSync(path.join(data, 'beslutningslog.sqlite'));
  try {
    const tables = rows(database, "SELECT name FROM sqlite_master WHERE type='table'").map(
      (row) => row.name,
    );
    assert.ok(tables.includes('a'));
    assert.equal(tables.includes('b'), false, 'delvist udført migration blev rullet tilbage');
    assert.deepEqual(
      rows(database, 'SELECT name FROM local_migrations').map((row) => row.name),
      ['0000_start.sql'],
    );
  } finally {
    database.close();
  }
});

test('a batch is all-or-nothing: a failing statement undoes the ones before it', async () => {
  const {root, data} = await makeRoot({
    '0000_start.sql': 'CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL UNIQUE);',
  });
  storage = await createStorage(root, data);
  const {adapter} = storage;
  const insert = adapter.prepare('INSERT INTO notes (text) VALUES (?)');

  await assert.rejects(adapter.batch([insert.bind('første'), insert.bind('første')]), /UNIQUE/i);
  assert.equal(
    rows(storage.database, 'SELECT * FROM notes').length,
    0,
    'ingen af skrivningerne blev gemt',
  );

  const results = await adapter.batch([
    insert.bind('a'),
    insert.bind('b'),
    adapter.prepare('SELECT text FROM notes ORDER BY text'),
  ]);
  assert.deepEqual(
    results.map((result) => result.meta.changes),
    [1, 1, 0],
  );
  assert.deepEqual(
    results[2].results.map((row) => row.text),
    ['a', 'b'],
  );
  assert.equal(
    (await adapter.prepare('SELECT text FROM notes WHERE text=?').bind('a').first()).text,
    'a',
  );
  assert.equal(
    await adapter.prepare('SELECT text FROM notes WHERE text=?').bind('x').first(),
    null,
  );
});

test('one dated backup is made when an existing database is opened, and it contains the data', async () => {
  const {root, data} = await makeRoot({
    '0000_start.sql': 'CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL);',
  });
  storage = await createStorage(root, data);
  storage.database.prepare("INSERT INTO notes (text) VALUES ('vigtig')").run();
  assert.equal(
    await readdir(path.join(data, 'backups'))
      .catch(() => [])
      .then((files) => files.length),
    0,
    'ingen backup ved første oprettelse',
  );
  storage.close();

  for (let i = 0; i < 3; i++) {
    storage = await createStorage(root, data);
    storage.close();
  }
  storage = null;
  const backups = await readdir(path.join(data, 'backups'));
  assert.equal(backups.length, 1, 'højst én backup pr. dag');
  assert.match(backups[0], /^beslutningslog-\d{4}-\d{2}-\d{2}\.sqlite$/);

  const copy = new DatabaseSync(path.join(data, 'backups', backups[0]), {readOnly: true});
  try {
    assert.deepEqual(
      rows(copy, 'SELECT text FROM notes').map((row) => row.text),
      ['vigtig'],
    );
  } finally {
    copy.close();
  }
});
