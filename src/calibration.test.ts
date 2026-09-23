import { describe, expect, it } from 'vitest';
import {
  BUNDLED_CALIBRATION,
  CALIBRATION_TTL_MS,
  createCalibrationLoader,
  validateCalibration,
} from './calibration';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function cloneCalibration(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(BUNDLED_CALIBRATION)) as Record<string, unknown>;
}

describe('Vela calibration validation and cache', () => {
  it('accepts the pinned fallback and ignores remote transformsJs', () => {
    expect(BUNDLED_CALIBRATION.version).toBe(20);
    const remote = { ...cloneCalibration(), version: 21, transformsJs: 'throw new Error("must not run")' };
    const validated = validateCalibration(remote);
    expect(validated?.version).toBe(21);
    expect(validated).not.toHaveProperty('transformsJs');
  });

  it('rejects invalid endpoint hosts, placeholders, and path values', () => {
    const wrongHost = cloneCalibration();
    wrongHost.searchEndpoint = 'https://attacker.example/search';
    expect(validateCalibration(wrongHost)).toBeNull();

    const missingPlaceholder = cloneCalibration();
    missingPlaceholder.searchPb = missingPlaceholder.searchPb
      ? String(missingPlaceholder.searchPb).replace('{QUERY}', '')
      : '';
    expect(validateCalibration(missingPlaceholder)).toBeNull();

    const badPath = cloneCalibration();
    badPath.paths = { ...(badPath.paths as Record<string, unknown>), rating: [1, 'not-an-int'] };
    expect(validateCalibration(badPath)).toBeNull();
  });

  it('uses the same cache key through the TTL boundary', async () => {
    const storage = new MemoryStorage();
    let now = 10_000;
    const cached = cloneCalibration();
    cached.version = 99;
    storage.setItem(
      'cache',
      JSON.stringify({ fetchedAt: now - CALIBRATION_TTL_MS + 1, calibration: cached }),
    );
    let calls = 0;
    const loader = createCalibrationLoader({
      storage,
      cacheKey: 'cache',
      now: () => now,
      fetcher: async () => {
        calls += 1;
        return new Response(JSON.stringify({ ...cloneCalibration(), version: 100 }), { status: 200 });
      },
      logger: { warn: () => undefined },
    });

    expect(loader.getActive().version).toBe(BUNDLED_CALIBRATION.version);
    await expect(loader.load()).resolves.toMatchObject({ version: 99 });
    expect(calls).toBe(0);

    now += 1;
    const boundaryLoader = createCalibrationLoader({
      storage,
      cacheKey: 'cache',
      now: () => now,
      fetcher: async () => {
        calls += 1;
        return new Response(JSON.stringify({ ...cloneCalibration(), version: 100 }), { status: 200 });
      },
      logger: { warn: () => undefined },
    });
    await expect(boundaryLoader.load()).resolves.toMatchObject({ version: 100 });
    expect(calls).toBe(1);
  });

  it('fetches and caches a valid remote calibration, but falls back on invalid remote data', async () => {
    const storage = new MemoryStorage();
    let now = 20_000;
    const remote = cloneCalibration();
    remote.version = 21;
    const loader = createCalibrationLoader({
      storage,
      cacheKey: 'cache',
      now: () => now,
      fetcher: async () => new Response(JSON.stringify(remote), { status: 200 }),
      logger: { warn: () => undefined },
    });

    await expect(loader.load()).resolves.toMatchObject({ version: 21 });
    expect(storage.getItem('cache')).toContain('"version":21');

    now += CALIBRATION_TTL_MS;
    const invalidLoader = createCalibrationLoader({
      storage,
      cacheKey: 'expired',
      now: () => now,
      fetcher: async () => new Response(JSON.stringify({ version: 22 }), { status: 200 }),
      logger: { warn: () => undefined },
    });
    await expect(invalidLoader.load()).resolves.toMatchObject({ version: 20 });
  });
});
