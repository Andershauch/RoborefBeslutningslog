import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  parseRoborefConfig,
  parseServerSettings,
  parseIdentity,
  loadDotEnv,
  describeMissingConfig,
} from '../src/server/config.mjs';

const valid = {ROBOREF_API_KEY: 'abc123-_KEY', ROBOREF_BASE_URL: 'https://roboref.example/api/v2'};

test('a valid configuration is accepted and the base URL is normalised', () => {
  const config = parseRoborefConfig({
    ...valid,
    ROBOREF_BASE_URL: ' https://roboref.example/api/v2/// ',
  });
  assert.equal(config.configured, true);
  assert.equal(config.baseUrl, 'https://roboref.example/api/v2');
  assert.equal(config.host, 'roboref.example');
});

test('missing values are reported by name', () => {
  const config = parseRoborefConfig({});
  assert.equal(config.configured, false);
  assert.deepEqual(config.problems, ['ROBOREF_API_KEY mangler.', 'ROBOREF_BASE_URL mangler.']);
  assert.match(describeMissingConfig(config), /\.env/);
});

test('unsafe base URLs are rejected', () => {
  for (const url of [
    'http://roboref.example/api/v2',
    'ftp://roboref.example',
    'https://user:pw@roboref.example/api',
    'https://roboref.example/api?x=1',
    'https://roboref.example/api#a',
    'not a url',
  ]) {
    assert.equal(parseRoborefConfig({...valid, ROBOREF_BASE_URL: url}).configured, false, url);
  }
});

test('plain http is only allowed for the local machine (tests and mock servers)', () => {
  assert.equal(
    parseRoborefConfig({...valid, ROBOREF_BASE_URL: 'http://127.0.0.1:9000/api/v2'}).configured,
    true,
  );
  assert.equal(
    parseRoborefConfig({...valid, ROBOREF_BASE_URL: 'http://localhost:9000'}).configured,
    true,
  );
});

test('keys with whitespace, control characters or excessive length are rejected without echoing the key', () => {
  for (const key of ['a b', 'a\nb', 'a\r\nX-Evil: 1', 'æøå', 'x'.repeat(4097)]) {
    const config = parseRoborefConfig({...valid, ROBOREF_API_KEY: key});
    assert.equal(config.configured, false);
    assert.equal(JSON.stringify(config).includes(key), false);
  }
});

test('loadDotEnv reads .env but never overrides variables that are already set', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'roboref-env-test-'));
  try {
    assert.equal(loadDotEnv(dir), false);
    await writeFile(
      path.join(dir, '.env'),
      'ROBOREF_TEST_FROM_FILE=fra-fil\nROBOREF_TEST_PRESET=fra-fil\n',
    );
    process.env.ROBOREF_TEST_PRESET = 'fra-miljoe';
    assert.equal(loadDotEnv(dir), true);
    assert.equal(process.env.ROBOREF_TEST_FROM_FILE, 'fra-fil');
    assert.equal(process.env.ROBOREF_TEST_PRESET, 'fra-miljoe');
  } finally {
    delete process.env.ROBOREF_TEST_FROM_FILE;
    delete process.env.ROBOREF_TEST_PRESET;
    await rm(dir, {recursive: true, force: true});
  }
});

test('the data directory defaults to data/, keeps an existing legacy database, and honours ROBOREF_DATA_DIR', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'roboref-settings-test-'));
  try {
    assert.equal(parseServerSettings({}, root).dataDirectory, path.join(root, 'data'));
    assert.equal(parseServerSettings({}, root).port, 5188);
    await mkdir(path.join(root, 'local-runtime', 'data'), {recursive: true});
    assert.equal(
      parseServerSettings({}, root).dataDirectory,
      path.join(root, 'data'),
      'en tom ældre mappe er ikke en database',
    );
    await writeFile(path.join(root, 'local-runtime', 'data', 'beslutningslog.sqlite'), '');
    assert.equal(
      parseServerSettings({}, root).dataDirectory,
      path.join(root, 'local-runtime', 'data'),
    );
    assert.equal(
      parseServerSettings({ROBOREF_DATA_DIR: 'andet'}, root).dataDirectory,
      path.join(root, 'andet'),
    );
    assert.throws(() => parseServerSettings({ROBOREF_PORT: 'abc'}, root), /ROBOREF_PORT/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('the local identity defaults to a neutral name and is sanitised when set', () => {
  assert.equal(parseIdentity({}).displayName, 'Lokal bruger');
  assert.equal(parseIdentity({}).identityVerified, false);
  assert.equal(parseIdentity({ROBOREF_USER_NAME: '  Mette Hansen  '}).displayName, 'Mette Hansen');
  assert.equal(
    parseIdentity({ROBOREF_USER_NAME: 'Mette\nHansen\u0000'}).displayName,
    'MetteHansen',
  );
  assert.equal(parseIdentity({ROBOREF_USER_NAME: 'x'.repeat(500)}).displayName.length, 100);
});
