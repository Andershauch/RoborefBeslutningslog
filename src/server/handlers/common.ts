// Fælles typer og hjælpefunktioner for API-handlerne.
// Filen køres direkte af Node (type stripping): brug kun `import type` til typer,
// og undgå enums og parameter properties.
import {can} from '../../shared/roles.ts';
import type {Permission, Role} from '../../shared/roles.ts';

export type Row = Record<string, string | number | null>;

/** Den del af databasen, handlerne bruger. Implementeres af SQLite-adapteren i storage.mjs. */
export interface Statement {
  bind(...args: unknown[]): Statement;
  first<T = Row>(): Promise<T | null>;
}
export interface BatchResult {
  results: Row[];
  meta: {changes: number};
}
export interface Database {
  prepare(query: string): Statement;
  batch(statements: Statement[]): Promise<BatchResult[]>;
}

/** Den bruger, som handlinger registreres på. */
export interface Actor {
  userId: string;
  displayName: string;
  email: string;
  /** Roller, der afgør hvad brugeren må (se src/shared/roles.ts). */
  roles: Role[];
  /** Sand, når identiteten er bekræftet af et login (fx Entra ID). Lokalt er den falsk. */
  identityVerified: boolean;
}

/** Organisatoriske regler, som kan slås til i opsætningen. */
export interface Policy {
  /** Den, der uploadede en version, må ikke selv godkende den. */
  fourEyes: boolean;
}

export interface HandlerContext {
  db: Database;
  user: Actor;
  policy?: Policy;
}

/** Fejl, der skal vises for brugeren med en bestemt HTTP-status. */
export class RequestError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Kræver en rettighed. Serveren håndhæver altid rettigheder; brugerfladen skjuler blot knapper. */
export function requirePermission(user: Actor, permission: Permission): void {
  if (!can(user.roles, permission)) {
    throw new RequestError('Du har ikke rettighed til denne handling.', 403);
  }
}

/** Fortolker en JSON-forespørgsel, som skal være et objekt. Alt andet er en klientfejl (400). */
export function parseJsonObject(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RequestError('Forespørgslen er ikke gyldig JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError('Forespørgslen skal være et JSON-objekt.');
  }
  return value as Record<string, unknown>;
}

const SECURE_HEADERS = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, {status, headers: {...SECURE_HEADERS, ...headers}});
}

/** Henter et påkrævet tekstfelt fra en forespørgsel. */
export function requiredText(body: Record<string, unknown>, key: string, max = 4000): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new RequestError(`Udfyld feltet ${key} (maks. ${max} tegn).`);
  }
  return value.trim();
}

/** Dags dato (YYYY-MM-DD) efter dansk tid. */
export function copenhagenToday(): string {
  return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Copenhagen'}).format(new Date());
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const EVENT_COLUMNS =
  'id,prompt_id,version_id,action,occurred_at,actor_id,actor_name,actor_email,detail,identity_verified';
export const INSERT_EVENT = `INSERT INTO events (${EVENT_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?)`;
/** Indsætter kun hændelsen, hvis betingelsen (en WHERE-klausul) er opfyldt. Gør skrivninger atomiske. */
export const insertEventWhere = (condition: string) =>
  `INSERT INTO events (${EVENT_COLUMNS}) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${condition}`;

/** De ti første værdier i en hændelse, i samme rækkefølge som EVENT_COLUMNS. */
export function eventValues(
  actor: Actor,
  event: {promptId: string; versionId: string; action: string; now: string; detail: unknown},
): unknown[] {
  return [
    crypto.randomUUID(),
    event.promptId,
    event.versionId,
    event.action,
    event.now,
    actor.userId,
    actor.displayName,
    actor.email,
    JSON.stringify(event.detail),
    actor.identityVerified ? 1 : 0,
  ];
}
