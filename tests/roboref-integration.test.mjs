import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roborefRequest} from '../src/server/roboref-api.mjs';
const origin = 'http://127.0.0.1:5188';
const config = {
  configured: true,
  apiKey: 'secret',
  baseUrl: 'https://roboref.example/api/v2',
  host: 'roboref.example',
};
const req = (body, site = origin) =>
  new Request(origin + '/api/roboref', {
    method: 'POST',
    headers: {origin: site, 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
test('only same-origin POST sends the key to the fixed Roboref host and returns history ordered newest first', async () => {
  let calls = 0;
  const remote = async (url, opts) => {
    calls++;
    assert.equal(url, 'https://roboref.example/api/v2/meeting-type/147/history');
    assert.equal(opts.headers['api-key'], 'secret');
    assert.equal(opts.redirect, 'error');
    return {
      ok: true,
      json: async () => [
        {instruction: 'old', validFrom: '2026-01-01T00:00:00Z'},
        {instruction: 'new', validFrom: '2026-02-01T00:00:00Z'},
      ],
    };
  };
  assert.equal(
    (
      await roborefRequest(
        req({action: 'history', id: 147}, 'https://other.example'),
        origin,
        config,
        remote,
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
  const res = await roborefRequest(req({action: 'history', id: 147}), origin, config, remote);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.items[0].instruction, 'new');
  assert.equal(JSON.stringify(data).includes('secret'), false);
});
test('invalid IDs cannot become a remote URL and 401 is reported without exposing key', async () => {
  let calls = 0;
  const remote = async () => {
    calls++;
    return {ok: false, status: 401};
  };
  assert.equal(
    (await roborefRequest(req({action: 'history', id: '../meeting'}), origin, config, remote))
      .status,
    400,
  );
  assert.equal(calls, 0);
  const res = await roborefRequest(req({action: 'list'}), origin, config, remote);
  assert.equal(res.status, 401);
  assert.doesNotMatch(await res.text(), /secret/);
});
test('the list preserves the departments returned by Roboref', async () => {
  const remote = async () => ({
    ok: true,
    json: async () => [
      {id: 17, title: 'Samtale', teams: ['Afdeling A', 'Afdeling B'], isDraft: false},
    ],
  });
  const res = await roborefRequest(req({action: 'list'}), origin, config, remote);
  const data = await res.json();
  assert.deepEqual(data.items[0].teams, ['Afdeling A', 'Afdeling B']);
});
test('history preserves all returned fields, including unknown fields and null values', async () => {
  const entry = {
    title: 'Samtale',
    instruction: 'Instruktion',
    template: 'Skabelon',
    example: null,
    technicalTerms: ['ord'],
    newSetting: {enabled: false},
    validFrom: '2026-01-01T00:00:00Z',
  };
  const remote = async () => ({ok: true, json: async () => [entry]});
  const data = await (
    await roborefRequest(req({action: 'history', id: 17}), origin, config, remote)
  ).json();
  assert.deepEqual(data.items[0], {...entry, validTo: null});
});

test('a key sent by the browser is ignored; only the configured key reaches Roboref', async () => {
  let sent;
  const remote = async (url, opts) => {
    sent = opts.headers['api-key'];
    return {ok: true, json: async () => []};
  };
  const res = await roborefRequest(
    req({action: 'list', key: 'attacker-key'}),
    origin,
    config,
    remote,
  );
  assert.equal(res.status, 200);
  assert.equal(sent, 'secret');
});
test('without configuration Roboref is never called and the user gets a clear message without secrets', async () => {
  let calls = 0;
  const remote = async () => {
    calls++;
    return {ok: true, json: async () => []};
  };
  const missing = {configured: false, problems: ['ROBOREF_API_KEY mangler.']};
  const res = await roborefRequest(req({action: 'list'}), origin, missing, remote);
  assert.equal(res.status, 503);
  assert.equal(calls, 0);
  assert.match((await res.json()).error, /ROBOREF_API_KEY mangler.*.env/s);
});
test('a redirect from Roboref is refused so the key cannot be sent elsewhere', async () => {
  let options;
  const remote = async (url, opts) => {
    options = opts;
    throw new TypeError('redirect');
  };
  const res = await roborefRequest(req({action: 'list'}), origin, config, remote);
  assert.equal(options.redirect, 'error');
  assert.equal(res.status, 502);
  assert.doesNotMatch(await res.text(), /secret/);
});
