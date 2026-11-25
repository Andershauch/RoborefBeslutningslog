import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lineDiff, analyzeChanges} from '../src/shared/change-analysis.ts';
const options = {baseNumber: 16, baseKind: 'active'};
test('a changed instruction is recorded verbatim with its section and old/new line numbers', () => {
  const result = analyzeChanges(
    '### Aftaler\nHøjst 4 punkter.\n',
    '### Aftaler\nHøjst 3 punkter.\n',
    options,
  );
  assert.equal(result.addedLines, 1);
  assert.equal(result.removedLines, 1);
  assert.deepEqual(result.sections, ['Aftaler']);
  assert.ok(result.summary.includes('Linje 2: Højst 4 punkter.'));
  assert.ok(result.summary.includes('Linje 2: Højst 3 punkter.'));
  assert.ok(result.summary.includes('v16'));
  assert.equal(result.coarse, false);
});
test('adding, removing and moving lines still reconstructs both exact normalized inputs', () => {
  for (const [before, after] of [
    ['a\nb\na\n', 'a\na\nb\n'],
    ['old', ''],
    ['', 'new'],
    ['\n\n', '\n'],
    ['a\r\nb\r\n', 'a\nb\n'],
  ]) {
    const lines = lineDiff(before, after);
    assert.equal(
      lines
        .filter((l) => l.kind !== 'added')
        .map((l) => l.text)
        .join('\n'),
      before.replace(/\r\n/g, '\n'),
    );
    assert.equal(
      lines
        .filter((l) => l.kind !== 'removed')
        .map((l) => l.text)
        .join('\n'),
      after.replace(/\r\n/g, '\n'),
    );
  }
});
test('line ending changes are explicitly distinguished from changes to instructions', () => {
  const result = analyzeChanges('# Prompt\r\nTekst.\r\n', '# Prompt\nTekst.\n', options);
  assert.equal(result.addedLines, 0);
  assert.equal(result.removedLines, 0);
  assert.equal(result.onlyLineEndings, true);
  assert.ok(result.summary.includes('Kun linjeskift'));
});
test('large replacement blocks and abbreviated summaries say clearly that they are abbreviated', () => {
  const before = Array.from({length: 1000}, (_, i) => 'Old ' + i).join('\n'),
    after = Array.from({length: 1000}, (_, i) => 'New ' + i).join('\n');
  const result = analyzeChanges(before, after, options);
  assert.equal(result.coarse, true);
  assert.equal(result.addedLines, 1000);
  assert.equal(result.removedLines, 1000);
  assert.ok(result.summary.includes('uddrag'));
  assert.ok(result.summary.includes('medmarkeret'));
  assert.ok(result.summary.length < 12000);
});
test('a file with many short lines does not overflow the call stack', () => {
  const result = analyzeChanges('Old', Array.from({length: 70000}, () => '.').join('\n'), options);
  assert.equal(result.addedLines, 70000);
  assert.equal(result.removedLines, 1);
});
