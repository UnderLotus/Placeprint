/*
 * Public resolver seams for complete Maps URLs and the short-link input flow.
 * Vela search mechanics live in vela-search.ts; Domainee expansion stays a single
 * small boundary before the existing complete-URL resolver.
 */
import type { Calibration } from './calibration';
import {
  parseMapsUrl,
  UnrecognizedMapsUrlError,
  type ParsedMapsUrl,
} from './maps-url';
import { resolveRedirectUrl } from './redirect-resolver';
import {
  countRecognizedWeekdays,
  fetchEmbedWeeklyHours,
} from './embed-hours';
import type { PlaceInfo } from './place-info';
import {
  fetchSearchCandidates,
  selectPlace,
  type SearchFetchOptions,
  type SearchPlaceCandidate,
} from './vela-search';

export interface ResolvePlaceOptions extends SearchFetchOptions {
  calibration: Calibration;
  redirectFetcher?: typeof fetch;
}

export function placeInfoFromCandidate(
  parsedUrl: ParsedMapsUrl,
  candidate: SearchPlaceCandidate,
): PlaceInfo {
  const originalName = parsedUrl.pathName || candidate.name;
  return {
    sourceUrl: parsedUrl.sourceUrl,
    resolvedUrl: parsedUrl.url,
    originalName,
    googleName: candidate.name,
    ...(candidate.rating !== undefined ? { rating: candidate.rating } : {}),
    ...(candidate.reviewCount !== undefined
      ? { reviewCount: candidate.reviewCount }
      : {}),
    ...(candidate.address ? { address: candidate.address } : {}),
    ...(candidate.category ? { category: candidate.category } : {}),
    ...(candidate.priceText ? { priceText: candidate.priceText } : {}),
    ...(candidate.weeklyHours ? { weeklyHours: candidate.weeklyHours } : {}),
    lat: candidate.lat,
    lng: candidate.lng,
    ...(candidate.placeId || parsedUrl.placeId
      ? { placeId: candidate.placeId || parsedUrl.placeId }
      : {}),
    ...(candidate.featureId || parsedUrl.featureId
      ? { featureId: candidate.featureId || parsedUrl.featureId }
      : {}),
  };
}

export async function resolvePlace(
  sourceUrl: string,
  options: ResolvePlaceOptions,
): Promise<PlaceInfo> {
  const parsedUrl = parseMapsUrl(sourceUrl);
  const { candidates } = await fetchSearchCandidates(
    parsedUrl,
    options.calibration,
    options,
  );
  const selected = selectPlace(candidates, parsedUrl);
  if (!selected) {
    throw new Error('Google search returned no matching place.');
  }
  const searchWeekdayCount = countRecognizedWeekdays(selected.weeklyHours);
  let enrichedCandidate = selected;
  if (searchWeekdayCount < 7) {
    const embedHours = await fetchEmbedWeeklyHours(selected, options);
    if (countRecognizedWeekdays(embedHours) > searchWeekdayCount) {
      enrichedCandidate = { ...selected, weeklyHours: embedHours };
    }
  }
  return placeInfoFromCandidate(parsedUrl, enrichedCandidate);
}

/**
 * Resolve the user's URL as one request: direct complete Maps URLs skip Domainee,
 * while other valid HTTP(S) URLs are expanded before the existing Maps resolver.
 */
export async function resolvePlaceFromInput(
  sourceUrl: string,
  options: ResolvePlaceOptions,
): Promise<PlaceInfo> {
  const normalizedSourceUrl = sourceUrl.trim();
  let completeUrl = normalizedSourceUrl;
  let expanded = false;
  try {
    parseMapsUrl(normalizedSourceUrl);
  } catch (error) {
    if (!(error instanceof UnrecognizedMapsUrlError)) {
      throw error;
    }
    completeUrl = await resolveRedirectUrl(normalizedSourceUrl, {
      fetcher: options.redirectFetcher ?? options.fetcher,
    });
    expanded = true;
  }

  const place = await resolvePlace(completeUrl, options);
  return expanded
    ? {
        ...place,
        sourceUrl: normalizedSourceUrl,
        resolvedUrl: place.resolvedUrl || completeUrl,
      }
    : place;
}
