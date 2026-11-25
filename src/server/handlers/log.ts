// POST/GET /api/log: læser hele beslutningsloggen og modtager alle ændringer.
// Handlingerne ligger i log-review.ts og log-upload.ts.
import {RequestError, json, parseJsonObject, requirePermission} from './common.ts';
import type {HandlerContext} from './common.ts';
import type {Permission} from '../../shared/roles.ts';
import {approve, archiveOrRestore, reject, reviewRoboref} from './log-review.ts';
import {uploadOrCompare} from './log-upload.ts';

const MAX_REQUEST_BYTES = 350_000;
const FILE_TOO_LARGE = 'Filen er for stor.';

// Hvilken rettighed hver handling kræver. Ukendte handlinger afvises som ugyldige.
const ACTION_PERMISSIONS: Record<string, Permission> = {
  upload: 'write',
  compare: 'write',
  archive: 'write',
  restore: 'write',
  review_roboref: 'write',
  approve: 'decide',
  reject: 'decide',
};

export function createLogHandlers(context: HandlerContext) {
  async function GET(): Promise<Response> {
    const {db} = context;
    try {
      requirePermission(context.user, 'read');
    } catch (error) {
      return errorResponse(error);
    }
    try {
      const [prompts, versions, events] = await db.batch([
        db.prepare('SELECT * FROM prompts ORDER BY created_at DESC'),
        // Selve prompteksten hentes først via /api/content, så oversigten forbliver let.
        db.prepare(
          'SELECT id,prompt_id,number,filename,sha256,changes,reason,outcome,rationale,created_at,author_id,author_name,author_email,approved_at,approved_by,approver_name,effective_date FROM versions ORDER BY number DESC',
        ),
        db.prepare('SELECT * FROM events ORDER BY occurred_at DESC,id DESC'),
      ]);
      return json({prompts: prompts.results, versions: versions.results, events: events.results});
    } catch {
      return json({error: 'Beslutningsloggen kunne ikke hentes. Prøv igen om lidt.'}, 503);
    }
  }

  async function POST(request: Request): Promise<Response> {
    // Kun kald fra appens egen side accepteres (beskytter mod forfalskede forespørgsler fra andre websteder).
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin)
      return json({error: 'Ugyldig forespørgsel.'}, 403);
    if (Number(request.headers.get('content-length') || 0) > MAX_REQUEST_BYTES)
      return json({error: FILE_TOO_LARGE}, 413);

    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES)
        return json({error: FILE_TOO_LARGE}, 413);
      const body = parseJsonObject(raw);
      const required = ACTION_PERMISSIONS[String(body.action)];
      if (required) requirePermission(context.user, required);
      const ctx = {...context, now: new Date().toISOString()};

      switch (body.action) {
        case 'archive':
        case 'restore':
          await archiveOrRestore(ctx, body, body.action);
          return json({ok: true});
        case 'review_roboref':
          await reviewRoboref(ctx, body);
          return json({ok: true});
        case 'reject':
          await reject(ctx, body);
          return json({ok: true});
        case 'approve':
          await approve(ctx, body);
          return json({ok: true});
        case 'upload':
        case 'compare':
          return await uploadOrCompare(ctx, body, body.action);
        default:
          throw new RequestError('Ukendt handling.');
      }
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {GET, POST};
}

function errorResponse(error: unknown): Response {
  if (error instanceof RequestError) {
    return json({error: error.message, ...(error.code ? {code: error.code} : {})}, error.status);
  }
  const message = error instanceof Error ? error.message : '';
  if (/UNIQUE constraint/i.test(message)) {
    return json(
      {
        error:
          'Indholdet eller versionsnummeret findes allerede. Opdater siden, og kontrollér historikken.',
      },
      409,
    );
  }
  return json({error: 'Ændringen kunne ikke gemmes. Opdater siden, og prøv igen.'}, 500);
}
