import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectApi} from '../scripts/roboref-api-test.mjs';
const config = {apiKey: 'secret', baseUrl: 'https://roboref.example/api/v2'};
test('reads histories and reports changed fields in chronological order', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({url, options});
    return {
      ok: true,
      json: async () =>
        url.endsWith('/meeting-type')
          ? [{id: 4, title: 'Eksempel'}]
          : [
              {validFrom: '2026-02-01', instruction: 'Ny'},
              {validFrom: '2026-01-01', instruction: 'Gammel'},
            ],
    };
  };
  const result = await inspectApi(config, request);
  assert.deepEqual(result[0].changes, [{validFrom: '2026-02-01', fields: ['instruction']}]);
  assert.equal(calls[0].url, 'https://roboref.example/api/v2/meeting-type');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['api-key'], 'secret');
  assert.equal(calls[0].options.redirect, 'error');
});
test('reports a history error without losing the other meeting types', async () => {
  const request = async (url) =>
    url.endsWith('/meeting-type')
      ? {
          ok: true,
          json: async () => [
            {id: 1, title: 'A'},
            {id: 2, title: 'B'},
          ],
        }
      : url.includes('/1/')
        ? {ok: false, status: 403}
        : {ok: true, json: async () => []};
  const result = await inspectApi(config, request);
  assert.match(result[0].error, /403/);
  assert.equal(result[1].versions, 0);
});
