/*
 * URL extraction follows the complete-Maps subset described by the Share Card spec.
 * This module does not resolve short URLs; that belongs to Ticket 04.
 */

export class InvalidHttpUrlError extends Error {
  constructor() {
    super('The input is not a valid HTTP or HTTPS URL.');
    this.name = 'InvalidHttpUrlError';
  }
}

export class UnrecognizedMapsUrlError extends Error {
  constructor() {
    super('The URL is valid but is not a recognizable complete Maps URL.');
    this.name = 'UnrecognizedMapsUrlError';
  }
}

export interface ParsedMapsUrl {
  sourceUrl: string;
  url: string;
  pathName?: string;
  query?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  featureId?: string;
  spanMeters?: number;
}

function decodeSegment(value: string): string {
  const withSpaces = value.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(withSpaces).trim();
  } catch {
    return withSpaces.trim();
  }
}

function validCoordinatePair(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function coordinatePair(value: string | null | undefined): [number, number] | null {
  if (!value) {
    return null;
  }
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return validCoordinatePair(lat, lng) ? [lat, lng] : null;
}

function hrefText(url: URL): string {
  try {
    return decodeURIComponent(url.href);
  } catch {
    return url.href;
  }
}

function extractPathName(url: URL): string | undefined {
  const segments = url.pathname.split('/').filter(Boolean);
  const placeIndex = segments.findIndex((segment) => segment.toLowerCase() === 'place');
  if (placeIndex < 0 || placeIndex + 1 >= segments.length) {
    return undefined;
  }
  const value = decodeSegment(segments[placeIndex + 1]);
  return value && !value.startsWith('@') ? value : undefined;
}

function extractCoordinates(url: URL): [number, number] | null {
  const text = hrefText(url);
  const at = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?=[,!/?]|$)/);
  if (at) {
    const pair = coordinatePair(at[1] + ',' + at[2]);
    if (pair) {
      return pair;
    }
  }

  const data = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (data) {
    const pair = coordinatePair(data[1] + ',' + data[2]);
    if (pair) {
      return pair;
    }
  }

  return coordinatePair(url.searchParams.get('ll'));
}

function extractSpanMeters(url: URL, hasExactCoordinates: boolean): number | undefined {
  if (hasExactCoordinates) {
    return 1_000;
  }
  const match = hrefText(url).match(/!1d(\d+(?:\.\d+)?)/);
  if (!match) {
    return undefined;
  }
  return Math.min(500_000, Math.max(1_000, Number(match[1])));
}

/** Parse a valid HTTP(S) complete Maps URL without contacting a redirect service. */
export function parseMapsUrl(input: string): ParsedMapsUrl {
  const sourceUrl = input.trim();
  if (!sourceUrl) {
    throw new InvalidHttpUrlError();
  }

  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new InvalidHttpUrlError();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidHttpUrlError();
  }

  const pathName = extractPathName(url);
  const query = url.searchParams.get('q')?.trim() || url.searchParams.get('query')?.trim() || undefined;
  const coordinates = extractCoordinates(url);
  const placeId = url.searchParams.get('query_place_id')?.trim() || undefined;
  const featureMatch = hrefText(url).match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  const featureId = featureMatch?.[1];
  const recognizable = Boolean(
    pathName ||
      query ||
      coordinates ||
      placeId ||
      featureId,
  );
  if (!recognizable) {
    throw new UnrecognizedMapsUrlError();
  }

  return {
    sourceUrl,
    url: url.toString(),
    ...(pathName ? { pathName } : {}),
    ...(query ? { query } : {}),
    ...(coordinates ? { lat: coordinates[0], lng: coordinates[1] } : {}),
    ...(placeId ? { placeId } : {}),
    ...(featureId ? { featureId } : {}),
    ...(coordinates || /!1d\d/.test(hrefText(url))
      ? { spanMeters: extractSpanMeters(url, Boolean(coordinates)) }
      : {}),
  };
}
