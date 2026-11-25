import type {Data} from './types';

export type Link = {promptId: string; id: number; title: string};
export type RemoteInfo = {
  title: string;
  editor: string | null;
  validFrom: string | null;
  error?: string;
};
type RoborefRecord = Record<string, unknown>;
function isRecord(value: unknown): value is RoborefRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function roborefLinks(data: Data): Link[] {
  return data.prompts.flatMap((p) => {
    const versions = data.versions
      .filter((v) => v.prompt_id === p.id)
      .sort((a, b) => b.number - a.number);
    for (const v of versions) {
      try {
        const source = JSON.parse(
          data.events.find((e) => e.version_id === v.id && e.action === 'uploaded')?.detail || '{}',
        ).source;
        if (source?.system === 'Roboref' && Number.isSafeInteger(source.id))
          return [{promptId: p.id, id: source.id, title: source.title || p.title}];
      } catch {
        /* uventet svar: behandles som uden historik */
      }
    }
    return [];
  });
}
export async function fetchRoborefOverview(
  links: Link[],
  call: (body: object) => Promise<unknown[]>,
): Promise<Record<string, RemoteInfo>> {
  const list = (await call({action: 'list'})).filter(
    (item): item is RoborefRecord => isRecord(item) && typeof item.id === 'number',
  );
  const byId = new Map(list.map((m) => [m.id as number, m]));
  const out: Record<string, RemoteInfo> = {};
  // Limit simultaneous requests so the municipal API is not flooded on startup.
  for (let i = 0; i < links.length; i += 5)
    await Promise.all(
      links.slice(i, i + 5).map(async (link) => {
        const meeting = byId.get(link.id);
        if (!meeting) {
          out[link.promptId] = {
            title: link.title,
            editor: null,
            validFrom: null,
            error: 'Mødetypen blev ikke fundet i Roboref',
          };
          return;
        }
        try {
          const history = await call({action: 'history', id: link.id});
          const latest = isRecord(history[0]) ? history[0] : undefined;
          const editedBy = isRecord(latest?.editedBy) ? latest.editedBy : undefined;
          out[link.promptId] = {
            title: typeof meeting.title === 'string' && meeting.title ? meeting.title : link.title,
            editor: typeof editedBy?.name === 'string' ? editedBy.name : null,
            validFrom: typeof latest?.validFrom === 'string' ? latest.validFrom : null,
            ...(!latest ? {error: 'Historik ikke tilgængelig'} : {}),
          };
        } catch {
          out[link.promptId] = {
            title: typeof meeting.title === 'string' && meeting.title ? meeting.title : link.title,
            editor: null,
            validFrom: null,
            error: 'Historik kunne ikke hentes',
          };
        }
      }),
    );
  return out;
}
