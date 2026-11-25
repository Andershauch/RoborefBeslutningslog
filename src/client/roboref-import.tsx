import {useState} from 'react';
import Modal from './modal';
import Diff from './diff';
import {date, readJson} from './types';
import {snapshot, fieldKeys, fieldValue, labels} from './roboref-fields';
import type {RoborefHistory} from './roboref-fields';
export type RoborefSource = {
  id: number;
  title: string;
  validFrom: string;
  validTo: string | null;
  field: 'instruction' | 'meetingType';
  content: string;
  department?: string;
  initialVersion?: number;
};
type Meeting = {id: number; title: string; isDraft: boolean};
type History = RoborefHistory;
export default function RoborefImport({
  onClose,
  onChoose,
}: {
  onClose: () => void;
  onChoose: (source: RoborefSource) => void;
}) {
  const [query, setQuery] = useState(''),
    [items, setItems] = useState<Meeting[]>([]),
    [id, setId] = useState(''),
    [history, setHistory] = useState<History[]>([]),
    [index, setIndex] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function call<T>(action: string, selectedId?: number): Promise<T[] | null> {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/roboref', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action, id: selectedId}),
      });
      const data = await readJson<{error?: string; items: unknown[]}>(r);
      if (!r.ok)
        throw new Error(
          r.status === 404
            ? 'En tidligere version af appens server kører stadig. Luk det gamle startvindue, og start appen igen.'
            : data.error,
        );
      return data.items as T[];
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Forbindelsen fejlede.');
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    const result = await call<Meeting>('list');
    if (result) {
      setItems(result);
      setHistory([]);
      setId('');
    }
  }
  async function select(value: string) {
    setId(value);
    setHistory([]);
    setIndex(0);
    if (value) {
      const result = await call<History>('history', Number(value));
      if (result) setHistory(result);
    }
  }
  const item = history[index],
    older = history[index + 1],
    meeting = items.find((x) => x.id === Number(id));
  return (
    <Modal title="Hent fra Roboref · prøve" onClose={onClose} wide>
      <div className="modal-body">
        <p className="muted">
          1. Hent oversigten. 2. Søg efter og vælg en mødetype. 3. Vælg en historisk post og fortsæt
          til registrering. Appen henter den valgte historiske posts felter og gemmer dem samlet.
        </p>
        <button className="button secondary" disabled={busy} onClick={() => void load()}>
          {busy ? 'Henter…' : 'Hent mødetypeoversigt'}
        </button>
        {!!items.length && (
          <>
            <label className="field">
              Søg efter mødetype
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Skriv navn eller ID"
              />
            </label>
            <label className="field">
              Mødetype
              <select value={id} disabled={busy} onChange={(e) => void select(e.target.value)}>
                <option value="">Vælg mødetype</option>
                {items
                  .filter((m) =>
                    (m.title + ' ' + m.id)
                      .toLocaleLowerCase('da-DK')
                      .includes(query.toLocaleLowerCase('da-DK')),
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} · ID {m.id}
                      {m.isDraft ? ' · kladde' : ''}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        {id && !busy && !history.length && !error && (
          <p>Ingen historiske poster med instruktion og dato blev fundet.</p>
        )}
        {!!history.length && (
          <>
            <label className="field">
              Historisk post
              <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
                {history.map((v, i) => (
                  <option key={i} value={i}>
                    {date(v.validFrom, true)}
                    {i === 0 ? ' · seneste' : ''}
                    {v.isDraft ? ' · kladde' : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="micro">
              Tidspunktet er Roborefs validFrom. Det er ikke en bekræftelse på faktisk ibrugtagning.
              Historiske poster er ikke nødvendigvis navngivne versioner.
            </p>
            {item && older ? (
              <>
                <h3>Ændringer siden den foregående historiske post</h3>
                {fieldKeys(item, older)
                  .filter((k) => JSON.stringify(item[k]) !== JSON.stringify(older[k]))
                  .map((k) => (
                    <details key={k}>
                      <summary>{labels[k] || k}</summary>
                      <Diff before={fieldValue(older, k)} after={fieldValue(item, k)} />
                    </details>
                  ))}
              </>
            ) : (
              <p>Der er ingen tidligere post at sammenligne med.</p>
            )}
            {item && (
              <details className="file-preview">
                <summary>Se hele den valgte mødetype</summary>
                <pre>{snapshot(item)}</pre>
              </details>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <button className="button ghost" type="button" onClick={onClose}>
          Annuller
        </button>
        <button
          className="button primary"
          disabled={!item || !item.instruction.trim() || busy}
          onClick={() => {
            if (item && meeting)
              onChoose({
                id: meeting.id,
                title: meeting.title,
                validFrom: item.validFrom,
                validTo: item.validTo,
                field: 'meetingType',
                content: snapshot(item),
              });
          }}
        >
          Fortsæt til registrering
        </button>
      </footer>
    </Modal>
  );
}
