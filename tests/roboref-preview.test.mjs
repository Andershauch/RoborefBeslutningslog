import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchHistory, renderPreview} from '../scripts/roboref-preview.mjs';
test('orders histories and renders escaped changes in the two most recent entries', async () => {
  const request = async (url, options) => {
    assert.match(url, /\/147\/history$/);
    assert.equal(options.headers['api-key'], 'test');
    assert.equal(options.redirect, 'error');
    return {
      ok: true,
      json: async () => [
        {validFrom: '2026-10-03T10:00:00Z', instruction: 'Ny <script>x</script>'},
        {validFrom: '2026-10-01T10:00:00Z', instruction: 'Tidlig'},
        {validFrom: '2026-10-02T10:00:00Z', instruction: 'Gammel'},
      ],
    };
  };
  const data = await fetchHistory(
    147,
    {apiKey: 'test', baseUrl: 'https://roboref.example/api/v2'},
    request,
  );
  const html = renderPreview(data, 147);
  assert.match(html, /Gammel/);
  assert.match(html, /Ny &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /Tidlig/);
  assert.match(html, /class="line removed"/);
  assert.match(html, /class="line added"/);
});
test('rejects insufficient or ambiguous history', async () => {
  const make = (items) => async () => ({ok: true, json: async () => items});
  await assert.rejects(
    fetchHistory(
      1,
      {apiKey: 'x', baseUrl: 'https://roboref.example/api/v2'},
      make([{validFrom: '2026-01-01'}]),
    ),
    /færre/,
  );
  await assert.rejects(
    fetchHistory(
      1,
      {apiKey: 'x', baseUrl: 'https://roboref.example/api/v2'},
      make([{validFrom: '2026-01-01'}, {validFrom: '2026-01-01'}]),
    ),
    /samme tidspunkt/,
  );
});
