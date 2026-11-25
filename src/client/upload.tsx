'use client';
import {useEffect, useRef, useState} from 'react';
import {UploadCloud, FileText, ArrowRight, Check, ArrowLeft, Info} from 'lucide-react';
import Modal from './modal';
import {Data, normalize, isArchived, readJson} from './types';
import Diff from './diff';
import type {ComparisonBasis} from '../shared/change-analysis';
import type {RoborefSource} from './roboref-import';
type Input = {
  title: string;
  meetingType: string;
  purpose: string;
  owner: string;
  department: string;
  initialVersion: string;
  changes: string;
  reason: string;
  outcome: string;
  rationale: string;
};
type Preview = {comparison: ComparisonBasis; summary: string; beforeContent: string};
export default function Upload({
  data,
  onClose,
  onSaved,
  user,
  initialPromptId = '',
  source,
}: {
  data: Data;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
  user: string;
  initialPromptId?: string;
  source?: RoborefSource;
}) {
  const [step, setStep] = useState(0),
    [file, setFile] = useState<{name: string; content: string} | null>(
      source ? {name: `Roboref-${source.id}.md`, content: source.content} : null,
    ),
    [sourceActive, setSourceActive] = useState(!!source),
    [target, setTarget] = useState(initialPromptId),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [comparison, setComparison] = useState<Preview | null>(null),
    [comparisonError, setComparisonError] = useState(''),
    [compareRevision, setCompareRevision] = useState(0);
  const comparisonLoading = Boolean(target && file && !comparison && !comparisonError);
  const [fields, setFields] = useState<Input>({
    title: source?.title || '',
    meetingType: source?.title || '',
    purpose: '',
    owner: user,
    department: source?.department || '',
    initialVersion: String(source?.initialVersion || 1),
    changes: '',
    reason: '',
    outcome: '',
    rationale: '',
  });
  const update = (key: keyof Input, value: string) => setFields((x) => ({...x, [key]: value}));
  useEffect(() => {
    if (!target || !file) return;
    let cancelled = false;
    const controller = new AbortController();
    async function compare() {
      try {
        const response = await fetch('/api/log', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          signal: controller.signal,
          body: JSON.stringify({
            action: 'compare',
            promptId: target,
            filename: file!.name,
            content: file!.content,
          }),
        });
        const result = await readJson<Preview & {error?: string}>(response);
        if (!response.ok) throw new Error(result.error);
        if (!cancelled) {
          setComparison(result);
          setComparisonError('');
        }
      } catch (error) {
        if (!cancelled)
          setComparisonError(
            error instanceof Error ? error.message : 'Sammenligningen kunne ikke hentes.',
          );
      }
    }
    void compare();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [target, file, compareRevision]);
  async function load(f: File | undefined, example = false) {
    if (!f) return;
    setError('');
    if (!/\.md$/i.test(f.name) || f.size > 200000) {
      setError('Vælg en .md-fil på højst 200 kB.');
      return;
    }
    try {
      // Fatal decoding preserves exact UTF-8 text and refuses binary or broken files.
      const content = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(
        await f.arrayBuffer(),
      );
      if (!content.trim() || content.includes('\0')) throw new Error();
      setComparison(null);
      setComparisonError('');
      setSourceActive(false);
      setFile({name: f.name, content});
      const stem = f.name.replace(/\.md$/i, ''),
        v = stem.match(/(?:^|[ _-])v(?:ersion)?[ _-]*(\d+)$/i);
      const title = stem
        .replace(/[ _-]+(?:prompt[ _-]+)?v(?:ersion)?[ _-]*\d+$/i, '')
        .replace(/_/g, ' ');
      setFields((x) => ({
        ...x,
        title: example ? 'Eksempelprompt' : title,
        meetingType: example ? 'Eksempel' : title,
        department: example ? 'Eksempel' : x.department,
        purpose: example
          ? 'Vise hvordan en prompt registreres, versioneres og godkendes i Beslutningsloggen.'
          : x.purpose,
        initialVersion: v?.[1] || '1',
      }));
      const key = normalize(f.name);
      const match = data.prompts
        .filter((p) => !isArchived(data, p.id))
        .find(
          (p) =>
            normalize(p.title) === key ||
            data.versions.some((v) => v.prompt_id === p.id && normalize(v.filename) === key),
        );
      if (!initialPromptId) setTarget(match?.id || '');
    } catch {
      setError('Filen skal være en ikke-tom Markdown-fil med UTF-8-tekst.');
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (target && !comparison) {
      setError('Vent på den automatiske sammenligning, før du fortsætter.');
      return;
    }
    if (step === 0) {
      setStep(1);
      setError('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/log', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: 'upload',
          promptId: target,
          filename: file.name,
          content: file.content,
          ...fields,
          initialVersion: Number(fields.initialVersion),
          ...(sourceActive && source
            ? {
                source: {
                  system: 'Roboref',
                  id: source.id,
                  title: source.title,
                  validFrom: source.validFrom,
                  validTo: source.validTo,
                  field: source.field,
                },
              }
            : {}),
          ...(comparison ? {expectedBaseVersionId: comparison.comparison.baseVersionId} : {}),
        }),
      });
      const result = await readJson<{error?: string; code?: string; promptId: string}>(r);
      if (!r.ok) {
        if (result.code === 'comparison_changed') {
          setComparison(null);
          setCompareRevision((n) => n + 1);
        }
        throw new Error(result.error);
      }
      await onSaved(result.promptId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload mislykkedes.');
    } finally {
      setBusy(false);
    }
  }
  const selected = data.prompts.find((p) => p.id === target),
    next = target
      ? Math.max(0, ...data.versions.filter((v) => v.prompt_id === target).map((v) => v.number)) + 1
      : Number(fields.initialVersion);
  const decisionFields: Array<[keyof Input, string, string]> = [
    [
      'reason',
      'Hvorfor er ændringen nødvendig?',
      'Hvilken erfaring, udfordring eller beslutning ligger bag?',
    ],
    ['outcome', 'Hvad skal ændringen opnå?', 'Beskriv den forventede forbedring af referatet.'],
    [
      'rationale',
      'Hvad er den faglige begrundelse?',
      'Beskriv de faglige hensyn og eventuelle test eller vurderinger, der støtter beslutningen.',
    ],
  ];
  if (!target)
    decisionFields.unshift([
      'changes',
      'Hvad registreres?',
      'Beskriv den første versions centrale indhold.',
    ]);
  return (
    <Modal
      title={sourceActive ? 'Registrér mødetype fra Roboref' : 'Upload en prompt'}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="stepper">
          <span className={step === 0 ? 'current' : 'done'}>
            <b>{step > 0 ? <Check size={13} /> : 1}</b>Fil og mødetype
          </span>
          <i />
          <span className={step === 1 ? 'current' : ''}>
            <b>2</b>Beslutning og begrundelse
          </span>
        </div>
        <div className="modal-body">
          {step === 0 ? (
            <>
              {sourceActive && source && (
                <div className="info-box">
                  <Info size={18} />
                  <div>
                    Mødetype hentet fra Roboref: <strong>{source.title}</strong> (ID {source.id}).
                    Historisk post fra {new Date(source.validFrom).toLocaleString('da-DK')}. Vælg
                    selv, om den skal knyttes til en eksisterende prompt. Den valgte historiske
                    posts felter gemmes samlet.
                  </div>
                </div>
              )}
              <div
                className={'dropzone ' + (drag ? 'drag' : '')}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  void load(e.dataTransfer.files[0]);
                }}
              >
                <div className="drop-icon">
                  {file ? <FileText size={27} /> : <UploadCloud size={29} />}
                </div>
                <strong>{file ? file.name : 'Træk din Markdown-fil hertil'}</strong>
                <p>
                  {file
                    ? `${file.content.split('\n').length} linjer · klar til registrering`
                    : 'eller vælg filen fra din computer'}
                </p>
                <button
                  className="button secondary small"
                  type="button"
                  onClick={() => input.current?.click()}
                >
                  {file ? 'Vælg en anden fil' : 'Vælg .md-fil'}
                </button>
                <input
                  ref={input}
                  type="file"
                  accept=".md,text/markdown"
                  hidden
                  onChange={(e) => void load(e.target.files?.[0])}
                />
                <small>Markdown (.md) · UTF-8 · Maks. 200 kB</small>
              </div>
              <div className="info-box" role="note">
                <Info size={18} />
                <div>
                  <strong>Ingen oplysninger om borgere.</strong> Læg ikke navne, cpr-numre,
                  adresser, helbredsoplysninger eller sagsforhold i prompter, begrundelser eller
                  eksempler. Appen er til at beskrive, hvordan en mødetype fungerer, ikke til
                  konkrete sager. Intet kan slettes igen.
                </div>
              </div>
              {!file && !data.prompts.length && (
                <button
                  type="button"
                  className="example-button"
                  onClick={async () => {
                    try {
                      const r = await fetch('/eksempel-prompt.md');
                      if (!r.ok) throw new Error();
                      await load(
                        new File([await r.arrayBuffer()], 'eksempel-prompt v1.md', {
                          type: 'text/markdown',
                        }),
                        true,
                      );
                    } catch {
                      setError('Eksempelfilen kunne ikke hentes. Vælg den lokale fil i stedet.');
                    }
                  }}
                >
                  <FileText size={18} />
                  <span>
                    <strong>Begynd med eksempelprompten</strong>
                    <small>Neutral eksempelprompt · klar til at prøve af</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              )}
              {file && (
                <>
                  <label className="field">
                    Hvilken prompt tilhører filen?
                    <select
                      value={target}
                      onChange={(e) => {
                        setComparison(null);
                        setComparisonError('');
                        setTarget(e.target.value);
                      }}
                    >
                      <option value="">Opret som en ny prompt</option>
                      {data.prompts
                        .filter((p) => !isArchived(data, p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            Ny version af: {p.title}
                          </option>
                        ))}
                    </select>
                    <small>
                      {sourceActive
                        ? 'Vælg den eksisterende prompt, hvis instruktionen hører til den. Ellers oprettes en ny prompt.'
                        : 'Forslaget bygger på filnavnet. Kontrollér valget inden du fortsætter.'}
                    </small>
                  </label>
                  {selected ? (
                    <div className="info-box">
                      <Info size={18} />
                      <div>
                        En ny version af <strong>{selected.title}</strong> registreres som{' '}
                        <strong>v{next}</strong>. Den gældende version ændres først efter
                        godkendelse.
                      </div>
                    </div>
                  ) : (
                    <div className="form-grid">
                      <label className="field full">
                        Navn på prompt
                        <input
                          required
                          maxLength={180}
                          value={fields.title}
                          readOnly={sourceActive}
                          onChange={(e) => update('title', e.target.value)}
                        />
                      </label>
                      <label className="field">
                        Mødetype
                        <input
                          required
                          maxLength={180}
                          value={fields.meetingType}
                          readOnly={sourceActive}
                          onChange={(e) => update('meetingType', e.target.value)}
                          placeholder="Fx opfølgningssamtale"
                        />
                      </label>
                      <label className="field">
                        Første registrerede version
                        <input
                          type="number"
                          min="1"
                          max="99999"
                          required
                          value={fields.initialVersion}
                          onChange={(e) => update('initialVersion', e.target.value)}
                        />
                        <small>Du kan starte ved fx v16. Tidligere versioner opfindes ikke.</small>
                      </label>
                      <label className="field full">
                        Formål med prompten
                        <textarea
                          required
                          maxLength={4000}
                          value={fields.purpose}
                          onChange={(e) => update('purpose', e.target.value)}
                          placeholder="Hvilket referat skal prompten hjælpe med at skabe?"
                        />
                      </label>
                      <label className="field">
                        Fagligt ansvarlig
                        <input
                          required
                          maxLength={180}
                          value={fields.owner}
                          onChange={(e) => update('owner', e.target.value)}
                        />
                      </label>
                      <label className="field">
                        Fagområde
                        <input
                          list="known-areas"
                          required
                          maxLength={180}
                          value={fields.department}
                          onChange={(e) => update('department', e.target.value)}
                          placeholder="Fx Afdeling A"
                        />
                        <datalist id="known-areas">
                          {Array.from(new Set(data.prompts.map((p) => p.department))).map(
                            (name) => (
                              <option key={name} value={name} />
                            ),
                          )}
                        </datalist>
                        <small>Vælg det fagområde, som mødetypen skal vises under.</small>
                      </label>
                    </div>
                  )}
                  <details className="file-preview">
                    <summary>Se filens indhold</summary>
                    <pre>{file.content}</pre>
                  </details>
                </>
              )}
            </>
          ) : (
            <>
              <div className="upload-summary">
                <FileText size={23} />
                <div>
                  <strong>{selected?.title || fields.title}</strong>
                  <small>{file?.name}</small>
                </div>
                <span className="version">v{next}</span>
              </div>
              <p className="muted">
                {target
                  ? 'Tekstændringerne registreres automatisk. Du skal beskrive årsagen, den forventede effekt og den faglige begrundelse.'
                  : 'Beslutningen gemmes sammen med versionen. Udfyld de fire felter nedenfor.'}
              </p>
              {target && comparison && (
                <section className="automatic-changes">
                  <div className="automatic-changes-title">
                    <strong>Registrerede tekstændringer</strong>
                    <span className="badge green">Automatisk</span>
                  </div>
                  <pre className="change-summary">{comparison.summary}</pre>
                  <details>
                    <summary>Se de markerede tekstændringer</summary>
                    <Diff before={comparison.beforeContent} after={file?.content || ''} />
                  </details>
                </section>
              )}
              {decisionFields.map(([key, label, placeholder]) => (
                <label className="field" key={key}>
                  {label}
                  <textarea
                    required
                    minLength={3}
                    maxLength={4000}
                    rows={3}
                    value={fields[key]}
                    onChange={(e) => update(key, e.target.value)}
                    placeholder={placeholder}
                  />
                </label>
              ))}
              <div className="info-box">
                <Info size={18} />
                <span>
                  Versionen gemmes som kladde. Godkend den særskilt, når den er gennemgået og taget
                  i brug i Roboref.
                </span>
              </div>
            </>
          )}
          {target && file && comparisonLoading && (
            <p className="micro" role="status">
              Sammenligner med den eksisterende version…
            </p>
          )}
          {comparisonError && (
            <div className="error" role="alert">
              <p>{comparisonError}</p>
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  setComparisonError('');
                  setCompareRevision((n) => n + 1);
                }}
              >
                Prøv sammenligningen igen
              </button>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="button ghost"
            onClick={() => (step ? setStep(0) : onClose())}
            disabled={busy}
          >
            {step ? (
              <>
                <ArrowLeft size={16} />
                Tilbage
              </>
            ) : (
              'Annuller'
            )}
          </button>
          <button
            className="button primary"
            disabled={!file || busy || (Boolean(target) && (!comparison || comparisonLoading))}
          >
            {busy ? 'Gemmer…' : step ? 'Gem som kladde' : 'Fortsæt'}
            {!busy && <ArrowRight size={16} />}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
