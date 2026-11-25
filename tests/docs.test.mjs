import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Dokumentationen må ikke rådne: links skal pege på noget, kommandoer skal findes, og alle
// indstillinger i koden skal være beskrevet.
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const documents = [
  'README.md',
  'SECURITY.md',
  'AGENTS.md',
  'CLAUDE.md',
  ...readdirSync(path.join(root, 'docs')).map((name) => `docs/${name}`),
].filter((file) => file.endsWith('.md'));

// GitHubs regel for overskrifters ankre: små bogstaver, uden tegnsætning, mellemrum til bindestreg.
function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function anchors(file) {
  return new Set([...read(file).matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slug(match[1])));
}

test('every relative link and heading anchor in the documentation resolves', () => {
  for (const file of documents) {
    const base = path.dirname(file);
    // Kodeblokke fjernes, så eksempler med firkantede parenteser ikke tolkes som links.
    const text = read(file).replace(/```[\s\S]*?```/g, '');
    for (const [, target] of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [relative, anchor] = target.split('#');
      const resolved = relative ? path.join(base, relative) : file;
      assert.ok(
        existsSync(path.join(root, resolved)),
        `${file}: linket ${target} peger på en fil, der ikke findes`,
      );
      if (anchor && resolved.endsWith('.md')) {
        assert.ok(
          anchors(resolved).has(anchor),
          `${file}: ankeret #${anchor} findes ikke i ${resolved}`,
        );
      }
    }
  }
});

test('every `npm run` command in the documentation exists in package.json', () => {
  const {scripts} = JSON.parse(read('package.json'));
  for (const file of documents) {
    for (const [, name] of read(file).matchAll(/npm run ([\w:-]+)/g)) {
      assert.ok(scripts[name], `${file} nævner "npm run ${name}", som ikke findes i package.json`);
    }
  }
});

test('every ROBOREF_* setting read by the code is in .env.example and documented', () => {
  const used = new Set(read('src/server/config.mjs').match(/ROBOREF_[A-Z_]+/g));
  assert.ok(used.size >= 5, 'konfigurationen læser mindst fem indstillinger');
  const example = read('.env.example');
  const documented = read('docs/konfiguration.md');
  for (const name of used) {
    assert.match(example, new RegExp(`^${name}=`, 'm'), `${name} mangler i .env.example`);
    assert.ok(
      documented.includes(`\`${name}\``),
      `${name} er ikke beskrevet i docs/konfiguration.md`,
    );
  }
  for (const [, name] of example.matchAll(/^(ROBOREF_[A-Z_]+)=/gm)) {
    assert.ok(used.has(name), `${name} står i .env.example, men bruges ikke af koden`);
  }
});

test('the README links to every document in docs/', () => {
  const readme = read('README.md');
  for (const name of readdirSync(path.join(root, 'docs'))) {
    assert.ok(readme.includes(`docs/${name}`), `README henviser ikke til docs/${name}`);
  }
});

test('the release metadata is consistent: version in the changelog, license present', () => {
  const {version, license} = JSON.parse(read('package.json'));
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.ok(
    read('CHANGELOG.md')
      .split('\n')
      .some((line) => line.startsWith(`## [${version}]`)),
    `CHANGELOG.md mangler overskriften "## [${version}]"`,
  );
  assert.equal(license, 'MIT');
  assert.match(read('LICENSE'), /^MIT License/);
});

test('every database table is described in docs/data-i-appen.md', () => {
  // Oversigten over, hvad appen gemmer, må ikke komme bagud, når en migration tilføjer en tabel.
  const tables = new Set();
  for (const file of readdirSync(path.join(root, 'migrations'))) {
    for (const [, name] of read(`migrations/${file}`).matchAll(/CREATE TABLE `?(\w+)`?/gi)) {
      tables.add(name);
    }
  }
  assert.ok(tables.size >= 5, 'migrationerne opretter mindst fem tabeller');
  const overview = read('docs/data-i-appen.md');
  for (const name of tables) {
    assert.ok(
      overview.includes(`\`${name}\``),
      `tabellen ${name} er ikke beskrevet i docs/data-i-appen.md`,
    );
  }
});
