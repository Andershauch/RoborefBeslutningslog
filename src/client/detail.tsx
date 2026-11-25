'use client';
import {useEffect, useState} from 'react';
import {
  ArrowLeft,
  Upload,
  Download,
  FileText,
  CheckCircle2,
  History,
  GitCompareArrows,
  Info,
  ChevronRight,
} from 'lucide-react';
import {
  Data,
  Prompt,
  date,
  today,
  download,
  comparisonFor,
  isArchived,
  rejectionFor,
  readJson,
} from './types';
import Modal from './modal';
import Diff from './diff';
export default function Detail({
  prompt: p,
  data,
  onBack,
  onUpload,
  onRefresh,
  onNotice,
  onCheck,
}: {
  onCheck?: () => void;
  prompt: Prompt;
  data: Data;
  onBack: () => void;
  onUpload: () => void;
  onRefresh: () => Promise<void>;
  onNotice: (s: string) => void;
}) {
  const versions = data.versions
    .filter((v) => v.prompt_id === p.id)
    .sort((a, b) => b.number - a.number);
  const [versionId, setVersionId] = useState(p.active_version_id || versions[0]?.id || ''),
    [tab, setTab] = useState('decision'),
    [content, setContent] = useState(''),
    [previousContent, setPreviousContent] = useState(''),
    [loadedKey, setLoadedKey] = useState(''),
    [error, setError] = useState(''),
    [approval, setApproval] = useState(false),
    [rejecting, setRejecting] = useState(false),
    [rejectReason, setRejectReason] = useState(''),
    [effective, setEffective] = useState(''),
    [unknown, setUnknown] = useState(false),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [compareId, setCompareId] = useState('');
  const version = versions.find((v) => v.id === versionId) || versions[0],
    active = versions.find((v) => v.id === p.active_version_id),
    previous = versions.find((v) => v.number < (version?.number || 0)),
    comparison = comparisonFor(data, version?.id || ''),
    compare = versions.find(
      (v) => v.id === (compareId || comparison?.baseVersionId || previous?.id),
    );
  const compareVersionId = compare?.id;
  const loadKey = [version?.id || '', tab, compareVersionId || ''].join(':');
  const loading = loadedKey !== loadKey;
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const ids = [
          version?.id,
          ...(tab === 'diff' && compareVersionId ? [compareVersionId] : []),
        ].filter(Boolean);
        const values = await Promise.all(
          ids.map(async (id) => {
            const r = await fetch('/api/content?id=' + encodeURIComponent(id!));
            const value = await readJson<{error?: string; content: string}>(r);
            if (!r.ok) throw new Error(value.error);
            return value.content;
          }),
        );
        if (!cancelled) {
          setContent(values[0] || '');
          setPreviousContent(values[1] || '');
          setError('');
          setLoadedKey(loadKey);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Kunne ikke hente filen.');
          setLoadedKey(loadKey);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [version?.id, tab, compareVersionId, loadKey]);
  async function approve(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/log', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: 'approve',
          versionId: version.id,
          effectiveDate: unknown ? '' : effective,
          confirmation,
        }),
      });
      const result = await readJson<{error?: string}>(r);
      if (!r.ok) throw new Error(result.error);
      setApproval(false);
      await onRefresh();
      onNotice('Version ' + version.number + ' er godkendt og registreret som gældende.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Godkendelsen mislykkedes.');
    } finally {
      setBusy(false);
    }
  }
  async function reject(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/log', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'reject', versionId: version.id, reason: rejectReason}),
      });
      const result = await readJson<{error?: string}>(r);
      if (!r.ok) throw new Error(result.error);
      setRejecting(false);
      await onRefresh();
      onNotice('Version ' + version.number + ' er afvist. Begrundelsen er gemt.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Afvisningen mislykkedes.');
    } finally {
      setBusy(false);
    }
  }
  if (!version) return <div className="empty">Ingen versioner registreret.</div>;
  async function toggleArchive() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/log', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: isArchived(data, p.id) ? 'restore' : 'archive',
          promptId: p.id,
        }),
      });
      const result = await readJson<{error?: string}>(r);
      if (!r.ok) throw new Error(result.error);
      await onRefresh();
      onNotice(
        isArchived(data, p.id)
          ? 'Prompten er gendannet.'
          : 'Prompten er arkiveret. Historikken er bevaret.',
      );
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Handlingen kunne ikke udføres.');
    } finally {
      setBusy(false);
    }
  }
  let source: {system: string; id: number; title: string; field: string; validFrom: string} | null =
    null;
  try {
    source =
      JSON.parse(
        data.events.find((e) => e.version_id === version.id && e.action === 'uploaded')?.detail ||
          '{}',
      ).source || null;
  } catch {
    /* ugyldig detalje: vis ingen ekstra oplysninger */
  }
  const rejection = rejectionFor(data, version.id);
  const status = isArchived(data, p.id)
    ? 'Arkiveret'
    : rejection
      ? 'Afvist'
      : version.id === p.active_version_id
        ? 'Gældende'
        : version.approved_at
          ? 'Tidligere version'
          : active && version.number < active.number
            ? 'Ikke taget i brug'
            : 'Kladde';
  const relevantEvents = data.events.filter((e) => e.prompt_id === p.id);
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} />
        Tilbage til prompts
      </button>
      <div className="page-heading detail-heading">
        <div>
          <div className="eyebrow">
            {p.department} <span>/</span> {p.meeting_type}
          </div>
          <h1>{p.title}</h1>
          <p>{p.purpose}</p>
        </div>
        <div>
          {onCheck && !isArchived(data, p.id) && (
            <button className="button secondary" onClick={onCheck}>
              Tjek for ændringer
            </button>
          )}{' '}
          <button
            className="button secondary"
            title="Arkivering skjuler prompten her og bevarer historikken. Den ændrer ikke mødetypen i Roboref."
            disabled={busy}
            onClick={() => void toggleArchive()}
          >
            {isArchived(data, p.id) ? 'Gendan fra arkiv' : 'Arkivér prompt'}
          </button>{' '}
          {!isArchived(data, p.id) && (
            <button className="button primary" onClick={onUpload}>
              <Upload size={17} />
              Upload ny version
            </button>
          )}
        </div>
      </div>
      <p className="micro">
        Arkivering skjuler prompten i denne app og bevarer hele historikken. Mødetypen i Roboref
        ændres ikke.
      </p>
      <div className="detail-metadata">
        <span>
          <small>Fagligt ansvarlig</small>
          <strong>{p.owner}</strong>
        </span>
        <span>
          <small>Gældende version</small>
          <strong>{active ? 'v' + active.number : 'Afventer godkendelse'}</strong>
        </span>
        <span>
          <small>I brug fra</small>
          <strong>{date(active?.effective_date || null)}</strong>
        </span>
        <span>
          <small>Først registreret</small>
          <strong>{date(p.created_at)}</strong>
        </span>
      </div>
      <div className="detail-grid">
        <aside className="version-panel">
          <div className="section-title">
            <h3>Versionshistorik</h3>
            <span>{versions.length}</span>
          </div>
          <p className="micro">Alle upload bevares.</p>
          <div className="version-list">
            {versions.map((v) => (
              <button
                key={v.id}
                className={v.id === version.id ? 'selected' : ''}
                onClick={() => {
                  setVersionId(v.id);
                  setCompareId('');
                  setError('');
                }}
              >
                <div>
                  <b>Version {v.number}</b>
                  <span
                    className={
                      'badge ' +
                      (v.id === p.active_version_id ? 'green' : v.approved_at ? 'gray' : 'amber')
                    }
                  >
                    {rejectionFor(data, v.id)
                      ? 'Afvist'
                      : v.id === p.active_version_id
                        ? 'Gældende'
                        : v.approved_at
                          ? 'Historik'
                          : active && v.number < active.number
                            ? 'Ikke anvendt'
                            : 'Kladde'}
                  </span>
                </div>
                <small>{date(v.created_at)}</small>
                <p>{v.changes}</p>
              </button>
            ))}
          </div>
          <div className="version-note">
            <History size={17} />
            <p>
              Historikken starter ved v{Math.min(...versions.map((v) => v.number))}. Eventuelle
              tidligere versioner er ikke registreret her.
            </p>
          </div>
        </aside>
        <section className="detail-card">
          <div className="version-heading">
            <div>
              <span className="version large">v{version.number}</span>
              <div>
                <h2>Version {version.number}</h2>
                <p>
                  Uploadet {date(version.created_at, true)} · {version.author_name}
                </p>
              </div>
            </div>
            <span
              className={
                'badge ' +
                (status === 'Gældende' ? 'green' : status === 'Kladde' ? 'amber' : 'gray')
              }
            >
              {status}
            </span>
          </div>
          <nav className="tabs" aria-label="Versionsoplysninger">
            {[
              ['decision', 'Beslutning', CheckCircle2],
              ['content', 'Prompt', FileText],
              ['diff', 'Ændringer', GitCompareArrows],
              ['history', 'Aktivitetslog', History],
            ].map(([key, label, Icon]) => {
              const I = Icon as typeof FileText;
              return (
                <button
                  key={key as string}
                  className={tab === key ? 'active' : ''}
                  onClick={() => setTab(key as string)}
                >
                  <I size={16} />
                  {label as string}
                </button>
              );
            })}
          </nav>
          <div className="detail-content">
            {error && !approval && !rejecting && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {source && (
              <div className="info-box">
                <Info size={18} />
                <span>
                  Kilde: {source.system}, {source.title} (ID {source.id}),{' '}
                  {source.field === 'meetingType' ? 'mødetype' : 'instruktion'} fra historisk post{' '}
                  {date(source.validFrom, true)}. Dette tidspunkt er ikke bekræftet som
                  ibrugtagningsdato.
                </span>
              </div>
            )}
            {source?.field === 'instruction' && (
              <p className="micro">
                Denne ældre registrering indeholder kun instruktionen. Øvrige Roboref-felter blev
                ikke gemt. Hent mødetypen igen for at registrere alle tilgængelige felter.
              </p>
            )}
            {tab === 'decision' && (
              <>
                <div className="decision-grid">
                  {[
                    [
                      comparison ? 'Automatisk registrerede ændringer' : 'Hvad er ændret?',
                      version.changes,
                    ],
                    ['Hvorfor?', version.reason],
                    ['Forventet effekt', version.outcome],
                    ['Faglig begrundelse', version.rationale],
                  ].map(([label, value], i) => (
                    <section key={label}>
                      <span className="decision-number">0{i + 1}</span>
                      <h3>{label}</h3>
                      <p>{value}</p>
                    </section>
                  ))}
                </div>
                <div className="approval-record">
                  {rejection ? (
                    <>
                      <Info size={21} />
                      <div>
                        <strong>Afvist af {rejection.actor_name}</strong>
                        <p>
                          {date(rejection.occurred_at, true)} ·{' '}
                          {JSON.parse(rejection.detail).reason}
                        </p>
                        <p>
                          En afvist version kan ikke godkendes. Registrér en ændret version for at
                          fortsætte.
                        </p>
                      </div>
                    </>
                  ) : version.approved_at ? (
                    <>
                      <CheckCircle2 size={21} />
                      <div>
                        <strong>Godkendt af {version.approver_name}</strong>
                        <p>
                          {date(version.approved_at, true)} · I brug fra:{' '}
                          {date(version.effective_date)}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <Info size={21} />
                      <div>
                        <strong>Afventer gennemgang og godkendelse</strong>
                        <p>Denne version er endnu ikke registreret som gældende.</p>
                      </div>
                      {!isArchived(data, p.id) && (
                        <button
                          className="button secondary small"
                          onClick={() => {
                            setRejectReason('');
                            setError('');
                            setRejecting(true);
                          }}
                        >
                          Afvis
                        </button>
                      )}
                      {!isArchived(data, p.id) && (!active || version.number > active.number) && (
                        <button
                          className="button primary small"
                          onClick={() => {
                            setEffective(today());
                            setUnknown(false);
                            setConfirmation('');
                            setError('');
                            setApproval(true);
                          }}
                        >
                          Godkend
                          <ChevronRight size={15} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
            {tab === 'content' && (
              <>
                <div className="content-toolbar">
                  <span>
                    <FileText size={16} />
                    {version.filename}
                  </span>
                  <button
                    disabled={loading || !content}
                    className="button secondary small"
                    onClick={() =>
                      download(content, version.filename, 'text/markdown;charset=utf-8')
                    }
                  >
                    <Download size={15} />
                    Download .md
                  </button>
                </div>
                {loading ? (
                  <p className="muted">Henter prompt…</p>
                ) : (
                  <pre className="prompt-code">{content}</pre>
                )}
                <div className="hash">
                  <strong>SHA-256</strong>
                  <code>{version.sha256}</code>
                </div>
              </>
            )}
            {tab === 'diff' &&
              (versions.some((v) => v.number < version.number) ? (
                <>
                  <div className="compare-select">
                    <label>
                      Sammenlign med
                      <select
                        value={compare?.id || ''}
                        onChange={(e) => setCompareId(e.target.value)}
                      >
                        {versions
                          .filter((v) => v.number < version.number)
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              Version {v.number}
                            </option>
                          ))}
                      </select>
                    </label>
                    <ArrowLeft size={18} />
                    <span>Version {version.number}</span>
                  </div>
                  {comparison && (
                    <p className="comparison-provenance">
                      Grundlag ved upload: v{comparison.baseVersionNumber} (
                      {comparison.baseKind === 'active'
                        ? 'gældende på sammenligningstidspunktet'
                        : 'seneste kladde; ingen gældende version'}
                      ). Denne registrering bevares, selv om en anden version senere bliver
                      gældende.
                    </p>
                  )}
                  {loading ? (
                    <p className="muted">Sammenligner…</p>
                  ) : (
                    !error && <Diff before={previousContent} after={content} />
                  )}
                </>
              ) : (
                <div className="empty compact">
                  <GitCompareArrows size={30} />
                  <h3>Her begynder historikken</h3>
                  <p>Der er ingen tidligere registreret version at sammenligne med.</p>
                </div>
              ))}
            {tab === 'history' && (
              <div className="timeline">
                {relevantEvents.map((e) => {
                  const v = versions.find((v) => v.id === e.version_id);
                  return (
                    <article key={e.id}>
                      <span className={'timeline-dot ' + (e.action === 'approved' ? 'green' : '')}>
                        {e.action === 'approved' ? (
                          <CheckCircle2 size={16} />
                        ) : (
                          <Upload size={16} />
                        )}
                      </span>
                      <div>
                        <small>{date(e.occurred_at, true)}</small>
                        <h3>
                          Version {v?.number}{' '}
                          {e.action === 'rejected'
                            ? 'afvist'
                            : e.action === 'approved'
                              ? 'godkendt og markeret som gældende'
                              : e.action === 'roboref_reviewed'
                                ? '· Roboref-gennemgang'
                                : e.action === 'archived'
                                  ? 'arkiveret'
                                  : e.action === 'restored'
                                    ? 'gendannet fra arkiv'
                                    : 'uploadet som kladde'}
                        </h3>
                        <p>
                          {e.actor_name} · {e.actor_email}
                        </p>
                        {e.action === 'rejected' && (
                          <p className="event-detail">{JSON.parse(e.detail).reason}</p>
                        )}
                        {e.action === 'approved' && (
                          <p className="event-detail">{JSON.parse(e.detail).confirmation}</p>
                        )}
                        {e.action === 'roboref_reviewed' && (
                          <p className="event-detail">
                            {JSON.parse(e.detail).reason} · Roboref-post fra{' '}
                            {date(JSON.parse(e.detail).validFrom, true)}
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
      {rejecting && (
        <Modal
          title={'Afvis version ' + version.number}
          onClose={() => {
            if (!busy) setRejecting(false);
          }}
        >
          <form onSubmit={reject}>
            <div className="modal-body">
              <p>
                Versionen og begrundelsen bevares i historikken. Afvisningen ændrer ikke noget i
                Roboref.
              </p>
              <label className="field">
                Hvorfor afvises versionen?
                <textarea
                  required
                  minLength={3}
                  maxLength={4000}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Beskriv den faglige begrundelse."
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                disabled={busy}
                className="button ghost"
                onClick={() => setRejecting(false)}
              >
                Annuller
              </button>
              <button className="button primary" disabled={busy}>
                Afvis version
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {approval && (
        <Modal
          title={'Godkend version ' + version.number}
          onClose={() => {
            if (!busy) setApproval(false);
          }}
        >
          <form onSubmit={approve}>
            <div className="modal-body">
              <div className="info-box">
                <Info size={18} />
                <span>
                  Bekræft, at versionen er fagligt gennemgået og taget i brug i Roboref.
                  Godkendelsen bliver en permanent del af loggen.
                </span>
              </div>
              <label className="field">
                I brug fra
                <input
                  type="date"
                  required={!unknown}
                  disabled={unknown}
                  max={today()}
                  min={active?.effective_date || undefined}
                  value={effective}
                  onChange={(e) => setEffective(e.target.value)}
                />
              </label>
              {!active && (
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={unknown}
                    onChange={(e) => setUnknown(e.target.checked)}
                  />
                  Den oprindelige ibrugtagningsdato er ukendt
                </label>
              )}
              <label className="field">
                Bemærkning til godkendelsen
                <textarea
                  required
                  maxLength={1000}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="Hvad har du gennemgået, og hvordan er brugen i Roboref bekræftet?"
                />
              </label>
              <label className="check-field">
                <input type="checkbox" required />
                Jeg bekræfter, at denne version er den, vi anvender i Roboref.
              </label>
              <p className="micro">
                Appen registrerer jeres bekræftelse. Den ændrer ikke automatisk prompten i Roboref.
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                disabled={busy}
                className="button ghost"
                onClick={() => setApproval(false)}
              >
                Annuller
              </button>
              <button disabled={busy} className="button primary">
                <CheckCircle2 size={17} />
                {busy ? 'Godkender…' : 'Godkend og gør gældende'}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
