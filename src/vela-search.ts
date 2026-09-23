/*
 * This file ports the narrow Vela search subset used by Share Card.
 * Upstream: PimpinPumpkin/Vela @ 9e019bf740deebcb6da276ba09cbcf75542f1e34.
 * Source files: SearchPb.kt, GoogleResponse.kt, parse/SearchParser.kt, and
 * GoogleMapsDataSource.kt. See NOTICE for attribution and scope.
 */
import type { Calibration } from './calibration';
import type { ParsedMapsUrl } from './maps-url';
import type { Weekday } from './place-info';

export const DEFAULT_VIEWPORT = { lat: 37.7749, lng: -122.4194 } as const;
export const MIN_SPAN_METERS = 1_000;
export const MAX_SPAN_METERS = 500_000;

export interface SearchViewport {
  lat: number;
  lng: number;
}

export interface SearchPlaceCandidate {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
  priceText?: string;
  weeklyHours?: Partial<Record<Weekday, string>>;
  placeId?: string;
  featureId?: string;
  distanceMeters?: number;
  sourceIndex: number;
}

export interface SearchRequest {
  endpoint: string;
  proxyUrl: string;
}

export interface SearchFetchOptions {
  fetcher?: typeof fetch;
  language?: string;
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asInteger(value: unknown): number | undefined {
  const parsed = asNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : undefined;
}

function pathFor(calibration: Calibration, key: string): number[] | undefined {
  return calibration.paths[key];
}

const WEEKDAY_ALIASES: Record<string, Weekday> = {
  星期一: '星期一',
  星期二: '星期二',
  星期三: '星期三',
  星期四: '星期四',
  星期五: '星期五',
  星期六: '星期六',
  星期日: '星期日',
  星期天: '星期日',
  週一: '星期一',
  週二: '星期二',
  週三: '星期三',
  週四: '星期四',
  週五: '星期五',
  週六: '星期六',
  週日: '星期日',
  周一: '星期一',
  周二: '星期二',
  周三: '星期三',
  周四: '星期四',
  周五: '星期五',
  周六: '星期六',
  周日: '星期日',
  monday: '星期一',
  mon: '星期一',
  tuesday: '星期二',
  tue: '星期二',
  wednesday: '星期三',
  wed: '星期三',
  thursday: '星期四',
  thu: '星期四',
  friday: '星期五',
  fri: '星期五',
  saturday: '星期六',
  sat: '星期六',
  sunday: '星期日',
  sun: '星期日',
  月曜日: '星期一',
  火曜日: '星期二',
  水曜日: '星期三',
  木曜日: '星期四',
  金曜日: '星期五',
  土曜日: '星期六',
  日曜日: '星期日',
};

const CLOSED_HOUR_ALIASES = new Set(['公休', '休息', 'Closed', '休業', '定休日']);

export function normalizeWeekday(value: string): Weekday | undefined {
  const trimmed = value.trim();
  if (Object.prototype.hasOwnProperty.call(WEEKDAY_ALIASES, trimmed)) {
    return WEEKDAY_ALIASES[trimmed];
  }
  const lowered = trimmed.toLowerCase();
  return Object.prototype.hasOwnProperty.call(WEEKDAY_ALIASES, lowered)
    ? WEEKDAY_ALIASES[lowered]
    : undefined;
}

export function normalizeHourText(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (
    CLOSED_HOUR_ALIASES.has(trimmed) ||
    trimmed.toLowerCase() === 'closed'
  ) {
    return '公休';
  }
  return trimmed;
}

/** Port of SearchParser.readHours(): day[0] is the weekday and day[3][*][0] are ranges. */
export function readHours(days: unknown): Partial<Record<Weekday, string>> {
  if (!isArray(days)) {
    return {};
  }
  const weeklyHours: Partial<Record<Weekday, string>> = {};
  for (const day of days) {
    const weekdayValue = atPath(day, [0]);
    const weekday = typeof weekdayValue === 'string' ? normalizeWeekday(weekdayValue) : undefined;
    if (!weekday) {
      continue;
    }
    const ranges = atPath(day, [3]);
    if (!isArray(ranges)) {
      continue;
    }
    const values = ranges
      .map((range) => atPath(range, [0]))
      .filter((value): value is string => typeof value === 'string')
      .map(normalizeHourText)
      .filter((value): value is string => value !== undefined);
    if (values.length) {
      weeklyHours[weekday] = values.join(', ');
    }
  }
  return weeklyHours;
}

export function parseWeeklyHours(
  entry: unknown,
  calibration: Calibration,
): Partial<Record<Weekday, string>> {
  const hours203 = readHours(readEntryField(entry, calibration, 'hours203'));
  if (Object.keys(hours203).length) {
    return hours203;
  }
  return readHours(readEntryField(entry, calibration, 'hours118'));
}


/** Safe positional access ported from Vela GoogleResponse.at(). */
export function atPath(root: unknown, path?: number[]): unknown | undefined {
  if (!path) {
    return undefined;
  }
  let current: unknown = root;
  for (const index of path) {
    if (!Array.isArray(current) || !Number.isInteger(index) || index < 0) {
      return undefined;
    }
    current = current[index];
    if (current === null || current === undefined) {
      return undefined;
    }
  }
  return current;
}

function replaceAll(value: string, marker: string, replacement: string): string {
  return value.split(marker).join(replacement);
}

export function clampSpanMeters(value: number): number {
  return Math.min(MAX_SPAN_METERS, Math.max(MIN_SPAN_METERS, Math.round(value)));
}

/** Port of Vela SearchPb.build(): only query, viewport, and the calibrated span are variable. */
export function buildSearchPb(
  query: string,
  viewport: SearchViewport,
  template: string,
  spanMeters?: number,
): string {
  let pb = replaceAll(template, '{QUERY}', query.replace(/!/g, ' ').trim());
  pb = replaceAll(pb, '{LNG}', String(viewport.lng));
  pb = replaceAll(pb, '{LAT}', String(viewport.lat));
  if (spanMeters !== undefined && Number.isFinite(spanMeters)) {
    pb = pb.replace(/!1d[0-9.]+/, '!1d' + clampSpanMeters(spanMeters));
  }
  return pb;
}

function defaultLanguage(): string {
  return typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : 'en';
}

export function buildSearchRequest(
  parsedUrl: ParsedMapsUrl,
  calibration: Calibration,
  language = defaultLanguage(),
): SearchRequest {
  const query = parsedUrl.query || parsedUrl.pathName || '';
  if (!query) {
    throw new Error('Maps URL did not provide a search query.');
  }
  const viewport =
    parsedUrl.lat !== undefined && parsedUrl.lng !== undefined
      ? { lat: parsedUrl.lat, lng: parsedUrl.lng }
      : DEFAULT_VIEWPORT;
  const pb = buildSearchPb(
    query,
    viewport,
    calibration.searchPb,
    parsedUrl.spanMeters,
  );
  const endpointUrl = new URL(calibration.searchEndpoint);
  endpointUrl.searchParams.set('q', query);
  endpointUrl.searchParams.set('pb', pb);
  endpointUrl.searchParams.set('hl', language);
  const endpoint = endpointUrl.toString();
  return {
    endpoint,
    proxyUrl:
      'https://allorigins.hexlet.app/raw?url=' + encodeURIComponent(endpoint),
  };
}

const XSSI_GUARDS = [
  ")]}'\n",
  ")]}'\r\n",
  ")]}',\n",
  ")]}',\r\n",
  ")]}'",
  ")]}',",
  ')]}',
  'while(1);',
  'for(;;);',
] as const;

/** Port of Vela GoogleResponse.strip(), with whitespace tolerance for proxy fixtures. */
export function stripXssiGuard(body: string): string {
  const candidate = body.trimStart();
  for (const guard of XSSI_GUARDS) {
    if (candidate.startsWith(guard)) {
      return candidate.slice(guard.length).trimStart();
    }
  }
  return candidate;
}

function blockedBody(body: string): boolean {
  const start = body.trimStart();
  if (/^<(?:!doctype|html|head|body)/i.test(start)) {
    return true;
  }
  return /(?:captcha|consent|unusual traffic|verify you are human|before you continue)/i.test(
    start.slice(0, 4_096),
  );
}

export function parseGoogleSearchBody(
  body: string,
  calibration: Calibration,
): SearchPlaceCandidate[] {
  const stripped = stripXssiGuard(body);
  if (!stripped.startsWith('[')) {
    if (blockedBody(stripped)) {
      throw new Error('Google search returned an HTML, consent, or verification page.');
    }
    throw new Error('Google search response was not a JSON array.');
  }

  let root: unknown;
  try {
    root = JSON.parse(stripped) as unknown;
  } catch (error) {
    throw new Error('Google search response was invalid JSON: ' + String(error));
  }
  return parseSearchRoot(root, calibration);
}

function readEntryField(
  entry: unknown,
  calibration: Calibration,
  key: string,
): unknown {
  return atPath(entry, pathFor(calibration, key));
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

export function normalizePlaceName(value: string): string {
  return normalizeName(value);
}

/** Port of Vela's boundary-aware stripNamePrefix(). */
export function stripNamePrefix(address: string, name: string): string {
  if (!name || !address.toLowerCase().startsWith(name.toLowerCase())) {
    return address;
  }
  const rest = address.slice(name.length);
  if (rest && /[\p{L}\p{N}]/u.test(rest[0])) {
    return address;
  }
  const afterSpaces = rest.replace(/^[ \u00a0]+/, '');
  if (
    afterSpaces &&
    !/^[0-9,·–-]/u.test(afterSpaces)
  ) {
    return address;
  }
  const stripped = afterSpaces.replace(/^[,·–-][ \u00a0]*/, '').trim();
  return stripped || address;
}

function readAddress(entry: unknown, calibration: Calibration, name: string): string | undefined {
  const direct = asString(readEntryField(entry, calibration, 'address'));
  const componentsValue = readEntryField(entry, calibration, 'addressComponents');
  const components = isArray(componentsValue)
    ? componentsValue.map(asString).filter((part): part is string => Boolean(part))
    : [];
  let address = direct;
  if (!address && components.length) {
    const withoutName = components.filter(
      (part) => part.toLowerCase() !== name.toLowerCase(),
    );
    address = (withoutName.length ? withoutName : components).join(', ');
  }
  return address ? stripNamePrefix(address, name) : undefined;
}

function candidateFromEntry(
  entry: unknown,
  calibration: Calibration,
  sourceIndex: number,
): SearchPlaceCandidate | null {
  const name = asString(readEntryField(entry, calibration, 'name'));
  const lat = asNumber(readEntryField(entry, calibration, 'lat'));
  const lng = asNumber(readEntryField(entry, calibration, 'lng'));
  if (!name || lat === undefined || lng === undefined) {
    return null;
  }
  const rating = asNumber(readEntryField(entry, calibration, 'rating'));
  const reviewCount = asInteger(readEntryField(entry, calibration, 'reviewCount'));
  const weeklyHours = parseWeeklyHours(entry, calibration);
  return {
    name,
    lat,
    lng,
    address: readAddress(entry, calibration, name),
    category: asString(readEntryField(entry, calibration, 'category')),
    ...(rating !== undefined ? { rating } : {}),
    ...(reviewCount !== undefined ? { reviewCount } : {}),
    priceText: asString(readEntryField(entry, calibration, 'priceText')),
    ...(Object.keys(weeklyHours).length ? { weeklyHours } : {}),
    placeId: asString(readEntryField(entry, calibration, 'placeId')),
    featureId: asString(readEntryField(entry, calibration, 'featureId')),
    sourceIndex,
  };
}

function entriesFromResults(root: unknown, calibration: Calibration): unknown[] | null {
  const results = atPath(root, pathFor(calibration, 'results'));
  return isArray(results) && results.length ? results : null;
}

function entriesFromAtThisPlace(root: unknown, calibration: Calibration): unknown[] | null {
  const list = atPath(root, pathFor(calibration, 'atThisPlace'));
  if (!isArray(list)) {
    return null;
  }
  const entries = list
    .map((item) => [null, atPath(item, [0])])
    .filter((entry) => atPath(entry, pathFor(calibration, 'name')) !== undefined);
  return entries.length ? entries : null;
}

function entriesFromSingle(root: unknown, calibration: Calibration): unknown[] | null {
  const node = atPath(root, pathFor(calibration, 'single'));
  if (node === undefined) {
    return null;
  }
  const entry = [null, node];
  return atPath(entry, pathFor(calibration, 'name')) !== undefined ? [entry] : null;
}

function entriesFromFallback(root: unknown, calibration: Calibration): unknown[] | null {
  if (!isArray(root)) {
    return null;
  }
  const candidates = root
    .filter(isArray)
    .filter((list) =>
      list.some(
        (entry) => atPath(entry, pathFor(calibration, 'name')) !== undefined,
      ),
    )
    .sort((left, right) => right.length - left.length);
  return candidates[0] || null;
}

/** Port of Vela SearchParser.parse() discovery order, without unrelated parsers. */
export function parseSearchRoot(
  root: unknown,
  calibration: Calibration,
): SearchPlaceCandidate[] {
  if (!isArray(root)) {
    throw new Error('Google search root was not an array.');
  }
  const entries =
    entriesFromResults(root, calibration) ||
    entriesFromAtThisPlace(root, calibration) ||
    entriesFromSingle(root, calibration) ||
    entriesFromFallback(root, calibration);
  if (!entries) {
    return [];
  }
  return entries
    .map((entry, index) => candidateFromEntry(entry, calibration, index))
    .filter((candidate): candidate is SearchPlaceCandidate => candidate !== null);
}

export function haversineMeters(
  first: SearchViewport,
  second: SearchViewport,
): number {
  const radius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = toRadians(second.lat - first.lat);
  const lngDelta = toRadians(second.lng - first.lng);
  const firstLat = toRadians(first.lat);
  const secondLat = toRadians(second.lat);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(lngDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compareCandidates(
  left: SearchPlaceCandidate,
  right: SearchPlaceCandidate,
  parsedUrl: ParsedMapsUrl,
): number {
  const leftPlaceId = parsedUrl.placeId && left.placeId === parsedUrl.placeId ? 1 : 0;
  const rightPlaceId = parsedUrl.placeId && right.placeId === parsedUrl.placeId ? 1 : 0;
  if (leftPlaceId !== rightPlaceId) {
    return rightPlaceId - leftPlaceId;
  }

  const leftFeature = parsedUrl.featureId && left.featureId === parsedUrl.featureId ? 1 : 0;
  const rightFeature = parsedUrl.featureId && right.featureId === parsedUrl.featureId ? 1 : 0;
  if (leftFeature !== rightFeature) {
    return rightFeature - leftFeature;
  }

  if (parsedUrl.lat !== undefined && parsedUrl.lng !== undefined) {
    const target = { lat: parsedUrl.lat, lng: parsedUrl.lng };
    const leftDistance = haversineMeters(target, left);
    const rightDistance = haversineMeters(target, right);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
  }

  const wantedName = parsedUrl.pathName || parsedUrl.query;
  if (wantedName) {
    const normalizedWanted = normalizeName(wantedName);
    const leftName = normalizeName(left.name) === normalizedWanted ? 1 : 0;
    const rightName = normalizeName(right.name) === normalizedWanted ? 1 : 0;
    if (leftName !== rightName) {
      return rightName - leftName;
    }
  }
  return left.sourceIndex - right.sourceIndex;
}

/** Select the requested place without assuming Google response order is the target. */
export function selectPlace(
  candidates: SearchPlaceCandidate[],
  parsedUrl: ParsedMapsUrl,
): SearchPlaceCandidate | undefined {
  return [...candidates].sort((left, right) => compareCandidates(left, right, parsedUrl))[0];
}

export async function fetchSearchCandidates(
  parsedUrl: ParsedMapsUrl,
  calibration: Calibration,
  options: SearchFetchOptions = {},
): Promise<{ request: SearchRequest; candidates: SearchPlaceCandidate[] }> {
  const request = buildSearchRequest(parsedUrl, calibration, options.language);
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(request.proxyUrl, {
    method: 'GET',
    headers: { Accept: 'text/plain' },
  });
  if (!response.ok) {
    throw new Error('Google search proxy failed with HTTP ' + response.status + '.');
  }
  const body = await response.text();
  return {
    request,
    candidates: parseGoogleSearchBody(body, calibration),
  };
}
