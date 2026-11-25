import {useState} from 'react';
import {Data, date, isArchived, readJson} from './types';
import Modal from './modal';
import Diff from './diff';
import type {RoborefSource} from './roboref-import';
import {fieldKeys, fieldValue, labels} from './roboref-fields';
import {snapshot} from './roboref-fields';
import type {RoborefHistory} from './roboref-fields';
type Meeting = {id: number; title: string; isDraft: boolean; teams: string[]};
type History = RoborefHistory;
type Selection = {
  meeting: Meeting;
  history: History[];
  index: number;
  department: string;
  version: string;
  error?: string;
  status?: string;
};
export default function RoborefSelection({
  data,
  user,
  onClose,
  onRefresh,
  onChoose,
}: {
  data: Data;
  user: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onChoose: (source: RoborefSource, promptId: string) => void;
}) {
  const [meetings, setMeetings] = useState<Meeting[]>([]),
    [query, setQuery] = useState(''),
    [team, setTeam] = useState('all'),
    [selected, setSelected] = useState<Record<number, Selection>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const registered = new Set<number>();
  const registeredPrompt = new Map<number, string>();
  for (const e of data.events) {
    if (e.action !== 'uploaded') continue;
    try {
      const s = JSON.parse(e.detail).source;
      if (s?.system === 'Roboref' && s.id) {
        registered.add(s.id);
        if (!registeredPrompt.has(s.id)) registeredPrompt.set(s.id, e.prompt_id);
      }
    } catch {
      /* fejlen vises via error-tilstanden */
    }
  }
  const teams = Array.from(new Set(meetings.flatMap((m) => m.teams))).sort((a, b) =>
    a.localeCompare(b, 'da'),
  );
  async function api(body: object) {
    const r = await fetch('/api/roboref', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    const d = await readJson<{error?: string; items: unknown[]}>(r);
    if (!r.ok) throw new Error(d.error || 'Forespørgslen fejlede.');
    return d.items;
  }
  async function load() {
    setBusy(true);
    setError('');
    try {
      setMeetings((await api({action: 'list'})) as Meeting[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente oversigten.');
    } finally {
      setBusy(false);
    }
  }
  async function add(m: Meeting) {
    if (selected[m.id]) {
      setSelected((s) => {
        const n = {...s};
        delete n[m.id];
        return n;
      });
      return;
    }
    setBusy(true);
    setError('');
    try {
      const h = (await api({action: 'history', id: m.id})) as History[];
      if (!h.length) throw new Error('Mødetypen har ingen historiske instruktioner.');
      const match = m.title.match(/(?:^|\s)v(?:ersion)?\s*(\d+)\s*$/i);
      setSelected((s) => ({
        ...s,
        [m.id]: {
          meeting: m,
          history: h,
          index: 0,
          department: m.teams.length === 1 ? m.teams[0] : '',
          version: match?.[1] || '1',
        },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Historikken kunne ikke hentes.');
    } finally {
      setBusy(false);
    }
  }
  function update(id: number, changes: Partial<Selection>) {
    setSelected((s) => ({...s, [id]: {...s[id], ...changes}}));
  }
  async function save() {
    setBusy(true);
    setError('');
    setMessage('');
    let done = 0;
    const next = {...selected};
    for (const item of Object.values(selected)) {
      if (item.status === 'Oprettet') continue;
      if (registered.has(item.meeting.id)) {
        next[item.meeting.id] = {
          ...item,
          error: 'Allerede registreret. Vælg Fortsæt med denne for at registrere en version.',
        };
        setSelected({...next});
        continue;
      }
      const h = item.history[item.index];
      try {
        if (
          !item.department.trim() ||
          !item.version ||
          !Number.isInteger(Number(item.version)) ||
          Number(item.version) < 1 ||
          !h?.instruction.trim()
        )
          throw new Error('Udfyld fagområde og et gyldigt versionsnummer, og vælg en instruktion.');
        const source = {
          system: 'Roboref',
          id: item.meeting.id,
          title: item.meeting.title,
          validFrom: h.validFrom,
          validTo: h.validTo,
          field: 'meetingType',
        };
        const body = {
          action: 'upload',
          filename: `Roboref-${item.meeting.id}.md`,
          content: snapshot(h),
          title: item.meeting.title,
          meetingType: item.meeting.title,
          department: item.department,
          owner: user,
          initialVersion: Number(item.version),
          purpose: 'Ikke oplyst ved import fra Roboref.',
          changes: 'Mødetypens felter blev hentet fra en valgt historisk post i Roboref.',
          reason: 'Ikke oplyst ved import fra Roboref.',
          outcome: 'Ikke oplyst ved import fra Roboref.',
          rationale: 'Ikke oplyst ved import fra Roboref.',
          source,
        };
        const r = await fetch('/api/log', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
        });
        const result = await readJson<{error?: string}>(r);
        if (!r.ok) throw new Error(result.error);
        next[item.meeting.id] = {...item, status: 'Oprettet', error: undefined};
        done++;
      } catch (e) {
        next[item.meeting.id] = {
          ...item,
          error: e instanceof Error ? e.message : 'Kunne ikke oprettes.',
        };
      }
      setSelected({...next});
    }
    await onRefresh();
    setMessage(
      `${done} prompt(er) oprettet som kladder. Tidligere begrundelser og ibrugtagning er ikke oplyst.`,
    );
    setBusy(false);
  }
  const visible = meetings.filter(
    (m) =>
      (team === 'all' || (team === 'none' ? m.teams.length === 0 : m.teams.includes(team))) &&
      (m.title + ' ' + m.id).toLocaleLowerCase('da-DK').includes(query.toLocaleLowerCase('da-DK')),
  );
  return (
    <Modal
      title="Hent fra Roboref"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="modal-body">
        <p>
          Hent oversigten, filtrér efter afdeling, og markér de konkrete mødetyp­er, du vil oprette.
          For hver kan du vælge en historisk post og et fagområde. Eksisterende tilknytninger er
          markeret. Du kan oprette flere nye som kladder eller vælge Fortsæt med denne for at
          registrere én version med begrundelse.
        </p>
        <p className="micro">
          Den valgte historiske posts felter hentes samlet. Hvert valg oprettes som kladde; formål,
          begrundelser og ibrugtagning står som ikke oplyst, og ansvarlig sættes til den lokale
          bruger. Historiske poster og navngivne versioner er ikke nødvendigvis det samme. Tjek, at
          felterne (fx eksempler) ikke indeholder oplysninger om borgere, før du opretter dem.
        </p>
        <button className="button secondary" disabled={busy} onClick={() => void load()}>
          {busy ? 'Arbejder…' : 'Hent oversigt fra Roboref'}
        </button>
        {!!meetings.length && (
          <>
            <div className="form-grid">
              <label className="field">
                Søg
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Navn eller ID"
                />
              </label>
              <label className="field">
                Afdeling i Roboref
                <select value={team} onChange={(e) => setTeam(e.target.value)}>
                  <option value="all">Alle afdelinger</option>
                  <option value="none">Ingen afdeling angivet</option>
                  {teams.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="micro">
              {visible.length} mødetyp­er vises · {Object.keys(selected).length} valgt
            </p>
            <div
              style={{
                maxHeight: 300,
                overflow: 'auto',
                border: '1px solid #e2e8df',
                borderRadius: 8,
                padding: 12,
              }}
            >
              {visible.map((m) => (
                <label key={m.id} className="check-field">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={!!selected[m.id]}
                    onChange={() => void add(m)}
                  />
                  <span>
                    {m.title} · ID {m.id}
                    {m.isDraft ? ' · kladde' : ''}
                    {registered.has(m.id) ? ' · allerede registreret' : ''}
                    <small> · {m.teams.join(', ') || 'Ingen afdeling oplyst'}</small>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        {Object.values(selected).map((item) => (
          <section key={item.meeting.id} className="automatic-changes">
            <strong>
              {item.meeting.title} · ID {item.meeting.id}
            </strong>
            <label className="field">
              Historisk post
              <select
                disabled={busy || !!item.status}
                value={item.index}
                onChange={(e) => update(item.meeting.id, {index: Number(e.target.value)})}
              >
                {item.history.map((h, i) => (
                  <option key={i} value={i}>
                    {date(h.validFrom, true)}
                    {i === 0 ? ' · seneste' : ''}
                    {h.isDraft ? ' · kladde' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label className="field">
                Fagområde i beslutningsloggen
                <input
                  list={'team-' + item.meeting.id}
                  disabled={busy || !!item.status}
                  value={item.department}
                  onChange={(e) => update(item.meeting.id, {department: e.target.value})}
                />
                <datalist id={'team-' + item.meeting.id}>
                  {item.meeting.teams.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                Første lokale versionsnummer
                <input
                  type="number"
                  min="1"
                  max="99999"
                  disabled={busy || !!item.status}
                  value={item.version}
                  onChange={(e) => update(item.meeting.id, {version: e.target.value})}
                />
              </label>
            </div>
            <details className="file-preview">
              <summary>Se valgt mødetype</summary>
              <pre>{snapshot(item.history[item.index])}</pre>
            </details>
            {item.history[item.index + 1] && (
              <details>
                <summary>Se ændringer siden foregående historiske post</summary>
                {fieldKeys(item.history[item.index], item.history[item.index + 1])
                  .filter(
                    (k) =>
                      JSON.stringify(item.history[item.index][k]) !==
                      JSON.stringify(item.history[item.index + 1][k]),
                  )
                  .map((k) => (
                    <details key={k}>
                      <summary>{labels[k] || k}</summary>
                      <Diff
                        before={fieldValue(item.history[item.index + 1], k)}
                        after={fieldValue(item.history[item.index], k)}
                      />
                    </details>
                  ))}
              </details>
            )}
            {registeredPrompt.has(item.meeting.id) &&
              isArchived(data, registeredPrompt.get(item.meeting.id)!) && (
                <p className="micro">
                  Prompten er arkiveret. Gendan den fra Arkiv, før du registrerer en ny version.
                </p>
              )}
            <button
              type="button"
              className="button secondary small"
              disabled={
                busy ||
                !!item.status ||
                !item.history[item.index]?.instruction.trim() ||
                !!(
                  registeredPrompt.has(item.meeting.id) &&
                  isArchived(data, registeredPrompt.get(item.meeting.id)!)
                )
              }
              onClick={() => {
                const h = item.history[item.index];
                onChoose(
                  {
                    id: item.meeting.id,
                    title: item.meeting.title,
                    validFrom: h.validFrom,
                    validTo: h.validTo,
                    field: 'meetingType',
                    content: snapshot(h),
                    department: item.department,
                    initialVersion: Number(item.version) || 1,
                  },
                  registeredPrompt.get(item.meeting.id) || '',
                );
              }}
            >
              Fortsæt med denne og skriv begrundelse
            </button>
            {item.status && <p>{item.status}</p>}
            {item.error && (
              <p className="error" role="alert">
                {item.error}
              </p>
            )}
          </section>
        ))}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </div>
      <footer className="modal-footer">
        <button className="button ghost" disabled={busy} onClick={onClose}>
          Luk
        </button>
        <button
          className="button primary"
          disabled={
            busy || !Object.values(selected).some((s) => !s.status && !registered.has(s.meeting.id))
          }
          onClick={() => void save()}
        >
          Opret valgte som kladder
        </button>
      </footer>
    </Modal>
  );
}
