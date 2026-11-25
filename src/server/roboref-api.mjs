import {describeMissingConfig} from './config.mjs';

const MAX_REQUEST_BYTES = 10_000;
const REMOTE_TIMEOUT_MS = 20_000;

const isPositiveId = (value) => Number.isSafeInteger(value) && value > 0;

function toMeetingTypeListItem(item) {
  return {
    id: item.id,
    title: String(item.title || 'Uden navn'),
    isDraft: Boolean(item.isDraft),
    teams: Array.isArray(item.teams) ? item.teams.filter((team) => typeof team === 'string') : [],
  };
}

function toHistoryItems(items) {
  return items
    .filter(
      (item) =>
        item &&
        typeof item.instruction === 'string' &&
        item.validFrom &&
        !Number.isNaN(Date.parse(item.validFrom)),
    )
    .map((item) => ({...item, validTo: item.validTo ?? null}))
    .sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom));
}

/**
 * Læsende proxy til Roboref. API-nøglen læses kun fra serverens opsætning
 * og forlader aldrig serveren; browseren sender ingen nøgle.
 *
 * @param {Request} request
 * @param {string} origin den tilladte oprindelse (appens egen adresse)
 * @param {ReturnType<import('./config.mjs').parseRoborefConfig>} config
 * @param {typeof fetch} remoteFetch kan udskiftes i tests
 */
export async function roborefRequest(request, origin, config, remoteFetch = fetch) {
  const reply = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'},
    });

  if (request.method !== 'POST' || request.headers.get('origin') !== origin) {
    return reply({error: 'Ugyldig forespørgsel.'}, 403);
  }
  if (!config.configured) return reply({error: describeMissingConfig(config)}, 503);

  try {
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) return reply({error: 'Forespørgslen er for stor.'}, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply({error: 'Ugyldig forespørgsel.'}, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply({error: 'Ugyldig forespørgsel.'}, 400);
    }

    let endpoint;
    if (body.action === 'list') endpoint = '/meeting-type';
    else if (body.action === 'history' && isPositiveId(body.id))
      endpoint = `/meeting-type/${body.id}/history`;
    else return reply({error: 'Ugyldigt valg.'}, 400);

    const response = await remoteFetch(config.baseUrl + endpoint, {
      headers: {'api-key': config.apiKey, Accept: 'application/json'},
      redirect: 'error',
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return reply(
        {error: `Roboref afviste forespørgslen (HTTP ${response.status}).`},
        response.status === 401 ? 401 : 502,
      );
    }

    const result = await response.json();
    if (!Array.isArray(result)) throw new Error('Uventet svar fra Roboref.');
    if (body.action === 'list') {
      return reply({
        items: result.filter((item) => isPositiveId(item?.id)).map(toMeetingTypeListItem),
      });
    }
    return reply({items: toHistoryItems(result)});
  } catch {
    return reply({error: 'Forbindelsen til Roboref kunne ikke gennemføres. Prøv igen.'}, 502);
  }
}
