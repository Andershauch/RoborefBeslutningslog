import {useEffect, useEffectEvent, useState} from 'react';
import Modal from './modal';
import Diff from './diff';
import {Data, date, isArchived, readJson} from './types';
import type {RoborefSource} from './roboref-import';
import {changedAcrossHistory} from './roboref-history';
import {labels, fieldKeys, fieldValue, snapshot} from './roboref-fields';
import type {RoborefHistory} from './roboref-fields';
type Source = {id: number; title: string; validFrom: string; field: string};
type Row = {
  promptId: string;
  promptTitle: string;
  versionId: string;
  source: Source;
  baseline: string;
};
type Hist = RoborefHistory;
type Result = {
  row: Row;
  latest?: Hist;
  base?: Hist;
  fields?: string[];
  steps?: number;
  error?: string;
};

export function linked(data: Data, promptId?: string): Row[] {
  return data.prompts
    .filter((p) => !isArchived(data, p.id) && (!promptId || p.id === promptId))
    .flatMap((p) => {
      const versions = data.versions
        .filter((v) => v.prompt_id === p.id)
        .sort((a, b) => b.number - a.number);
      for (const v of versions) {
        const event = data.events.find((e) => e.version_id === v.id && e.action === 'uploaded');
        let source: Source;
        try {
          source = JSON.parse(event?.detail || '{}').source;
        } catch {
          continue;
        }
        if (!source || !source.id || !source.validFrom) continue;
        const reviews = data.events
          .filter((e) => e.version_id === v.id && e.action === 'roboref_reviewed')
          .map((e) => {
            try {
              return JSON.parse(e.detail);
            } catch {
              return {};
            }
          })
          .filter((x) => x.sourceId === source.id && x.validFrom)
          .sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom));
        return [
          {
            promptId: p.id,
            promptTitle: p.title,
            versionId: v.id,
            source,
            baseline: reviews[0]?.validFrom || source.validFrom,
          },
        ];
      }
      return [];
    });
}
export default function RoborefCheck({
  data,
  onClose,
  onChoose,
  onRefresh,
  promptId,
}: {
  promptId?: string;
  data: Data;
  onClose: () => void;
  onChoose: (source: RoborefSource, promptId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const rows = linked(data, promptId),
    [results, setResults] = useState<Result[] | null>(null),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState<Record<string, string>>({}),
    [message, setMessage] = useState('');
  async function check() {
    setBusy(true);
    setMessage('');
    const out: Result[] = [];
    for (const row of rows) {
      try {
        const r = await fetch('/api/roboref', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({action: 'history', id: row.source.id}),
        });
        const d = await readJson<{error?: string; items: Hist[]}>(r);
        if (!r.ok) throw new Error(d.error);
        const comparison = changedAcrossHistory(
          d.items as Hist[],
          row.baseline,
          fieldKeys(...d.items),
        );
        out.push({
          row,
          ...comparison,
          base: comparison.base as Hist,
          latest: comparison.latest as Hist,
        });
      } catch (e) {
        out.push({row, error: e instanceof Error ? e.message : 'Tjekket mislykkedes.'});
      }
    }
    setResults(out);
    setBusy(false);
  }
  const startCheck = useEffectEvent(() => check());
  useEffect(() => {
    if (!promptId || !rows.length) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return startCheck();
    });
    return () => {
      active = false;
    };
  }, [promptId, rows.length]);
  async function review(r: Result) {
    if (!r.latest) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/log', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: 'review_roboref',
          versionId: r.row.versionId,
          sourceId: r.row.source.id,
          validFrom: r.latest.validFrom,
          fields: r.fields,
          reason: reason[r.row.promptId] || '',
        }),
      });
      const body = await readJson<{error?: string}>(res);
      if (!res.ok) throw new Error(body.error);
      await onRefresh();
      setResults(null);
      setMessage('Gennemgangen er gemt i aktivitetsloggen. Tjek igen for at opdatere oversigten.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Gennemgangen kunne ikke gemmes.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Tjek ændringer i Roboref" onClose={onClose} wide>
      <div className="modal-body">
        <p className="muted">
          {promptId
            ? 'Tjekker kun denne prompts tilknyttede mødetype i Roboref.'
            : 'Tjekker de prompts, som du har registreret fra Roboref. Andre prompts skal først knyttes via import. Kontrollen sker kun, når du trykker på knappen.'}
        </p>
        <p className="micro">
          {promptId ? 'Valgt mødetype' : `${rows.length} tilknyttede prompts`}. Nøglen læses fra
          opsætningen i filen .env på din computer.
        </p>
        <button
          className="button primary"
          disabled={!rows.length || busy}
          onClick={() => void check()}
        >
          {busy ? 'Kontrollerer…' : 'Tjek for ændringer'}
        </button>
        {message && <p role="status">{message}</p>}
        {results?.map((r) => (
          <section className="automatic-changes" key={r.row.promptId}>
            <h3>{r.row.promptTitle}</h3>
            <p className="micro">
              Roboref: {r.row.source.title} · ID {r.row.source.id} · sidst taget stilling til{' '}
              {date(r.row.baseline, true)}
            </p>
            {r.error ? (
              <p className="error">{r.error}</p>
            ) : !r.steps ? (
              <p>Ingen nyere historiske poster.</p>
            ) : (
              <>
                <p>
                  <strong>
                    {r.steps} nyere {r.steps === 1 ? 'historisk post' : 'historiske poster'}
                  </strong>{' '}
                  · seneste {date(r.latest!.validFrom, true)}
                </p>
                <p>
                  {r.fields?.length
                    ? 'Ændrede felter: ' + r.fields.map((f) => labels[f] || f).join(', ')
                    : 'Ingen forskel i de undersøgte felter.'}
                </p>
                {r.steps! > 1 && (
                  <p className="micro">
                    Flere poster er fundet. Sammenligningen viser start og slut; ændringer undervejs
                    kan være tilbageført.
                  </p>
                )}
                {r.fields?.map((field) => (
                  <details key={field}>
                    <summary>Se {labels[field] || field}</summary>
                    <Diff before={fieldValue(r.base, field)} after={fieldValue(r.latest, field)} />
                  </details>
                ))}
                <p className="micro">
                  Den seneste historiske posts felter gemmes samlet ved registrering.
                </p>
                <button
                  className="button secondary small"
                  disabled={busy || !r.latest?.instruction?.trim()}
                  onClick={() => {
                    const v = r.latest!;
                    onChoose(
                      {
                        id: r.row.source.id,
                        title: v.title || r.row.source.title,
                        validFrom: v.validFrom,
                        validTo: v.validTo,
                        field: 'meetingType',
                        content: snapshot(v),
                      },
                      r.row.promptId,
                    );
                  }}
                >
                  Registrer mødetypen som ny version
                </button>
                <label className="field">
                  Eller dokumentér din gennemgang uden at oprette en version
                  <textarea
                    value={reason[r.row.promptId] || ''}
                    onChange={(e) => setReason({...reason, [r.row.promptId]: e.target.value})}
                    placeholder="Hvad har du gennemgået og besluttet?"
                  />
                </label>
                <button
                  className="button secondary small"
                  disabled={busy || (reason[r.row.promptId] || '').trim().length < 3}
                  onClick={() => void review(r)}
                >
                  Gem gennemgang
                </button>
              </>
            )}
          </section>
        ))}
      </div>
      <footer className="modal-footer">
        <button className="button ghost" onClick={onClose}>
          Luk
        </button>
      </footer>
    </Modal>
  );
}
