// Upload af en ny prompt eller en ny version, og forhåndssammenligning ("compare").
// En eksisterende prompts ændringsbeskrivelse udregnes altid på serveren; en tekst
// fra klienten kan ikke erstatte den faktiske sammenligning.
import {analyzeChanges} from '../../shared/change-analysis.ts';
import {
  RequestError,
  eventValues,
  insertEventWhere,
  json,
  requiredText,
  sha256Hex,
} from './common.ts';
import type {HandlerContext, Row, Statement} from './common.ts';

type Body = Record<string, unknown>;
type UploadContext = HandlerContext & {now: string};

const MAX_CONTENT_BYTES = 200_000;
const COMPARISON_CHANGED =
  'Sammenligningsgrundlaget er ændret. Gennemgå den opdaterede sammenligning, og gem igen.';

const INSERT_VERSION_COLUMNS =
  'INSERT INTO versions (id,prompt_id,number,filename,content,sha256,changes,reason,outcome,rationale,created_at,author_id,author_name,author_email)';

interface RoborefSource {
  system: 'Roboref';
  id: number;
  title: string;
  validFrom: string;
  validTo: string | null;
  field: string;
}

/** Validerer og normaliserer oplysninger om, hvilken Roboref-mødetype en version stammer fra. */
function parseSource(raw: unknown): RoborefSource {
  const invalid = new RequestError('Ugyldige kildeoplysninger.');
  if (!raw || typeof raw !== 'object') throw invalid;
  const s = raw as Record<string, unknown>;
  const isDate = (value: unknown): value is string =>
    typeof value === 'string' && !Number.isNaN(Date.parse(value));
  if (
    s.system !== 'Roboref' ||
    !['instruction', 'meetingType'].includes(String(s.field)) ||
    !Number.isSafeInteger(s.id) ||
    Number(s.id) < 1 ||
    typeof s.title !== 'string' ||
    s.title.length > 300 ||
    !isDate(s.validFrom) ||
    (s.validTo !== null && !isDate(s.validTo))
  ) {
    throw invalid;
  }
  return {
    system: 'Roboref',
    id: Number(s.id),
    title: s.title,
    validFrom: s.validFrom,
    validTo: s.validTo as string | null,
    field: String(s.field),
  };
}

function parseContent(body: Body): string {
  const content = body.content;
  const invalid =
    typeof content !== 'string' ||
    !content.trim() ||
    content.includes('\u0000') ||
    content.includes('�') ||
    new TextEncoder().encode(content).length > MAX_CONTENT_BYTES;
  if (invalid) throw new RequestError('Filen skal indeholde gyldig UTF-8-tekst, højst 200 kB.');
  return content as string;
}

export async function uploadOrCompare(
  ctx: UploadContext,
  body: Body,
  action: 'upload' | 'compare',
): Promise<Response> {
  const {db, user, now} = ctx;
  const filename = requiredText(body, 'filename', 240);
  if (!/\.md$/i.test(filename)) throw new RequestError('Upload en Markdown-fil (.md).');
  const content = parseContent(body);
  const sha256 = await sha256Hex(content);

  const existingId = typeof body.promptId === 'string' && body.promptId ? body.promptId : null;
  const prompt = existingId
    ? await db.prepare('SELECT * FROM prompts WHERE id=?').bind(existingId).first()
    : null;
  if (existingId && !prompt) throw new RequestError('Prompten findes ikke.', 404);
  const promptId = existingId || crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const expectedBaseId =
    typeof body.expectedBaseVersionId === 'string' ? body.expectedBaseVersionId : null;

  // Sammenligningsgrundlag: den gældende version, ellers den nyeste.
  let base: Row | null = null;
  let analysis: ReturnType<typeof analyzeChanges> | null = null;
  let comparison: Record<string, unknown> | null = null;
  if (existingId && prompt) {
    base = await db
      .prepare(
        'SELECT id,number,content FROM versions WHERE prompt_id=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,number DESC LIMIT 1',
      )
      .bind(promptId, prompt.active_version_id || '')
      .first();
    if (!base || typeof base.content !== 'string' || typeof base.number !== 'number') {
      throw new RequestError('Prompten har ingen gyldig version at sammenligne med.', 409);
    }
    const baseKind = prompt.active_version_id === base.id ? 'active' : 'latest';
    analysis = analyzeChanges(base.content, content, {baseNumber: base.number, baseKind});
    comparison = {
      baseVersionId: base.id,
      baseVersionNumber: base.number,
      baseKind,
      method: analysis.method,
      addedLines: analysis.addedLines,
      removedLines: analysis.removedLines,
      onlyLineEndings: analysis.onlyLineEndings,
      coarse: analysis.coarse,
    };
    if (action === 'upload' && expectedBaseId !== null && expectedBaseId !== base.id) {
      throw new RequestError(COMPARISON_CHANGED, 409, 'comparison_changed');
    }
    const duplicate = await db
      .prepare('SELECT number FROM versions WHERE prompt_id=? AND sha256=?')
      .bind(promptId, sha256)
      .first<{number: number}>();
    if (duplicate) {
      throw new RequestError(
        `Identisk indhold er allerede registreret som v${duplicate.number}. Ingen ny version er oprettet.`,
        409,
      );
    }
  }

  if (action === 'compare') {
    if (!base || !analysis || !comparison)
      throw new RequestError('Vælg en eksisterende prompt at sammenligne med.');
    return json({comparison, summary: analysis.summary, beforeContent: base.content});
  }

  // Versionsnummer: næste nummer for en eksisterende prompt, ellers brugerens startnummer.
  const latest = existingId
    ? await db
        .prepare('SELECT MAX(number) AS n FROM versions WHERE prompt_id=?')
        .bind(promptId)
        .first<{n: number}>()
    : null;
  const number = latest?.n ? latest.n + 1 : Number(body.initialVersion || 1);
  if (!Number.isInteger(number) || number < 1 || number > 99999) {
    throw new RequestError('Versionsnummer skal være et helt tal mellem 1 og 99999.');
  }
  const changes = analysis?.summary || requiredText(body, 'changes');
  const reason = requiredText(body, 'reason');
  const outcome = requiredText(body, 'outcome');
  const rationale = requiredText(body, 'rationale');

  const statements: Statement[] = [];
  if (!existingId) {
    statements.push(
      db
        .prepare(
          'INSERT INTO prompts (id,title,meeting_type,purpose,owner,department,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)',
        )
        .bind(
          promptId,
          requiredText(body, 'title', 180),
          requiredText(body, 'meetingType', 180),
          requiredText(body, 'purpose'),
          requiredText(body, 'owner', 180),
          requiredText(body, 'department', 180),
          now,
          user.userId,
        ),
    );
  }

  const versionIndex = statements.length;
  const versionValues = [
    versionId,
    promptId,
    number,
    filename,
    content,
    sha256,
    changes,
    reason,
    outcome,
    rationale,
    now,
    user.userId,
    user.displayName,
    user.email,
  ];
  if (existingId && prompt && base && expectedBaseId !== null) {
    // Gem kun, hvis den gældende version (og dermed sammenligningen) ikke er ændret siden forhåndsvisningen.
    statements.push(
      db
        .prepare(
          `${INSERT_VERSION_COLUMNS} SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM prompts WHERE id=? AND active_version_id IS ?) AND (? IS NOT NULL OR (SELECT id FROM versions WHERE prompt_id=? ORDER BY number DESC LIMIT 1)=?)`,
        )
        .bind(
          ...versionValues,
          promptId,
          prompt.active_version_id,
          prompt.active_version_id,
          promptId,
          base.id,
        ),
    );
  } else {
    statements.push(
      db
        .prepare(`${INSERT_VERSION_COLUMNS} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(...versionValues),
    );
  }

  const source = body.source !== undefined ? parseSource(body.source) : undefined;
  statements.push(
    db.prepare(insertEventWhere('EXISTS (SELECT 1 FROM versions WHERE id=?)')).bind(
      ...eventValues(user, {
        promptId,
        versionId,
        action: 'uploaded',
        now,
        detail: {
          filename,
          sha256,
          number,
          initial: !existingId,
          ...(source ? {source} : {}),
          ...(comparison ? {comparison} : {}),
        },
      }),
      versionId,
    ),
  );

  const results = await db.batch(statements);
  if (!results[versionIndex].meta.changes) {
    throw new RequestError(COMPARISON_CHANGED, 409, 'comparison_changed');
  }
  return json({ok: true, promptId, versionId}, 201);
}
