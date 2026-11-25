// GET /api/export: komplet eksport af prompter, versioner og hændelser som JSON.
import {json} from './common.ts';
import type {HandlerContext} from './common.ts';

export function createExportHandler({db, user}: HandlerContext) {
  return async function GET(): Promise<Response> {
    const [prompts, versions, events] = await db.batch([
      db.prepare('SELECT * FROM prompts ORDER BY created_at'),
      db.prepare('SELECT * FROM versions ORDER BY prompt_id,number'),
      db.prepare('SELECT * FROM events ORDER BY occurred_at,id'),
    ]);
    return json(
      {
        format: 'roboref-beslutningslog',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        exportedBy: {id: user.userId, name: user.displayName, email: user.email},
        note: 'Registrering af brug i Roboref sker manuelt. Historik før første registrerede version er ikke dokumenteret her.',
        prompts: prompts.results,
        versions: versions.results,
        events: events.results,
      },
      200,
      {'Content-Disposition': 'attachment; filename="roboref-beslutningslog.json"'},
    );
  };
}
