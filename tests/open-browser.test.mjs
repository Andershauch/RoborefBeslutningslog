import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openInBrowser} from '../src/server/open-browser.mjs';

function fakeSpawn() {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({command, args, options});
    return {on() {}, unref() {}};
  };
  return {calls, spawnProcess};
}

test('the browser is opened with the right command on Windows, macOS and Linux', () => {
  const url = 'http://127.0.0.1:5188';
  for (const [platform, command, args] of [
    ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler', url]],
    ['darwin', 'open', [url]],
    ['linux', 'xdg-open', [url]],
  ]) {
    const {calls, spawnProcess} = fakeSpawn();
    assert.equal(openInBrowser(url, {platform, spawnProcess}), true);
    assert.equal(calls[0].command, command);
    assert.deepEqual(calls[0].args, args);
    assert.equal(calls[0].options.stdio, 'ignore');
  }
});

test('an unsupported platform does nothing, and a failing opener never throws', () => {
  const {calls, spawnProcess} = fakeSpawn();
  assert.equal(openInBrowser('http://127.0.0.1:5188', {platform: 'freebsd', spawnProcess}), false);
  assert.equal(calls.length, 0);

  let errorHandler;
  const failing = () => ({on: (event, handler) => (errorHandler = handler), unref() {}});
  openInBrowser('http://127.0.0.1:5188', {platform: 'linux', spawnProcess: failing});
  assert.doesNotThrow(() => errorHandler(new Error('xdg-open mangler')));
});
