/*
 * Calibration loading is a small TypeScript port of the Vela calibration contract.
 * Upstream source: PimpinPumpkin/Vela, commit 9e019bf740deebcb6da276ba09cbcf75542f1e34.
 * See NOTICE for the complete attribution and the exact source files used.
 */
import bundledCalibrationJson from './calibration-fallback.json';

export const CALIBRATION_REMOTE_URL =
  'https://raw.githubusercontent.com/PimpinPumpkin/Vela/main/calibration.json';
export const CALIBRATION_CACHE_KEY = 'share-card:vela-calibration';
export const CALIBRATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface Calibration {
  version: number;
  searchEndpoint: string;
  searchPb: string;
  paths: Record<string, number[]>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CalibrationLoaderOptions {
  fallback?: Calibration;
  storage?: StorageLike | null;
  fetcher?: typeof fetch;
  now?: () => number;
  remoteUrl?: string;
  cacheKey?: string;
  logger?: Pick<Console, 'warn'>;
}

const REQUIRED_PATHS = [
  'results',
  'atThisPlace',
  'single',
  'name',
  'lat',
  'lng',
  'address',
  'addressComponents',
  'category',
  'rating',
  'reviewCount',
  'priceText',
  'featureId',
  'placeId',
  'statusRich',
  'status118',
  'openStatus',
  'hours203',
  'hours118',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegerPath(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((part) => Number.isInteger(part) && part >= 0)
  );
}

/** Validate only the data this browser port consumes; remote transformsJs is intentionally ignored. */
export function validateCalibration(value: unknown): Calibration | null {
  if (!isRecord(value) || !Number.isInteger(value.version)) {
    return null;
  }

  if (typeof value.searchEndpoint !== 'string' || !value.searchEndpoint) {
    return null;
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value.searchEndpoint);
  } catch {
    return null;
  }
  if (
    endpoint.protocol !== 'https:' ||
    (endpoint.hostname !== 'www.google.com' && endpoint.hostname !== 'google.com')
  ) {
    return null;
  }

  if (
    typeof value.searchPb !== 'string' ||
    !value.searchPb.includes('{QUERY}') ||
    !value.searchPb.includes('{LAT}') ||
    !value.searchPb.includes('{LNG}')
  ) {
    return null;
  }

  if (!isRecord(value.paths)) {
    return null;
  }
  const paths: Record<string, number[]> = {};
  for (const [key, path] of Object.entries(value.paths)) {
    if (!isIntegerPath(path)) {
      return null;
    }
    paths[key] = [...path];
  }
  if (
    REQUIRED_PATHS.some(
      (key) => !isIntegerPath(paths[key]) || paths[key].length === 0,
    )
  ) {
    return null;
  }

  return {
    version: Number(value.version),
    searchEndpoint: value.searchEndpoint,
    searchPb: value.searchPb,
    paths,
  };
}

const bundledCalibration = validateCalibration(bundledCalibrationJson);
if (!bundledCalibration) {
  throw new Error('Bundled Vela calibration is invalid.');
}
export const BUNDLED_CALIBRATION: Calibration = bundledCalibration;

function readCachedCalibration(
  storage: StorageLike | null | undefined,
  key: string,
  now: () => number,
): Calibration | null {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Number.isFinite(parsed.fetchedAt)) {
      return null;
    }
    const age = now() - Number(parsed.fetchedAt);
    if (age < 0 || age >= CALIBRATION_TTL_MS) {
      return null;
    }
    return validateCalibration(parsed.calibration);
  } catch {
    return null;
  }
}

function writeCachedCalibration(
  storage: StorageLike | null | undefined,
  key: string,
  now: () => number,
  calibration: Calibration,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, JSON.stringify({ fetchedAt: now(), calibration }));
  } catch {
    // Storage quota/privacy failures must not block a place lookup.
  }
}

export class CalibrationLoader {
  private readonly fallback: Calibration;
  private readonly storage: StorageLike | null | undefined;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly remoteUrl: string;
  private readonly cacheKey: string;
  private readonly logger: Pick<Console, 'warn'>;
  private active: Calibration;
  private loadPromise: Promise<Calibration> | null = null;

  constructor(options: CalibrationLoaderOptions = {}) {
    this.fallback = options.fallback ?? BUNDLED_CALIBRATION;
    this.storage = options.storage;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.remoteUrl = options.remoteUrl ?? CALIBRATION_REMOTE_URL;
    this.cacheKey = options.cacheKey ?? CALIBRATION_CACHE_KEY;
    this.logger = options.logger ?? console;
    this.active = this.fallback;
  }

  getActive(): Calibration {
    return this.active;
  }

  load(): Promise<Calibration> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadOnce();
    }
    return this.loadPromise;
  }

  private async loadOnce(): Promise<Calibration> {
    const cached = readCachedCalibration(this.storage, this.cacheKey, this.now);
    if (cached) {
      this.active = cached;
      return cached;
    }

    try {
      const response = await this.fetcher(this.remoteUrl, { method: 'GET' });
      if (!response.ok) {
        throw new Error('Calibration request failed with HTTP ' + response.status + '.');
      }
      const remote = validateCalibration(await response.json());
      if (!remote) {
        throw new Error('Remote calibration failed validation.');
      }
      writeCachedCalibration(this.storage, this.cacheKey, this.now, remote);
      this.active = remote;
    } catch (error) {
      this.logger.warn('Using bundled Vela calibration after remote load failure.', error);
    }
    return this.active;
  }
}

export function createCalibrationLoader(
  options: CalibrationLoaderOptions = {},
): CalibrationLoader {
  return new CalibrationLoader(options);
}
