import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Brugerens indgange til appen (npm-scripts og Windows-startfilen) må aldrig pege på filer,
// der ikke findes. Det opdages ellers først, når en bruger forsøger at starte appen.
const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const exists = (relative) =>
  existsSync(fileURLToPath(new URL(relative.replaceAll('\\', '/'), root)));

test('Start-Roboref.cmd starts a server file that exists', () => {
  const cmd = read('Start-Roboref.cmd');
  const target = cmd.match(/node\.exe\s+(?:--\S+\s+)*(\S+\.mjs)/)?.[1];
  assert.ok(target, 'startfilen skal starte en .mjs-fil med node');
  assert.ok(exists(target), `Start-Roboref.cmd peger på ${target}, som ikke findes`);
});

test('every file referenced by an npm script exists', () => {
  const {scripts} = JSON.parse(read('package.json'));
  for (const [name, command] of Object.entries(scripts)) {
    for (const file of command.match(/(?:^|\s)((?:src|scripts|tests)\/[\w./-]+\.mjs)/g) ?? []) {
      assert.ok(exists(file.trim()), `npm run ${name} peger på ${file.trim()}, som ikke findes`);
    }
  }
});

test('the files referenced in the documentation commands exist', () => {
  for (const doc of ['README.md', 'AGENTS.md']) {
    const text = read(doc);
    for (const file of text.match(/(?:src|scripts)\/[\w./-]+\.mjs/g) ?? []) {
      assert.ok(exists(file), `${doc} henviser til ${file}, som ikke findes`);
    }
  }
});
