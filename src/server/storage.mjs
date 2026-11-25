import {DatabaseSync, backup} from 'node:sqlite';
import {existsSync, mkdirSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
export async function createStorage(root, dataDirectory) {
  mkdirSync(dataDirectory, {recursive: true});
  const filename = path.join(dataDirectory, 'beslutningslog.sqlite'),
    existed = existsSync(filename),
    database = new DatabaseSync(filename);
  database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  database.exec(
    'CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
  );
  for (const file of readdirSync(path.join(root, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (database.prepare('SELECT name FROM local_migrations WHERE name=?').get(file)) continue;
    database.exec('BEGIN');
    try {
      database.exec(readFileSync(path.join(root, 'migrations', file), 'utf8'));
      database
        .prepare('INSERT INTO local_migrations (name,applied_at) VALUES (?,?)')
        .run(file, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      database.close();
      throw error;
    }
  }
  if (existed) {
    const backups = path.join(dataDirectory, 'backups');
    mkdirSync(backups, {recursive: true});
    const file = path.join(
      backups,
      'beslutningslog-' +
        new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Copenhagen'}).format(new Date()) +
        '.sqlite',
    );
    if (!existsSync(file)) await backup(database, file);
  }
  class Statement {
    constructor(query, args = []) {
      this.query = query;
      this.args = args;
    }
    bind(...args) {
      return new Statement(this.query, args);
    }
    async first() {
      return database.prepare(this.query).get(...this.args) || null;
    }
    async all() {
      return {results: database.prepare(this.query).all(...this.args)};
    }
  }
  return {
    filename,
    close() {
      database.close();
    },
    database,
    adapter: {
      prepare(query) {
        return new Statement(query);
      },
      async batch(statements) {
        database.exec('BEGIN');
        try {
          const result = statements.map((s) => {
            const prepared = database.prepare(s.query);
            if (/^SELECT/i.test(s.query))
              return {results: prepared.all(...s.args), meta: {changes: 0}};
            const meta = prepared.run(...s.args);
            return {results: [], meta: {changes: Number(meta.changes)}};
          });
          database.exec('COMMIT');
          return result;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
}
