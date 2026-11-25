import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {lineDiff, analyzeChanges} from '../src/shared/change-analysis.ts';
import {loadDotEnv, parseRoborefConfig, describeMissingConfig} from '../src/server/config.mjs';
import {openInBrowser} from '../src/server/open-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fields = {
  instruction: 'Instruktion',
  example: 'Eksempel',
  template: 'Skabelon',
  technicalTerms: 'Fagbegreber',
  unwantedPhrases: 'Uønskede formuleringer',
  defaultAgenda: 'Standarddagsorden',
  title: 'Titel',
  language: 'Sprog',
  showDisclaimer: 'Vis forbehold',
  disclaimerText: 'Forbeholdstekst',
  isTemplateEditable: 'Redigerbar skabelon',
  transcribeWithDiarization: 'Talergenkendelse',
  isDraft: 'Kladde',
  isShared: 'Delt',
};
const escape = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const formatDate = (s) =>
  s && !Number.isNaN(Date.parse(s))
    ? new Intl.DateTimeFormat('da-DK', {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: 'Europe/Copenhagen',
      }).format(new Date(s))
    : 'Dato ukendt';
export async function fetchHistory(id, {apiKey, baseUrl}, request = fetch) {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error('Mødetype-ID skal være et positivt heltal.');
  const res = await request(`${baseUrl}/meeting-type/${id}/history`, {
    headers: {'api-key': apiKey, Accept: 'application/json'},
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Roboref afviste forespørgslen (HTTP ${res.status}).`);
  const history = await res.json();
  if (!Array.isArray(history) || history.length < 2)
    throw new Error('Denne mødetype har færre end to historiske poster at sammenligne.');
  if (history.some((h) => !h.validFrom || Number.isNaN(Date.parse(h.validFrom))))
    throw new Error(
      'En historisk post mangler en gyldig dato; rækkefølgen kan ikke fastlægges sikkert.',
    );
  const sorted = [...history].sort((a, b) => Date.parse(a.validFrom) - Date.parse(b.validFrom));
  if (Date.parse(sorted.at(-2).validFrom) === Date.parse(sorted.at(-1).validFrom))
    throw new Error(
      'De seneste poster har samme tidspunkt; rækkefølgen kan ikke fastlægges sikkert.',
    );
  return {before: sorted.at(-2), after: sorted.at(-1), count: sorted.length};
}
export function renderPreview({before, after, count}, id) {
  let sections = '';
  for (const [key, label] of Object.entries(fields)) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    const a = before[key] == null ? '' : String(before[key]),
      b = after[key] == null ? '' : String(after[key]);
    const analysis = analyzeChanges(a, b, {baseNumber: 1, baseKind: 'active'});
    const lines = lineDiff(a, b)
      .map(
        (l) =>
          `<div class="line ${l.kind}"><span class="marker">${l.kind === 'added' ? '+' : l.kind === 'removed' ? '−' : ' '}</span><span>${escape(l.text) || '&nbsp;'}</span></div>`,
      )
      .join('');
    sections += `<section><h2>${escape(label)}</h2>${analysis.coarse ? '<p>Store ændringsblokke vises samlet; uændret tekst kan være markeret.</p>' : ''}${analysis.onlyLineEndings ? '<p>Kun linjeskift er ændret.</p>' : ''}<div class="diff">${lines}</div></section>`;
  }
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Roboref – prøvevisning</title><style>body{font:15px system-ui;background:#f4f7f1;color:#233b32;margin:0}main{max-width:1050px;margin:auto;padding:40px 24px}h1{font-size:30px}p{line-height:1.5}section{background:white;border:1px solid #dde6dc;border-radius:10px;margin:20px 0;padding:20px}.diff{font:13px/1.6 Consolas,monospace;border:1px solid #e1e8e0;overflow:auto}.line{display:flex;white-space:pre-wrap;overflow-wrap:anywhere;padding:1px 8px}.marker{width:24px;flex:none}.added{background:#dcefdc;color:#235b30}.removed{background:#fae1df;color:#8a302b}.legend{display:flex;gap:20px;flex-wrap:wrap}.tag{padding:5px 9px;border-radius:4px}</style></head><body><main><h1>${escape(after.title || before.title || 'Mødetype')} · prøvevisning</h1><p>Roboref ID ${id} · ${count} historiske poster. Sammenligner de to seneste poster:</p><p><strong>Før:</strong> ${escape(formatDate(before.validFrom))}<br><strong>Efter:</strong> ${escape(formatDate(after.validFrom))} (dansk tid)</p><p>Historiske poster er ikke nødvendigvis det samme som dine navngivne versioner. Begrundelser og faktisk ibrugtagning er ikke verificeret her.</p><div class="legend"><span class="tag removed">− Fjernet</span><span class="tag added">+ Tilføjet</span><span>Umarkeret tekst er uændret</span></div>${sections || '<section><h2>Ingen forskel i de undersøgte felter</h2><p>De to poster kan være forskellige på andre oplysninger.</p></section>'}<p>Prøvevisning er læst fra Roboref og ikke importeret i beslutningsloggen.</p></main></body></html>`;
}
async function main() {
  loadDotEnv(root);
  const config = parseRoborefConfig();
  if (!config.configured) throw new Error(describeMissingConfig(config));
  if (!process.argv[2]) throw new Error('Angiv mødetypens ID, fx: npm run roboref:preview -- 123');
  const id = Number(process.argv[2]),
    history = await fetchHistory(id, config);
  const dir = mkdtempSync(path.join(tmpdir(), 'roboref-preview-'));
  const filename = path.join(dir, 'sammenligning.html');
  writeFileSync(filename, renderPreview(history, id), {encoding: 'utf8', mode: 0o600});
  console.log(
    'Prøvevisningen åbnes i browseren. Den sammenligner de to seneste historiske poster.',
  );
  console.log('En midlertidig kopi af visningen ligger her: ' + filename);
  openInBrowser(pathToFileURL(filename).href);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error('Prøvevisningen kunne ikke åbnes: ' + e.message);
    process.exitCode = 1;
  });
