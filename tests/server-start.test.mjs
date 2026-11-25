import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const serverFile = fileURLToPath(new URL('../src/server/server.mjs', import.meta.url));

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const {port} = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Starter den rigtige server som eget program med isoleret port og datamappe.
function startServer(env, cwd) {
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', serverFile, '--no-open'],
    {
      cwd,
      env: {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env},
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  return {child, exited, output: () => output};
}

async function waitForHealth(port, server) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) throw new Error('Serveren stoppede: ' + server.output());
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return response.json();
    } catch {
      /* ikke klar endnu */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Serveren blev ikke klar: ' + server.output());
}

async function stopServer(server) {
  if (server.child.exitCode === null) server.child.kill();
  await server.exited;
}

test('server.mjs starts from any working directory, honours port and data directory, and reports Roboref status without secrets', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'roboref-server-test-'));
  const port = await freePort();
  const server = startServer(
    {
      ROBOREF_PORT: String(port),
      ROBOREF_DATA_DIR: path.join(work, 'data'),
      ROBOREF_API_KEY: 'super-secret-test-key',
      ROBOREF_BASE_URL: 'https://roboref.example/api/v2',
    },
    work,
  );
  try {
    const health = await waitForHealth(port, server);
    assert.equal(health.app, 'roboref-beslutningslog');
    const home = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(home.status, 200);
    assert.match(server.output(), /Roboref: forbundet til roboref\.example/);
    assert.equal(server.output().includes('super-secret-test-key'), false);
  } finally {
    await stopServer(server);
    await rm(work, {recursive: true, force: true});
  }
});

test('server.mjs starts without Roboref configuration and explains what is missing', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'roboref-server-test-'));
  const port = await freePort();
  // Tomme værdier gør, at en eventuel .env i projektet ikke kan påvirke testen.
  const server = startServer(
    {
      ROBOREF_PORT: String(port),
      ROBOREF_DATA_DIR: path.join(work, 'data'),
      ROBOREF_API_KEY: '',
      ROBOREF_BASE_URL: '',
    },
    work,
  );
  try {
    await waitForHealth(port, server);
    assert.match(server.output(), /Roboref: ikke sat op/);
    assert.match(server.output(), /ROBOREF_API_KEY mangler/);
  } finally {
    await stopServer(server);
    await rm(work, {recursive: true, force: true});
  }
});

test('server.mjs refuses an invalid port instead of guessing', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'roboref-server-test-'));
  const server = startServer({ROBOREF_PORT: '80', ROBOREF_DATA_DIR: path.join(work, 'data')}, work);
  try {
    assert.equal(await server.exited, 1);
    assert.match(server.output(), /ROBOREF_PORT/);
  } finally {
    await rm(work, {recursive: true, force: true});
  }
});

test('a second start reuses the running app, and an outdated app on the port is reported', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'roboref-server-test-'));
  const port = await freePort();
  const env = {
    ROBOREF_PORT: String(port),
    ROBOREF_DATA_DIR: path.join(work, 'data'),
    ROBOREF_API_KEY: '',
    ROBOREF_BASE_URL: '',
  };
  const first = startServer(env, work);
  try {
    await waitForHealth(port, first);
    const second = startServer(env, work);
    assert.equal(await second.exited, 0, 'en anden start afslutter uden fejl');
    assert.match(second.output(), /kører allerede/);
  } finally {
    await stopServer(first);
  }

  // En ældre udgave (anden API-version) optager porten: der skal gives en forklaring, ikke en nedbrudt app.
  const old = createHttpServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({app: 'roboref-beslutningslog', mode: 'local', apiVersion: 1}));
  });
  await new Promise((resolve) => old.listen(port, '127.0.0.1', resolve));
  try {
    const third = startServer(env, work);
    assert.equal(await third.exited, 1);
    assert.match(third.output(), /tidligere version/);
  } finally {
    await new Promise((resolve) => old.close(resolve));
    await rm(work, {recursive: true, force: true});
  }
});
