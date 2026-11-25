// Handlinger der arbejder på eksisterende versioner: arkivér/gendan, markér Roboref-tjek,
// afvis og godkend. Alle skrivninger er betingede, så to samtidige handlinger ikke
// kan overskrive hinanden.
import {
  INSERT_EVENT,
  RequestError,
  copenhagenToday,
  eventValues,
  insertEventWhere,
  requiredText,
} from './common.ts';
import type {HandlerContext, Row} from './common.ts';

type Body = Record<string, unknown>;
type ReviewContext = HandlerContext & {now: string};

async function findVersion(ctx: ReviewContext, versionId: string): Promise<Row> {
  const version = await ctx.db.prepare('SELECT * FROM versions WHERE id=?').bind(versionId).first();
  if (!version) throw new RequestError('Versionen findes ikke.', 404);
  return version;
}

export async function archiveOrRestore(
  ctx: ReviewContext,
  body: Body,
  action: 'archive' | 'restore',
) {
  const promptId = requiredText(body, 'promptId', 100);
  const prompt = await ctx.db.prepare('SELECT * FROM prompts WHERE id=?').bind(promptId).first();
  if (!prompt) throw new RequestError('Prompten findes ikke.', 404);
  const latest = await ctx.db
    .prepare('SELECT id FROM versions WHERE prompt_id=? ORDER BY number DESC LIMIT 1')
    .bind(promptId)
    .first();
  if (!latest) throw new RequestError('Prompten har ingen registreret version.', 409);

  const archiving = action === 'archive';
  await ctx.db.batch([
    ctx.db.prepare(INSERT_EVENT).bind(
      ...eventValues(ctx.user, {
        promptId,
        versionId: String(latest.id),
        action: archiving ? 'archived' : 'restored',
        now: ctx.now,
        detail: {
          note: archiving
            ? 'Prompten er arkiveret; historikken er bevaret.'
            : 'Prompten er gendannet fra arkiv.',
        },
      }),
    ),
  ]);
}

/** Registrerer, at en Roboref-ændring er gennemgået. Kræver, at versionen stammer fra netop den mødetype. */
export async function reviewRoboref(ctx: ReviewContext, body: Body) {
  const versionId = requiredText(body, 'versionId', 100);
  const reason = requiredText(body, 'reason', 4000);
  const sourceId = Number(body.sourceId);
  const validFrom = requiredText(body, 'validFrom', 80);
  if (!Number.isSafeInteger(sourceId) || sourceId < 1 || Number.isNaN(Date.parse(validFrom))) {
    throw new RequestError('Ugyldige kildeoplysninger.');
  }
  const version = await findVersion(ctx, versionId);

  const uploaded = await ctx.db
    .prepare("SELECT detail FROM events WHERE version_id=? AND action='uploaded'")
    .bind(versionId)
    .first();
  let source: unknown;
  try {
    source = JSON.parse(typeof uploaded?.detail === 'string' ? uploaded.detail : '{}').source;
  } catch {
    source = undefined;
  }
  const linked =
    source &&
    typeof source === 'object' &&
    'system' in source &&
    'id' in source &&
    source.system === 'Roboref' &&
    source.id === sourceId;
  if (!linked) throw new RequestError('Versionen er ikke knyttet til denne mødetype.');

  const fields = Array.isArray(body.fields)
    ? body.fields
        .filter((value): value is string => typeof value === 'string' && value.length < 100)
        .slice(0, 20)
    : [];
  await ctx.db.batch([
    ctx.db.prepare(INSERT_EVENT).bind(
      ...eventValues(ctx.user, {
        promptId: String(version.prompt_id),
        versionId,
        action: 'roboref_reviewed',
        now: ctx.now,
        detail: {sourceId, validFrom, fields, reason},
      }),
    ),
  ]);
}

export async function reject(ctx: ReviewContext, body: Body) {
  const versionId = requiredText(body, 'versionId', 100);
  const reason = requiredText(body, 'reason', 4000);
  const version = await findVersion(ctx, versionId);

  const insertIfPending = insertEventWhere(
    "EXISTS (SELECT 1 FROM versions WHERE id=? AND approved_at IS NULL) AND NOT EXISTS (SELECT 1 FROM events WHERE version_id=? AND action='rejected')",
  );
  const [result] = await ctx.db.batch([
    ctx.db.prepare(insertIfPending).bind(
      ...eventValues(ctx.user, {
        promptId: String(version.prompt_id),
        versionId,
        action: 'rejected',
        now: ctx.now,
        detail: {reason},
      }),
      versionId,
      versionId,
    ),
  ]);
  if (!result.meta.changes) {
    throw new RequestError('Versionen er allerede godkendt eller afvist. Opdater siden.', 409);
  }
}

/** Gyldig dato (YYYY-MM-DD), som faktisk findes i kalenderen og ikke ligger i fremtiden. */
function isValidEffectiveDate(value: string, today: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value &&
    value <= today
  );
}

export async function approve(ctx: ReviewContext, body: Body) {
  const versionId = requiredText(body, 'versionId', 100);
  const version = await findVersion(ctx, versionId);
  if (version.approved_at) throw new RequestError('Versionen er allerede godkendt.', 409);
  const rejected = await ctx.db
    .prepare("SELECT id FROM events WHERE version_id=? AND action='rejected'")
    .bind(versionId)
    .first();
  if (rejected) {
    throw new RequestError(
      'En afvist version kan ikke godkendes. Registrér en ny version i stedet.',
      409,
    );
  }

  const prompt = await ctx.db
    .prepare('SELECT * FROM prompts WHERE id=?')
    .bind(version.prompt_id)
    .first();
  if (!prompt) throw new RequestError('Prompten findes ikke.', 404);
  const active = prompt.active_version_id
    ? await ctx.db
        .prepare('SELECT * FROM versions WHERE id=?')
        .bind(prompt.active_version_id)
        .first()
    : null;
  if (
    active &&
    typeof version.number === 'number' &&
    typeof active.number === 'number' &&
    version.number <= active.number
  ) {
    throw new RequestError(
      'En nyere version er allerede gældende. Upload en ny version i stedet.',
      409,
    );
  }

  const effectiveDate = typeof body.effectiveDate === 'string' ? body.effectiveDate : '';
  if (effectiveDate && !isValidEffectiveDate(effectiveDate, copenhagenToday())) {
    throw new RequestError('Vælg en gyldig ibrugtagningsdato senest i dag.');
  }
  if (active && !effectiveDate)
    throw new RequestError('Ibrugtagningsdato skal udfyldes for en ny version.');
  if (active?.effective_date && effectiveDate < active.effective_date) {
    throw new RequestError('Datoen ligger før den nuværende versions ibrugtagning.');
  }
  const confirmation = requiredText(body, 'confirmation', 1000);

  // Tre betingede skrivninger i én transaktion: kun den, der først når frem, vinder.
  const results = await ctx.db.batch([
    ctx.db
      .prepare(
        "UPDATE prompts SET active_version_id=? WHERE id=? AND active_version_id IS ? AND EXISTS (SELECT 1 FROM versions WHERE id=? AND approved_at IS NULL) AND NOT EXISTS (SELECT 1 FROM events WHERE version_id=? AND action='rejected')",
      )
      .bind(versionId, prompt.id, prompt.active_version_id, versionId, versionId),
    ctx.db
      .prepare(
        "UPDATE versions SET approved_at=?,approved_by=?,approver_name=?,effective_date=? WHERE id=? AND approved_at IS NULL AND EXISTS (SELECT 1 FROM prompts WHERE id=? AND active_version_id=?) AND NOT EXISTS (SELECT 1 FROM events WHERE version_id=? AND action='rejected')",
      )
      .bind(
        ctx.now,
        ctx.user.userId,
        ctx.user.displayName,
        effectiveDate || null,
        versionId,
        prompt.id,
        versionId,
        versionId,
      ),
    ctx.db
      .prepare(
        insertEventWhere(
          'EXISTS (SELECT 1 FROM versions WHERE id=? AND approved_at=? AND approved_by=?)',
        ),
      )
      .bind(
        ...eventValues(ctx.user, {
          promptId: String(prompt.id),
          versionId,
          action: 'approved',
          now: ctx.now,
          detail: {
            confirmation,
            effectiveDate: effectiveDate || null,
            previousVersionId: prompt.active_version_id,
          },
        }),
        versionId,
        ctx.now,
        ctx.user.userId,
      ),
  ]);
  if (!results[0].meta.changes) {
    throw new RequestError(
      'En kollega har ændret den gældende version. Opdater siden og prøv igen.',
      409,
    );
  }
}
