import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changedAcrossHistory} from '../src/client/roboref-history.ts';
test('detects an intermediate change even if the final value is restored', () => {
  const history = [
    {validFrom: '2026-03-01T00:00:00Z', instruction: 'A'},
    {validFrom: '2026-02-01T00:00:00Z', instruction: 'B'},
    {validFrom: '2026-01-01T00:00:00Z', instruction: 'A'},
  ];
  const result = changedAcrossHistory(history, '2026-01-01T00:00:00Z', ['instruction']);
  assert.deepEqual(result.fields, ['instruction']);
  assert.equal(result.steps, 2);
  assert.throws(
    () => changedAcrossHistory(history, '2025-01-01T00:00:00Z', ['instruction']),
    /tidligere post/,
  );
});
