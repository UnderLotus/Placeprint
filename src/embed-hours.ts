import type { Weekday } from './place-info';
import {
  readHours,
  type SearchFetchOptions,
  type SearchPlaceCandidate,
} from './vela-search';

export interface EmbedHoursRequest {
  endpoint: string;
  proxyUrl: string;
}

const EMBED_ORIGIN = 'https://www.google.com/maps';

function defaultLanguage(): string {
  return typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : 'en';
}

function localeRegion(language: string): string | undefined {
  const segments = language.replace(/_/g, '-').split('-');
  for (let index = 1; index < segments.length; index += 1) {
    if (/^(?:[A-Za-z]{2}|\d{3})$/.test(segments[index])) {
      return segments[index].toLowerCase();
    }
  }
  return undefined;
}

export function buildEmbedHoursRequest(
  candidate: Pick<SearchPlaceCandidate, 'name' | 'lat' | 'lng'>,
  language = defaultLanguage(),
): EmbedHoursRequest {
  const endpointUrl = new URL(EMBED_ORIGIN);
  endpointUrl.searchParams.set(
    'q',
    candidate.name + ' ' + candidate.lat + ',' + candidate.lng,
  );
  endpointUrl.searchParams.set('hl', language);
  const region = localeRegion(language);
  if (region) {
    endpointUrl.searchParams.set('gl', region);
  }
  endpointUrl.searchParams.set('output', 'embed');
  const endpoint = endpointUrl.toString();
  return {
    endpoint,
    proxyUrl:
      'https://allorigins.hexlet.app/raw?url=' + encodeURIComponent(endpoint),
  };
}

/**
 * Locate only the JSON argument passed to initEmbed(). This scanner never
 * evaluates script text; JSON.parse is the sole decoder for the argument.
 */
export function extractInitEmbedJson(html: string): string | undefined {
  const markerIndex = html.indexOf('initEmbed(');
  if (markerIndex < 0) {
    return undefined;
  }

  let start = markerIndex + 'initEmbed('.length;
  while (/\s/.test(html[start] || '')) {
    start += 1;
  }
  if (html[start] !== '[' && html[start] !== '{') {
    return undefined;
  }

  const opening = html[start];
  const closing = opening === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '[' || character === '{') {
      depth += 1;
      continue;
    }
    if (character === ']' || character === '}') {
      depth -= 1;
      if (depth < 0) {
        return undefined;
      }
      if (depth === 0) {
        if (character !== closing) {
          return undefined;
        }
        return html.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function recognizedHoursCount(
  weeklyHours: Partial<Record<Weekday, string>> | undefined,
): number {
  return weeklyHours ? Object.keys(weeklyHours).length : 0;
}

export function countRecognizedWeekdays(
  weeklyHours: Partial<Record<Weekday, string>> | undefined,
): number {
  return recognizedHoursCount(weeklyHours);
}

const MAX_SCHEDULE_ARRAYS = 100_000;

function findBestSchedule(root: unknown): Partial<Record<Weekday, string>> | undefined {
  let best: Partial<Record<Weekday, string>> | undefined;
  let bestCount = 0;
  const pending: unknown[] = [root];
  let visitedArrays = 0;

  while (pending.length && visitedArrays < MAX_SCHEDULE_ARRAYS) {
    const value = pending.pop();
    if (!Array.isArray(value)) {
      continue;
    }
    visitedArrays += 1;

    const weeklyHours = readHours(value);
    const count = recognizedHoursCount(weeklyHours);
    if (count > bestCount) {
      best = weeklyHours;
      bestCount = count;
    }
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const child = value[index];
      if (Array.isArray(child)) {
        pending.push(child);
      }
    }
  }

  return best;
}

export function parseEmbedWeeklyHours(
  html: string,
): Partial<Record<Weekday, string>> | undefined {
  const json = extractInitEmbedJson(html);
  if (!json) {
    return undefined;
  }

  let root: unknown;
  try {
    root = JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
  return findBestSchedule(root);
}

/**
 * Fetch enrichment through the existing AllOrigins boundary. Network and
 * response-format failures intentionally downgrade to unavailable data, while
 * parsing itself remains deterministic and does not execute remote code.
 */
export async function fetchEmbedWeeklyHours(
  candidate: Pick<SearchPlaceCandidate, 'name' | 'lat' | 'lng'>,
  options: SearchFetchOptions = {},
): Promise<Partial<Record<Weekday, string>> | undefined> {
  const request = buildEmbedHoursRequest(candidate, options.language);
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(request.proxyUrl, {
      method: 'GET',
      headers: { Accept: 'text/html' },
    });
  } catch {
    return undefined;
  }
  if (!response.ok) {
    return undefined;
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return undefined;
  }
  return parseEmbedWeeklyHours(body);
}
