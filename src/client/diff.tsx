'use client';
import {useMemo} from 'react';
import {lineDiff} from '../shared/change-analysis';
export {lineDiff} from '../shared/change-analysis';
export default function Diff({before, after}: {before: string; after: string}) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const added = lines.filter((l) => l.kind === 'added').length,
    removed = lines.filter((l) => l.kind === 'removed').length;
  return (
    <div>
      <div className="diff-legend">
        <span>+ {added} tilføjede linjer</span>
        <span>− {removed} fjernede linjer</span>
      </div>
      <p className="micro">
        Grønne linjer er tilføjet; røde er fjernet. Linjenumrene henviser til henholdsvis den
        tidligere og den nye fil. Forskelle mellem Windows- og Unix-linjeskift ignoreres her.
      </p>
      <div className="diff-code">
        {lines.map((l, i) => (
          <div key={i} className={l.kind}>
            <span>{l.kind === 'added' ? '+' : l.kind === 'removed' ? '−' : ' '}</span>
            <span className="line-number">{l.kind === 'removed' ? l.beforeLine : l.afterLine}</span>
            <code>{l.text || ' '}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
