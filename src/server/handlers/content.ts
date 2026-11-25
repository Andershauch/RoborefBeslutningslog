// GET /api/content?id=<versions-id>: selve prompteksten for én version.
import {RequestError, json, requirePermission} from './common.ts';
import type {HandlerContext} from './common.ts';

export function createContentHandler({db, user}: HandlerContext) {
  return async function GET(request: Request): Promise<Response> {
    try {
      requirePermission(user, 'read');
    } catch (error) {
      if (error instanceof RequestError) return json({error: error.message}, error.status);
      throw error;
    }
    const id = new URL(request.url).searchParams.get('id');
    const version = id
      ? await db
          .prepare('SELECT content,filename FROM versions WHERE id=?')
          .bind(id)
          .first<{content: string; filename: string}>()
      : null;
    if (!version) return json({error: 'Versionen blev ikke fundet.'}, 404);
    return json(version);
  };
}
