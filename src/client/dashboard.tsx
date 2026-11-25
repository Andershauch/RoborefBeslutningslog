'use client';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  LayoutGrid,
  LogOut,
  History,
  ShieldCheck,
  ArrowUpRight,
  Plus,
  Upload,
  Search,
  ArrowRight,
  FileText,
  GitBranch,
  Clock3,
  Download,
  Share2,
  LockKeyhole,
  RefreshCw,
  X,
  BookOpen,
  CheckCircle2,
  Menu,
  Printer,
  Folder,
} from 'lucide-react';
import {
  Data,
  Event,
  date,
  normalize,
  download,
  Version,
  Prompt,
  pending,
  isArchived,
  rejectionFor,
  readJson,
} from './types';
import UploadModal from './upload';
import RoborefSelection from './roboref-selection';
import RoborefCheck from './roboref-check';
import type {RoborefSource} from './roboref-import';
import Detail from './detail';
import {can} from '../shared/roles';
import type {Role} from '../shared/roles';
import Modal from './modal';
import {roborefLinks, fetchRoborefOverview} from './roboref-overview';
import type {RemoteInfo} from './roboref-overview';
const empty: Data = {prompts: [], versions: [], events: []};
type ExportData = Data & {exportedAt: string; exportedBy: {name: string}; note: string};
export default function Dashboard({
  user,
  initialData,
}: {
  user: {name: string; email: string; roles?: Role[]; authMode?: string};
  initialData?: Data;
}) {
  // Afslutter sessionen på serveren og sender brugeren videre til loginudbyderens logud-side.
  async function logOut() {
    try {
      const response = await fetch('/auth/logout', {method: 'POST'});
      const body = (await response.json()) as {redirect?: string};
      window.location.assign(body.redirect || '/');
    } catch {
      window.location.assign('/');
    }
  }
  // Kun hjælp til brugeren: serveren håndhæver rettighederne uanset hvad der vises her.
  const roles = user.roles ?? [];
  const canWrite = can(roles, 'write');
  const canDecide = can(roles, 'decide');
  const [checkPromptId, setCheckPromptId] = useState('');
  const [selectionOpen, setSelectionOpen] = useState(false),
    [checkOpen, setCheckOpen] = useState(false),
    [roborefSource, setRoborefSource] = useState<RoborefSource | undefined>();
  const [data, setData] = useState<Data>(initialData || empty),
    [loading, setLoading] = useState(!initialData),
    [error, setError] = useState(''),
    [page, setPage] = useState('prompts'),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [selected, setSelected] = useState(''),
    [upload, setUpload] = useState(false),
    [uploadTarget, setUploadTarget] = useState(''),
    [share, setShare] = useState(false),
    [notice, setNotice] = useState(''),
    [navOpen, setNavOpen] = useState(false),
    [report, setReport] = useState(false),
    [exporting, setExporting] = useState(false),
    [reportData, setReportData] = useState<ExportData | null>(null),
    [area, setArea] = useState('all');
  const [remote, setRemote] = useState<Record<string, RemoteInfo>>({}),
    [remoteStatus, setRemoteStatus] = useState(''),
    [remoteRevision, setRemoteRevision] = useState(0);
  const linksKey = JSON.stringify(roborefLinks(data));
  useEffect(() => {
    if (linksKey === '[]') return;
    let cancelled = false;
    async function call(body: object) {
      const r = await fetch('/api/roboref', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      const d = await readJson<{error?: string; items: Record<string, unknown>[]}>(r);
      if (!r.ok) throw new Error(d.error);
      return d.items;
    }
    void fetchRoborefOverview(JSON.parse(linksKey), call)
      .then((result) => {
        if (!cancelled) {
          setRemote(result);
          setRemoteStatus(
            'Roboref-oplysninger opdateret ' +
              new Date().toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'}),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemote({});
          setRemoteStatus('Roboref-oplysninger kunne ikke opdateres. Prøv igen.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [linksKey, remoteRevision]);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/log');
      const result = await readJson<Data & {error?: string}>(r);
      if (!r.ok) throw new Error(result.error);
      setError('');
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente data.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    const task = Promise.resolve().then(() => {
      if (active) return refresh();
    });
    return () => {
      active = false;
      void task;
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  const activeCount = data.prompts.filter(
      (p) => p.active_version_id && !isArchived(data, p.id),
    ).length,
    drafts = data.versions.filter((v) => !isArchived(data, v.prompt_id) && pending(v, data)),
    selectedPrompt = data.prompts.find((p) => p.id === selected);
  const linkedTitles = Object.fromEntries(roborefLinks(data).map((l) => [l.promptId, l.title]));
  const promptTitle = useCallback(
    (p: Prompt) => remote[p.id]?.title || linkedTitles[p.id] || p.title,
    [remote, linkedTitles],
  );
  const activePrompts = data.prompts.filter((p) => !isArchived(data, p.id));
  const archivedCount = data.prompts.length - activePrompts.length;
  const activeAreas = Array.from(new Set(activePrompts.map((p) => p.department))).sort((a, b) =>
    a.localeCompare(b, 'da'),
  );
  const areas =
    filter === 'archived'
      ? Array.from(
          new Set(data.prompts.filter((p) => isArchived(data, p.id)).map((p) => p.department)),
        ).sort((a, b) => a.localeCompare(b, 'da'))
      : activeAreas;
  const visibleArea = areas.includes(area) ? area : 'all';
  const rows = useMemo(
    () =>
      data.prompts.filter((p) => {
        const match = normalize(
          promptTitle(p) + ' ' + p.meeting_type + ' ' + p.department + ' ' + p.owner,
        ).includes(normalize(query));
        const hasPending = data.versions.some((v) => v.prompt_id === p.id && pending(v, data));
        return (
          match &&
          (visibleArea === 'all' || p.department === visibleArea) &&
          (filter === 'archived'
            ? isArchived(data, p.id)
            : !isArchived(data, p.id) &&
              (filter === 'all' ||
                (filter === 'active' && p.active_version_id) ||
                (filter === 'draft' && hasPending)))
        );
      }),
    [data, query, filter, visibleArea, promptTitle],
  );
  function go(p: string) {
    setPage(p);
    setSelected('');
    setNavOpen(false);
    setQuery('');
  }
  function startUpload(target = '') {
    if (!canWrite) return;
    setRoborefSource(undefined);
    setUploadTarget(target);
    setUpload(true);
  }
  async function exportData(mode: 'json' | 'csv' | 'print') {
    setExporting(true);
    setError('');
    try {
      const r = await fetch('/api/export');
      const d = await readJson<ExportData & {error?: string}>(r);
      if (!r.ok) throw new Error(d.error || 'Eksport mislykkedes.');
      if (mode === 'json')
        download(JSON.stringify(d, null, 2), 'roboref-beslutningslog.json', 'application/json');
      else if (mode === 'csv') {
        const header = [
          'Prompt',
          'Mødetype',
          'Afdeling',
          'Ansvarlig',
          'Version',
          'Status',
          'Uploadet',
          'Uploadet af',
          'Godkendt',
          'Godkendt af',
          'I brug fra',
          'Ændringer',
          'Årsag',
          'Forventet effekt',
          'Faglig begrundelse',
          'SHA-256',
          'Kilde',
        ];
        const csv = [
          header,
          ...d.versions.map((v: Version) => {
            const p = d.prompts.find((p: Prompt) => p.id === v.prompt_id);
            if (!p) return [];
            return [
              promptTitle(p),
              p.meeting_type,
              p.department,
              p.owner,
              v.number,
              isArchived(d, p.id)
                ? 'Arkiveret'
                : rejectionFor(d, v.id)
                  ? 'Afvist'
                  : v.id === p.active_version_id
                    ? 'Gældende'
                    : v.approved_at
                      ? 'Historik'
                      : 'Kladde',
              v.created_at,
              v.author_name,
              v.approved_at,
              v.approver_name,
              v.effective_date,
              v.changes,
              v.reason,
              v.outcome,
              v.rationale,
              v.sha256,
              sourceLabel(d.events, v.id),
            ];
          }),
        ]
          .map((row: unknown[]) =>
            row
              .map((c) => {
                let s = String(c ?? '');
                if (/^[\s]*[=+@-]|^[\t\r\n]/.test(s)) s = "'" + s;
                return '"' + s.replace(/"/g, '""') + '"';
              })
              .join(';'),
          )
          .join('\r\n');
        download('\uFEFF' + csv, 'roboref-versionsoversigt.csv', 'text/csv;charset=utf-8');
      } else {
        setReportData(d);
        setReport(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eksport mislykkedes.');
    } finally {
      setExporting(false);
    }
  }
  function sourceLabel(events: Data['events'], versionId: string) {
    try {
      const source = JSON.parse(
        events.find((e) => e.version_id === versionId && e.action === 'uploaded')?.detail || '{}',
      ).source;
      return source
        ? `Roboref ID ${source.id} · ${source.title} · ${source.field === 'meetingType' ? 'mødetype' : 'instruktion'} · historisk post ${date(source.validFrom, true)}`
        : '';
    } catch {
      return '';
    }
  }
  const reportVersions = (reportData?.versions || []) as (Version & {content: string})[];
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Gå til indhold
      </a>
      <aside className={'sidebar ' + (navOpen ? 'open' : '')}>
        <button
          type="button"
          className="brand"
          aria-label="Roboref forside"
          onClick={() => {
            setPage('prompts');
            setSelected('');
            setNavOpen(false);
          }}
        >
          <div className="brand-symbol">
            r<span>↗</span>
          </div>
          <div>
            roboref<span>Beslutningslog</span>
          </div>
        </button>
        <div className="workspace">
          <span className="workspace-icon">H</span>
          <div>
            <strong>Promptforvaltning</strong>
            <small>Lokal arbejdsmappe</small>
          </div>
          <LockKeyhole size={13} />
        </div>
        <div className="nav-label">ARBEJDSRUM</div>
        <nav className="main-nav" aria-label="Hovednavigation">
          <button className={page === 'prompts' ? 'active' : ''} onClick={() => go('prompts')}>
            <LayoutGrid size={18} />
            Prompts<span>{activePrompts.length}</span>
          </button>
          <button className={page === 'log' ? 'active' : ''} onClick={() => go('log')}>
            <History size={18} />
            Beslutningslog
          </button>
          <button className={page === 'docs' ? 'active' : ''} onClick={() => go('docs')}>
            <ShieldCheck size={18} />
            Dokumentation
          </button>
        </nav>
        <section className="sidebar-areas">
          <div className="nav-label">FAGOMRÅDER</div>
          {activeAreas.length ? (
            activeAreas.map((name) => (
              <button
                key={name}
                className={area === name ? 'active' : ''}
                onClick={() => {
                  go('prompts');
                  setFilter('all');
                  setArea(name);
                }}
              >
                <span className="area-dot" />
                {name}
                <span>{activePrompts.filter((p) => p.department === name).length}</span>
              </button>
            ))
          ) : (
            <button onClick={() => startUpload()}>
              <Folder size={15} />
              Tilføjes ved første upload
            </button>
          )}
        </section>
        <div className="sidebar-note">
          <div className="small-mark">
            <GitBranch size={21} />
          </div>
          <h3>Et spor, du kan følge.</h3>
          <p>Fra første prompt til seneste beslutning. Samlet ét sted.</p>
          <button onClick={() => go('docs')}>
            Om dokumentationssporet
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-footer">
          <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{user.name}</strong>
            <small title={user.email}>{user.email}</small>
          </div>
          {user.authMode === 'oidc' && (
            <button
              type="button"
              className="icon-button"
              onClick={() => void logOut()}
              aria-label="Log ud"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              onClick={() => setNavOpen((x) => !x)}
              aria-label="Åbn navigation"
            >
              <Menu size={21} />
            </button>
            <span>Arbejdsrum</span>
            <span>/</span>
            <strong>
              {page === 'prompts' ? 'Prompts' : page === 'log' ? 'Beslutningslog' : 'Dokumentation'}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="private-label">
              <LockKeyhole size={13} />
              Lokal version
            </span>
            <button className="button secondary small" onClick={() => setShare(true)}>
              <Share2 size={15} />
              Om lokal version
            </button>
          </div>
        </header>
        <main id="main" className="main-content">
          {selectedPrompt ? (
            <Detail
              key={selectedPrompt.id}
              prompt={{...selectedPrompt, title: promptTitle(selectedPrompt)}}
              data={data}
              onBack={() => setSelected('')}
              onUpload={() => startUpload(selectedPrompt.id)}
              canWrite={canWrite}
              canDecide={canDecide}
              onCheck={
                canWrite && roborefLinks(data).some((link) => link.promptId === selectedPrompt.id)
                  ? () => {
                      setCheckPromptId(selectedPrompt.id);
                      setCheckOpen(true);
                    }
                  : undefined
              }
              onRefresh={refresh}
              onNotice={setNotice}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ROBOREF · PROMPTFORVALTNING</div>
                  <h1>
                    {page === 'prompts'
                      ? 'Overblik med omtanke.'
                      : page === 'log'
                        ? 'Beslutninger, der kan følges.'
                        : 'Dokumentation med sammenhæng.'}
                  </h1>
                  <p>
                    {page === 'prompts'
                      ? 'Hold styr på dine prompts. Og beslutningerne bag dem.'
                      : page === 'log'
                        ? 'Se hvem der ændrede hvad, hvornår og hvorfor.'
                        : 'Saml versioner, begrundelser og ansvar i én eksport.'}
                  </p>
                </div>
                {canWrite && (
                  <div>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setCheckPromptId('');
                        setCheckOpen(true);
                      }}
                    >
                      Tjek for ændringer
                    </button>{' '}
                    <button className="button secondary" onClick={() => setSelectionOpen(true)}>
                      Hent fra Roboref
                    </button>{' '}
                    <button className="button primary" onClick={() => startUpload()}>
                      <Plus size={19} />
                      Upload prompt
                    </button>
                  </div>
                )}
              </div>
              {error && (
                <div className="error error-banner" role="alert">
                  <span>{error}</span>
                  <button className="button secondary small" onClick={() => void refresh()}>
                    <RefreshCw size={14} />
                    Prøv igen
                  </button>
                </div>
              )}
              <div className="stats-grid">
                <div className="stat-card">
                  <div>
                    <span>Gældende prompts</span>
                    <strong>
                      {loading ? '—' : activeCount}
                      <small>i Roboref</small>
                    </strong>
                    <p>
                      <i className="status-dot" />
                      Registreret som taget i brug
                    </p>
                  </div>
                  <span className="stat-icon green">
                    <FileText size={22} />
                  </span>
                </div>
                <div className="stat-card">
                  <div>
                    <span>Registrerede versioner</span>
                    <strong>
                      {loading ? '—' : data.versions.length}
                      <small>i alt</small>
                    </strong>
                    <p>Arkiverede prompts tælles i arkivet</p>
                  </div>
                  <span className="stat-icon lavender">
                    <GitBranch size={22} />
                  </span>
                </div>
                <div className="stat-card">
                  <div>
                    <span>Afventer godkendelse</span>
                    <strong>
                      {loading ? '—' : drafts.length}
                      <small>{drafts.length === 1 ? 'kladde' : 'kladder'}</small>
                    </strong>
                    <p>
                      {drafts.length
                        ? 'Klar til faglig gennemgang'
                        : 'Ingen udestående godkendelser'}
                    </p>
                  </div>
                  <span className="stat-icon amber">
                    <Clock3 size={22} />
                  </span>
                </div>
              </div>
              {page === 'prompts' && (
                <>
                  <section className="prompt-section">
                    <div className="section-heading">
                      <div>
                        <h2>
                          {filter === 'archived' ? 'Arkiverede prompts' : 'Dine prompts'}{' '}
                          <span className="count">{rows.length}</span>
                        </h2>
                        <p>Den gældende version vises her. Historikken ligger ét klik væk.</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => void exportData('csv')}
                        disabled={exporting || !data.prompts.length}
                      >
                        <Download size={15} />
                        Eksportér oversigt
                      </button>
                    </div>
                    <div className="table-toolbar">
                      <div className="filter-tabs" aria-label="Filtrér prompts">
                        {[
                          ['all', 'Alle prompts'],
                          ['active', 'Gældende'],
                          ['draft', 'Med kladder'],
                          ['archived', `Arkiv (${archivedCount})`],
                        ].map(([id, label]) => (
                          <button
                            key={id}
                            className={filter === id ? 'active' : ''}
                            onClick={() => {
                              setFilter(id);
                              setArea('all');
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="toolbar-right">
                        <label className="category-select">
                          <Folder size={15} />
                          <select
                            aria-label="Filtrér efter fagområde"
                            value={visibleArea}
                            onChange={(e) => setArea(e.target.value)}
                          >
                            <option value="all">Alle fagområder</option>
                            {areas.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="search-box">
                          <Search size={16} />
                          <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            aria-label="Søg efter prompt"
                            placeholder="Søg efter prompt…"
                          />
                          {query && (
                            <button onClick={() => setQuery('')} aria-label="Ryd søgning">
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {Object.keys(linkedTitles).length > 0 && (
                      <p className="micro roboref-status">
                        {remoteStatus || 'Roboref-oplysninger er ikke kontrolleret.'}{' '}
                        <button
                          className="text-button"
                          onClick={() => setRemoteRevision((n) => n + 1)}
                        >
                          Opdatér oplysninger
                        </button>
                        . Tidspunktet er seneste historiske post i Roboref og kan afvige fra den
                        viste version og importdatoen.
                      </p>
                    )}
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Prompt / mødetype</th>
                            <th>Version / seneste rettelse i Roboref</th>
                            <th>Status</th>
                            <th>Senest uploadet</th>
                            <th>Ansvarlig</th>
                            <th>
                              <span className="sr-only">Åbn</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((p) => {
                            const vv = data.versions.filter((v) => v.prompt_id === p.id),
                              v = vv.find((v) => v.id === p.active_version_id),
                              latest = vv[0],
                              hasDraft = vv.some((v) => pending(v, data));
                            return (
                              <tr key={p.id}>
                                <td>
                                  <button className="prompt-name" onClick={() => setSelected(p.id)}>
                                    <span className="file-square">
                                      <FileText size={21} />
                                    </span>
                                    <span>
                                      <strong>{promptTitle(p)}</strong>
                                      <small>
                                        {p.department} · {p.meeting_type}
                                      </small>
                                    </span>
                                  </button>
                                </td>
                                <td>
                                  <span className="version">
                                    {v ? 'v' + v.number : latest ? 'v' + latest.number : '-'}
                                  </span>
                                  {linkedTitles[p.id] && (
                                    <div className="micro" style={{marginTop: 6}}>
                                      {remote[p.id]?.error ||
                                        (!remote[p.id] ? (
                                          'Roboref ikke kontrolleret'
                                        ) : (
                                          <>
                                            Roboref: {remote[p.id].editor || 'Redaktør ikke oplyst'}
                                            <br />
                                            {remote[p.id].validFrom
                                              ? date(remote[p.id].validFrom, true)
                                              : 'Tidspunkt ikke oplyst'}
                                          </>
                                        ))}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <div className="status-stack">
                                    <span className={'badge ' + (v ? 'green' : 'amber')}>
                                      <i />
                                      {isArchived(data, p.id)
                                        ? 'Arkiveret'
                                        : v
                                          ? 'Gældende'
                                          : latest && rejectionFor(data, latest.id)
                                            ? 'Afvist'
                                            : 'Afventer'}
                                    </span>
                                    {v && hasDraft && <small>Ny kladde</small>}
                                  </div>
                                </td>
                                <td className="date-cell">
                                  {date(latest?.created_at || p.created_at)}
                                </td>
                                <td>
                                  <span className="owner">
                                    <span className="mini-avatar">{p.owner.slice(0, 1)}</span>
                                    {p.owner}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    className="icon-button row-arrow"
                                    onClick={() => setSelected(p.id)}
                                    aria-label={'Åbn ' + promptTitle(p)}
                                  >
                                    <ArrowUpRight size={19} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {loading ? (
                        <div className="empty">
                          <RefreshCw size={27} />
                          <h3>Henter dit arbejdsrum…</h3>
                        </div>
                      ) : !data.prompts.length && !error ? (
                        <div className="empty">
                          <span className="empty-icon">
                            <FileText size={32} />
                            <span>+</span>
                          </span>
                          <h3>Den første prompt er begyndelsen.</h3>
                          <p>
                            Upload en .md-fil, tilføj formål og ansvarlig,
                            <br />
                            og giv beslutningerne et sted at høre til.
                          </p>
                          {canWrite && (
                            <button className="button primary" onClick={() => startUpload()}>
                              <Upload size={17} />
                              Upload din første prompt
                            </button>
                          )}
                          <small>
                            Du kan begynde med en eksisterende version eller med den medfølgende
                            eksempelprompt.
                          </small>
                        </div>
                      ) : !rows.length && !error ? (
                        <div className="empty compact">
                          <Search size={27} />
                          <h3>Ingen prompts matcher</h3>
                          <p>Prøv en anden søgning eller vælg Alle prompts.</p>
                          <button
                            className="button secondary small"
                            onClick={() => {
                              setQuery('');
                              setFilter('all');
                              setArea('all');
                            }}
                          >
                            Nulstil filtre
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <footer className="table-footer">
                      <span>
                        {rows.length} {rows.length === 1 ? 'prompt' : 'prompts'}
                        {filter === 'archived' && (
                          <>
                            {' '}
                            ·{' '}
                            {
                              data.versions.filter((v) => rows.some((p) => p.id === v.prompt_id))
                                .length
                            }{' '}
                            arkiverede versioner
                          </>
                        )}
                      </span>
                      <span>
                        <LockKeyhole size={12} />
                        Versioner og beslutninger gemmes på denne computer
                      </span>
                    </footer>
                  </section>
                  <div className="bottom-grid">
                    <section className="recent-card">
                      <div className="section-heading">
                        <h2>Seneste aktivitet</h2>
                        <button className="text-button" onClick={() => go('log')}>
                          Se loggen
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      {!data.events.length ? (
                        <div className="quiet-empty">
                          <History size={20} />
                          <p>Når du registrerer din første prompt, begynder historikken her.</p>
                        </div>
                      ) : (
                        data.events.slice(0, 3).map((e) => {
                          const p = data.prompts.find((p) => p.id === e.prompt_id),
                            v = data.versions.find((v) => v.id === e.version_id);
                          return (
                            <button
                              className="activity-row"
                              key={e.id}
                              onClick={() => p && setSelected(p.id)}
                            >
                              <span
                                className={
                                  'activity-icon ' + (e.action === 'approved' ? 'green' : '')
                                }
                              >
                                {e.action === 'approved' ? (
                                  <CheckCircle2 size={17} />
                                ) : (
                                  <Upload size={17} />
                                )}
                              </span>
                              <span>
                                <strong>{p ? promptTitle(p) : ''}</strong>
                                <small>
                                  v{v?.number}{' '}
                                  {e.action === 'rejected'
                                    ? 'afvist'
                                    : e.action === 'approved'
                                      ? 'godkendt'
                                      : e.action === 'roboref_reviewed'
                                        ? 'gennemgået i Roboref'
                                        : e.action === 'archived'
                                          ? 'arkiveret'
                                          : e.action === 'restored'
                                            ? 'gendannet'
                                            : 'uploadet'}{' '}
                                  · {e.actor_name}
                                </small>
                              </span>
                              <time>{date(e.occurred_at)}</time>
                            </button>
                          );
                        })
                      )}
                    </section>
                    <section className="documentation-callout">
                      <span className="callout-icon">
                        <ShieldCheck size={25} />
                      </span>
                      <span className="eyebrow">KLARHED I HELE FORLØBET</span>
                      <h2>
                        Beslutninger fortjener
                        <br />
                        en begrundelse.
                      </h2>
                      <p>
                        Saml det faglige hvorfor med de konkrete ændringer. Så er historien til at
                        forstå — også senere.
                      </p>
                      <button onClick={() => go('docs')}>
                        Se din dokumentation
                        <ArrowUpRight size={17} />
                      </button>
                      <div className="callout-orbit" aria-hidden="true" />
                    </section>
                  </div>
                </>
              )}
              {page === 'log' && (
                <section className="log-card">
                  <div className="section-heading">
                    <div>
                      <h2>Hele beslutningssporet</h2>
                      <p>Upload og godkendelser registreres med tidspunkt og bruger.</p>
                    </div>
                    <span className="count">{data.events.length} hændelser</span>
                  </div>
                  {!data.events.length ? (
                    <div className="empty">
                      <History size={35} />
                      <h3>Et nyt kapitel begynder her</h3>
                      <p>Loggen udfyldes, når den første prompt registreres.</p>
                    </div>
                  ) : (
                    <div className="timeline full-timeline">
                      {data.events.map((e) => {
                        const p = data.prompts.find((p) => p.id === e.prompt_id),
                          v = data.versions.find((v) => v.id === e.version_id);
                        return (
                          <article key={e.id}>
                            <span
                              className={'timeline-dot ' + (e.action === 'approved' ? 'green' : '')}
                            >
                              {e.action === 'approved' ? (
                                <CheckCircle2 size={16} />
                              ) : (
                                <Upload size={16} />
                              )}
                            </span>
                            <div>
                              <small>{date(e.occurred_at, true)}</small>
                              <h3>
                                <button
                                  className="text-button"
                                  onClick={() => p && setSelected(p.id)}
                                >
                                  {p ? promptTitle(p) : ''}
                                  <ArrowUpRight size={14} />
                                </button>
                              </h3>
                              <p>
                                Version {v?.number}{' '}
                                {e.action === 'rejected'
                                  ? 'afvist'
                                  : e.action === 'approved'
                                    ? 'godkendt og gjort gældende'
                                    : e.action === 'roboref_reviewed'
                                      ? 'gennemgået i Roboref'
                                      : e.action === 'archived'
                                        ? 'arkiveret'
                                        : e.action === 'restored'
                                          ? 'gendannet fra arkiv'
                                          : 'uploadet som kladde'}{' '}
                                af {e.actor_name}
                              </p>
                              {v && (
                                <p className="event-detail">
                                  {e.action === 'rejected'
                                    ? JSON.parse(e.detail).reason
                                    : e.action === 'approved'
                                      ? JSON.parse(e.detail).confirmation
                                      : e.action === 'roboref_reviewed'
                                        ? JSON.parse(e.detail).reason
                                        : e.action === 'archived' || e.action === 'restored'
                                          ? JSON.parse(e.detail).note
                                          : v.changes}
                                </p>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
              {page === 'docs' && (
                <>
                  <div className="docs-intro">
                    <div className="docs-icon">
                      <ShieldCheck size={34} />
                    </div>
                    <div>
                      <h2>Fra prompt til faglig beslutning</h2>
                      <p>
                        Dokumentationen samler de registrerede versioner, begrundelser, ansvarlige
                        og godkendelser. Brug den som et samlet grundlag for jeres gennemgang og
                        dialog med tilsyn.
                      </p>
                    </div>
                  </div>
                  <div className="export-grid">
                    {[
                      [
                        'print',
                        'Læsbar rapport',
                        'Samlet overblik med beslutninger, historik og promptindhold. Udskriv, eller gem som PDF.',
                        'Åbn rapport',
                        BookOpen,
                      ],
                      [
                        'csv',
                        'Versionsoversigt',
                        'Alle registrerede versioner og begrundelser i en oversigt, du kan åbne i Excel.',
                        'Download CSV',
                        LayoutGrid,
                      ],
                      [
                        'json',
                        'Fuld dokumentation',
                        'Originalt promptindhold, kontrolsummer og hele hændelsesloggen i et struktureret format.',
                        'Download JSON',
                        Download,
                      ],
                    ].map(([id, title, text, action, Icon]) => {
                      const I = Icon as typeof FileText;
                      return (
                        <section className="export-card" key={id as string}>
                          <span className="stat-icon green">
                            <I size={23} />
                          </span>
                          <h3>{title as string}</h3>
                          <p>{text as string}</p>
                          <button
                            className="button secondary"
                            disabled={exporting || !data.prompts.length}
                            onClick={() => void exportData(id as 'json' | 'csv' | 'print')}
                          >
                            {action as string}
                            <ArrowUpRight size={15} />
                          </button>
                        </section>
                      );
                    })}
                  </div>
                  <section className="documentation-notes">
                    <h2>Sådan skal loggen læses</h2>
                    <div>
                      {[
                        [
                          'Upload er ikke ibrugtagning',
                          'En fil gemmes først som kladde. En særskilt godkendelse registrerer, at versionen er gennemgået og anvendes i Roboref.',
                        ],
                        [
                          'Historikken begynder ved første registrering',
                          'Importer gerne din nuværende version som første version. Loggen dokumenterer derefter forløbet uden at opfinde tidligere versioner eller datoer.',
                        ],
                        [
                          'Ændringer bevares',
                          'Prompttekst og beslutningsbegrundelser kan ikke overskrives eller slettes i appen. Rettelser registreres ved at uploade en ny version.',
                        ],
                        [
                          'Registreret brug bekræftes af jer',
                          'Appen har ingen direkte forbindelse til Roboref. Registreringen af brug og ibrugtagningsdato bygger på brugerens bekræftelse.',
                        ],
                      ].map(([title, text]) => (
                        <article key={title}>
                          <CheckCircle2 size={19} />
                          <div>
                            <h3>{title}</h3>
                            <p>{text}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              roboref<span> / </span>Beslutningslog
            </span>
            <span>Plads til faglighed. Sporbarhed i praksis.</span>
          </footer>
        </main>
      </div>
      {selectionOpen && (
        <RoborefSelection
          data={data}
          user={user.name}
          onClose={() => setSelectionOpen(false)}
          onRefresh={refresh}
          onChoose={(source, promptId) => {
            setRoborefSource(source);
            setSelectionOpen(false);
            setUploadTarget(promptId);
            setUpload(true);
          }}
        />
      )}
      {checkOpen && (
        <RoborefCheck
          data={data}
          promptId={checkPromptId || undefined}
          onClose={() => setCheckOpen(false)}
          onRefresh={refresh}
          onChoose={(source, promptId) => {
            setCheckOpen(false);
            setRoborefSource(source);
            setUploadTarget(promptId);
            setUpload(true);
          }}
        />
      )}

      {upload && (
        <UploadModal
          source={roborefSource}
          data={data}
          user={user.name}
          initialPromptId={uploadTarget}
          onClose={() => setUpload(false)}
          onSaved={async (id) => {
            setUpload(false);
            await refresh();
            setSelected(id);
            setNotice('Prompten er gemt som kladde. Du kan nu gennemgå og godkende versionen.');
          }}
        />
      )}
      {share && (
        <Modal title="Din lokale beslutningslog" onClose={() => setShare(false)}>
          {
            <div className="modal-body">
              <div className="share-illustration">
                <Folder size={36} />
              </div>
              <h3>Et arbejdsrum på din computer.</h3>
              <p className="muted">
                Dine prompts, versioner og beslutninger gemmes automatisk i projektmappen og
                bevares, når du lukker appen.
              </p>
              <div className="info-box">
                <ShieldCheck size={19} />
                <div>
                  <strong>Klar til at blive prøvet af</strong>
                  <p>
                    Den medfølgende eksempelprompt er importeret som kladde. Du kan gennemgå og
                    godkende den, uploade nye versioner og eksportere hele historikken.
                  </p>
                  <p>
                    Der er intet login: appen er til én bruger på denne computer. Handlinger
                    registreres under det navn, du har sat i ROBOREF_USER_NAME i filen .env
                    (standard: Lokal bruger).
                  </p>
                </div>
              </div>
              <button
                className="button secondary full-width"
                onClick={() => {
                  setShare(false);
                  go('docs');
                }}
              >
                Se eksportmuligheder
                <ArrowRight size={16} />
              </button>
            </div>
          }
        </Modal>
      )}
      {report && reportData && (
        <Modal title="Dokumentationsrapport" onClose={() => setReport(false)} wide>
          <div className="modal-body">
            <div className="report-toolbar">
              <p className="micro">Genereret {date(reportData.exportedAt, true)}</p>
              <button className="button primary small" onClick={() => window.print()}>
                <Printer size={16} />
                Udskriv / gem PDF
              </button>
            </div>
            <article className="print-report">
              <h1>Roboref · Beslutningslog</h1>
              <p>Dokumentation af mødetype-prompts, versioner og beslutninger</p>
              <p>
                Eksporteret {date(reportData.exportedAt, true)} af {reportData.exportedBy.name}
              </p>
              <p className="report-note">{reportData.note}</p>
              {reportData.prompts.map((p: Prompt) => (
                <section key={p.id} className="report-prompt">
                  <h2>{promptTitle(p)}</h2>
                  <p>
                    <b>Formål:</b> {p.purpose}
                  </p>
                  <p>
                    <b>Mødetype:</b> {p.meeting_type} · <b>Afdeling:</b> {p.department} ·{' '}
                    <b>Ansvarlig:</b> {p.owner}
                  </p>
                  <p>
                    Registreret {date(p.created_at, true)} · Gældende:{' '}
                    {reportVersions.find((v) => v.id === p.active_version_id)?.number
                      ? 'v' + reportVersions.find((v) => v.id === p.active_version_id)?.number
                      : 'Ingen'}
                  </p>
                  {reportVersions
                    .filter((v) => v.prompt_id === p.id)
                    .map((v) => (
                      <section key={v.id} className="report-version">
                        <h3>
                          Version {v.number} —{' '}
                          {rejectionFor(reportData, v.id)
                            ? 'Afvist'
                            : v.id === p.active_version_id
                              ? 'Gældende'
                              : v.approved_at
                                ? 'Historisk'
                                : 'Kladde'}
                        </h3>
                        <p>
                          Uploadet {date(v.created_at, true)} af {v.author_name} ({v.author_email})
                        </p>
                        <p>
                          Godkendt: {date(v.approved_at, true)} · Godkendt af:{' '}
                          {v.approver_name || 'Ingen'} · I brug fra: {date(v.effective_date)}
                        </p>
                        {[
                          ['Ændringer', v.changes],
                          ['Årsag', v.reason],
                          ['Forventet effekt', v.outcome],
                          ['Faglig begrundelse', v.rationale],
                        ].map(([k, value]) => (
                          <p key={k}>
                            <b>{k}:</b> {value}
                          </p>
                        ))}
                        {sourceLabel(reportData.events, v.id) && (
                          <p>
                            <b>Kilde:</b> {sourceLabel(reportData.events, v.id)}. Tidspunktet er
                            ikke bekræftet som ibrugtagning.
                          </p>
                        )}
                        <p className="hash">SHA-256: {v.sha256}</p>
                        <h4>Promptindhold · {v.filename}</h4>
                        <pre>{v.content}</pre>
                      </section>
                    ))}
                  <h3>Hændelseslog</h3>
                  {reportData.events
                    .filter((e: Event) => e.prompt_id === p.id)
                    .map((e: Event) => (
                      <p key={e.id}>
                        {date(e.occurred_at, true)} · {e.actor_name} ({e.actor_email})
                        {user.authMode === 'oidc' && !e.identity_verified && ' · ikke verificeret'}{' '}
                        ·{' '}
                        {e.action === 'rejected'
                          ? 'Afvisning: ' + JSON.parse(e.detail).reason
                          : e.action === 'approved'
                            ? 'Godkendelse: ' + JSON.parse(e.detail).confirmation
                            : e.action === 'roboref_reviewed'
                              ? 'Roboref-gennemgang: ' + JSON.parse(e.detail).reason
                              : e.action === 'archived'
                                ? 'Arkiveret'
                                : e.action === 'restored'
                                  ? 'Gendannet fra arkiv'
                                  : 'Upload'}{' '}
                        · versions-ID {e.version_id}
                      </p>
                    ))}
                </section>
              ))}
            </article>
          </div>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Luk besked">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
