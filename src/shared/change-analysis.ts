export type DiffLine = {
  kind: 'same' | 'added' | 'removed';
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
};
export type ComparisonBasis = {
  baseVersionId: string;
  baseVersionNumber: number;
  baseKind: 'active' | 'latest';
  method: 'line-diff-v1';
  addedLines: number;
  removedLines: number;
  onlyLineEndings: boolean;
  coarse: boolean;
};
type RawLine = {kind: DiffLine['kind']; text: string};

function compareLines(before: string, after: string): {lines: DiffLine[]; coarse: boolean} {
  const a = before.replace(/\r\n/g, '\n').split('\n'),
    b = after.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let ae = a.length,
    be = b.length;
  while (ae > start && be > start && a[ae - 1] === b[be - 1]) {
    ae--;
    be--;
  }
  const result: RawLine[] = a.slice(0, start).map((text) => ({kind: 'same', text}));
  const x = a.slice(start, ae),
    y = b.slice(start, be),
    coarse = x.length * y.length > 800000;
  if (coarse) {
    for (const text of x) result.push({kind: 'removed', text});
    for (const text of y) result.push({kind: 'added', text});
  } else {
    const grid = Array.from({length: x.length + 1}, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        grid[i][j] =
          x[i] === y[j] ? grid[i + 1][j + 1] + 1 : Math.max(grid[i + 1][j], grid[i][j + 1]);
    let i = 0,
      j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        result.push({kind: 'same', text: x[i++]});
        j++;
      } else if (j < y.length && (i === x.length || grid[i][j + 1] > grid[i + 1][j]))
        result.push({kind: 'added', text: y[j++]});
      else result.push({kind: 'removed', text: x[i++]});
    }
  }
  for (const text of a.slice(ae)) result.push({kind: 'same', text});
  let oldLine = 0,
    newLine = 0;
  return {
    coarse,
    lines: result.map((line) => ({
      ...line,
      beforeLine: line.kind === 'added' ? null : ++oldLine,
      afterLine: line.kind === 'removed' ? null : ++newLine,
    })),
  };
}
export function lineDiff(before: string, after: string): DiffLine[] {
  return compareLines(before, after).lines;
}
export function analyzeChanges(
  before: string,
  after: string,
  {baseNumber, baseKind}: {baseNumber: number; baseKind: 'active' | 'latest'},
) {
  const {lines, coarse} = compareLines(before, after),
    added = lines.filter((l) => l.kind === 'added'),
    removed = lines.filter((l) => l.kind === 'removed');
  const sections = new Set<string>();
  let oldSection = 'Uden afsnitsoverskrift',
    newSection = 'Uden afsnitsoverskrift';
  for (const line of lines) {
    const heading =
      line.text.match(/^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/)?.[1] ||
      line.text.match(/^\*\*([^*]+)\*\*\s*$/)?.[1];
    if (line.kind !== 'added' && heading) oldSection = heading;
    if (line.kind !== 'removed' && heading) newSection = heading;
    if (line.kind === 'added') sections.add(newSection);
    if (line.kind === 'removed') sections.add(oldSection);
  }
  const onlyLineEndings = !added.length && !removed.length && before !== after;
  const baseLabel = `v${baseNumber} (${baseKind === 'active' ? 'gældende ved sammenligningen' : 'seneste kladde; ingen gældende version'})`;
  const summary = [
    `Automatisk sammenligning med ${baseLabel}.`,
    `${added.length} tilføjede linjer · ${removed.length} fjernede linjer.`,
  ];
  if (onlyLineEndings) summary.push('Kun linjeskift er ændret. Tekstindholdet er det samme.');
  if (!added.length && !removed.length && !onlyLineEndings) summary.push('Ingen tekstændringer.');
  if (sections.size) {
    const titles = Array.from(sections);
    summary.push(
      'Berørte afsnit: ' +
        titles
          .slice(0, 8)
          .map((t) => (t.length > 140 ? t.slice(0, 140) + '…' : t))
          .join(' · ') +
        (titles.length > 8 ? ' · …' : '') +
        '.',
    );
  }
  let shortened = false;
  for (const [label, entries, sign] of [
    ['Fjernet fra den tidligere version', removed, '−'],
    ['Tilføjet i denne version', added, '+'],
  ] as const) {
    if (!entries.length) continue;
    summary.push('', label + ':');
    for (const line of entries.slice(0, 6)) {
      const value = line.text || '(tom linje)';
      if (value.length > 400) shortened = true;
      summary.push(
        `${sign} Linje ${line.kind === 'removed' ? line.beforeLine : line.afterLine}: ${value.length > 400 ? value.slice(0, 400) + '…' : value}`,
      );
    }
    if (entries.length > 6) {
      summary.push(`… og ${entries.length - 6} yderligere linjer.`);
      shortened = true;
    }
  }
  if (shortened) summary.push('Dette er et uddrag. Alle tekstændringer kan ses under Ændringer.');
  if (coarse)
    summary.push(
      'Store ændringsblokke vises samlet; uændrede linjer inde i blokken kan være medmarkeret.',
    );
  return {
    summary: summary.join('\n'),
    addedLines: added.length,
    removedLines: removed.length,
    sections: Array.from(sections),
    onlyLineEndings,
    coarse,
    method: 'line-diff-v1' as const,
  };
}
