import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {loadDotEnv, parseRoborefConfig, describeMissingConfig} from '../src/server/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fields = [
  'title',
  'instruction',
  'example',
  'template',
  'technicalTerms',
  'unwantedPhrases',
  'defaultAgenda',
  'showDisclaimer',
  'isTemplateEditable',
  'disclaimerText',
  'transcribeWithDiarization',
  'language',
  'isDraft',
  'isShared',
];
export async function inspectApi({apiKey, baseUrl}, request = fetch) {
  async function get(path) {
    const response = await request(baseUrl + path, {
      headers: {'api-key': apiKey, Accept: 'application/json'},
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      if (response.status === 401)
        throw new Error(
          `HTTP 401 ved ${path}: Adgangen blev afvist. Kontrollér API-nøglen og dens adgang i Roboref.`,
        );
      throw new Error(`Roboref svarede med HTTP ${response.status} ved ${path}.`);
    }
    return response.json();
  }
  const meetings = await get('/meeting-type');
  if (!Array.isArray(meetings))
    throw new Error('Listen over mødetypesvar havde et uventet format.');
  const result = [];
  for (const meeting of meetings) {
    if (!Number.isSafeInteger(meeting.id) || meeting.id < 1)
      throw new Error('En mødetype havde et ugyldigt ID.');
    try {
      const history = await get(`/meeting-type/${meeting.id}/history`);
      if (!Array.isArray(history)) throw new Error('Uventet format for historik.');
      const sorted = [...history].sort((a, b) =>
        String(a.validFrom || '').localeCompare(String(b.validFrom || '')),
      );
      const changes = sorted.slice(1).map((item, i) => ({
        validFrom: item.validFrom || null,
        fields: fields.filter(
          (field) => JSON.stringify(sorted[i][field]) !== JSON.stringify(item[field]),
        ),
      }));
      result.push({id: meeting.id, title: meeting.title, versions: sorted.length, changes});
    } catch (error) {
      result.push({id: meeting.id, title: meeting.title, error: error.message});
    }
  }
  return result;
}

async function main() {
  loadDotEnv(root);
  const config = parseRoborefConfig();
  if (!config.configured) throw new Error(describeMissingConfig(config));
  console.log('\nHenter mødetypeoversigt og historik fra Roboref...\n');
  const items = await inspectApi(config);
  console.log(`Fandt ${items.length} mødetype(r).\n`);
  for (const item of items) {
    console.log(`${item.title || '(uden navn)'} (ID ${item.id})`);
    if (item.error) {
      console.log(`  Historik kunne ikke hentes: ${item.error}\n`);
      continue;
    }
    console.log(`  Historiske poster: ${item.versions}`);
    for (const change of item.changes)
      console.log(
        `  ${change.validFrom || 'Dato mangler'}: ${change.fields.length ? change.fields.join(', ') : 'Ingen forskel i de undersøgte felter'}`,
      );
    console.log('');
  }
  console.log('Testen har kun læst data. Intet er importeret eller gemt i beslutningsloggen.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error('\nTesten kunne ikke gennemføres:', error.message);
    process.exitCode = 1;
  });
