import type {ComparisonBasis} from '../shared/change-analysis';
export type Prompt = {
  id: string;
  title: string;
  meeting_type: string;
  purpose: string;
  owner: string;
  department: string;
  created_at: string;
  created_by: string;
  active_version_id: string | null;
};
export type Version = {
  id: string;
  prompt_id: string;
  number: number;
  filename: string;
  sha256: string;
  changes: string;
  reason: string;
  outcome: string;
  rationale: string;
  created_at: string;
  author_name: string;
  author_email: string;
  approved_at: string | null;
  approver_name: string | null;
  effective_date: string | null;
};
export type Event = {
  id: string;
  prompt_id: string;
  version_id: string;
  action: string;
  occurred_at: string;
  actor_name: string;
  actor_email: string;
  detail: string;
  /** 1, når handlingen blev udført af en bruger, der var bekræftet af et login. */
  identity_verified?: number;
};
export type Data = {prompts: Prompt[]; versions: Version[]; events: Event[]};
export async function readJson<T>(response: Response): Promise<T> {
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Serveren returnerede et ugyldigt svar.');
  return value as T;
}
export function isArchived(data: Data, promptId: string) {
  return (
    data.events.find(
      (e) => e.prompt_id === promptId && (e.action === 'archived' || e.action === 'restored'),
    )?.action === 'archived'
  );
}
export function comparisonFor(data: Data, versionId: string): ComparisonBasis | null {
  const event = data.events.find((e) => e.version_id === versionId && e.action === 'uploaded');
  if (!event) return null;
  try {
    const comparison = JSON.parse(event.detail).comparison;
    return comparison?.method === 'line-diff-v1' && typeof comparison.baseVersionId === 'string'
      ? comparison
      : null;
  } catch {
    return null;
  }
}
export function rejectionFor(data: Data, versionId: string) {
  return data.events.find((e) => e.version_id === versionId && e.action === 'rejected');
}
export function pending(v: Version, data: Data) {
  const p = data.prompts.find((p) => p.id === v.prompt_id),
    active = data.versions.find((x) => x.id === p?.active_version_id);
  return !v.approved_at && !rejectionFor(data, v.id) && (!active || v.number > active.number);
}
export const date = (v: string | null, time = false) =>
  v
    ? new Intl.DateTimeFormat('da-DK', {
        dateStyle: 'medium',
        ...(time ? {timeStyle: 'short'} : {}),
        timeZone: 'Europe/Copenhagen',
      }).format(new Date(v.length === 10 ? v + 'T12:00:00Z' : v))
    : 'Ikke oplyst';
export const today = () =>
  new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Copenhagen'}).format(new Date());
export function normalize(s: string) {
  return s
    .toLocaleLowerCase('da-DK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(?:version|prompt|v)?[\s_-]*\d+(?:\.\d+)*$/i, '')
    .replace(/\.md$/, '')
    .replace(/(?:version|prompt|v)?[\s_-]*\d+(?:\.\d+)*$/i, '')
    .replace(/[^a-zæøå0-9]+/g, ' ')
    .trim();
}
export function download(content: string, name: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
