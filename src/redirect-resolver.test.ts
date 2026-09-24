import { describe, expect, it } from 'vitest';
import { BUNDLED_CALIBRATION } from './calibration';
import { resolvePlaceFromInput } from './place-resolver';
import {
  DOMAINEE_REDIRECT_CHECKER_URL,
  resolveRedirectUrl,
} from './redirect-resolver';
import resultsFixture from './fixtures/search-results.json';

const COMPLETE_URL =
  'https://www.google.co.jp/maps/place/Whats+Good+Cafe/@35.68124,139.76712/data=!1s0x1111:0x2222?query_place_id=ChIJTARGET';
const SHORT_URL = 'https://maps.app.goo.gl/bsAkweZyjZdejBo78';
const COUNTRY_FINAL_URL =
  'https://www.google.co.jp/maps/place/Whats+Good+Cafe/@35.68124,139.76712/data=!1s0x1111:0x2222?query_place_id=ChIJTARGET';

function googleResponse(): Response {
  return new Response(")]}'\n" + JSON.stringify(resultsFixture), { status: 200 });
}

describe('Domainee redirect resolver', () => {
  it('calls the public GET endpoint with the original URL and returns data.finalUrl', async () => {
    const calls: string[] = [];
    const finalUrl = await resolveRedirectUrl('https://example.com/share/abc', {
      fetcher: async (input, init) => {
        calls.push(String(input));
        expect(init?.method).toBe('GET');
        return new Response(
          JSON.stringify({ ok: true, data: { finalUrl: COUNTRY_FINAL_URL } }),
          { status: 200 },
        );
      },
    });

    expect(finalUrl).toBe(COUNTRY_FINAL_URL);
    expect(calls).toHaveLength(1);
    const request = new URL(calls[0]);
    expect(request.origin + request.pathname).toBe(DOMAINEE_REDIRECT_CHECKER_URL);
    expect(request.searchParams.get('url')).toBe('https://example.com/share/abc');
  });

  it.each([
    ['HTTP failure', async () => new Response('down', { status: 503 })],
    ['invalid JSON', async () => new Response('{', { status: 200 })],
    [
      'ok false',
      async () =>
        new Response(JSON.stringify({ ok: false, data: { finalUrl: COUNTRY_FINAL_URL } }), {
          status: 200,
        }),
    ],
    [
      'missing finalUrl',
      async () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 }),
    ],
    [
      'invalid final URL',
      async () =>
        new Response(JSON.stringify({ ok: true, data: { finalUrl: 'ftp://example.com' } }), {
          status: 200,
        }),
    ],
    [
      'malformed final URL',
      async () =>
        new Response(JSON.stringify({ ok: true, data: { finalUrl: 'not a URL' } }), {
          status: 200,
        }),
    ],
  ])('rejects %s', async (_label, response) => {
    await expect(
      resolveRedirectUrl(SHORT_URL, { fetcher: response }),
    ).rejects.toThrow();
  });
});

describe('short URL place flow', () => {
  it('does not call Domainee for a recognizable complete Maps URL', async () => {
    let redirectCalls = 0;
    let lookupCalls = 0;
    const place = await resolvePlaceFromInput(COMPLETE_URL, {
      calibration: BUNDLED_CALIBRATION,
      redirectFetcher: async () => {
        redirectCalls += 1;
        throw new Error('Domainee should not be called');
      },
      fetcher: async () => {
        lookupCalls += 1;
        return googleResponse();
      },
      language: 'en-US',
    });

    expect(redirectCalls).toBe(0);
    expect(lookupCalls).toBe(2);
    expect(place.sourceUrl).toContain('google.co.jp');
  });

  it('expands maps.app.goo.gl and resolves a country-domain final URL', async () => {
    const redirectCalls: string[] = [];
    const lookupCalls: string[] = [];
    const place = await resolvePlaceFromInput(SHORT_URL, {
      calibration: BUNDLED_CALIBRATION,
      redirectFetcher: async (input) => {
        redirectCalls.push(String(input));
        return new Response(
          JSON.stringify({ ok: true, data: { finalUrl: COUNTRY_FINAL_URL } }),
          { status: 200 },
        );
      },
      fetcher: async (input) => {
        lookupCalls.push(String(input));
        return googleResponse();
      },
      language: 'en-US',
    });

    expect(redirectCalls).toHaveLength(1);
    expect(lookupCalls).toHaveLength(2);
    expect(place).toMatchObject({
      sourceUrl: SHORT_URL,
      resolvedUrl: COUNTRY_FINAL_URL,
      originalName: 'Whats Good Cafe',
      placeId: 'ChIJTARGET',
    });
  });

  it.each([
    'https://goo.gl/maps/abc',
  ])('expands a bare /maps path: %s', async (sourceUrl) => {
    let redirectCalls = 0;
    let lookupCalls = 0;
    const place = await resolvePlaceFromInput(sourceUrl, {
      calibration: BUNDLED_CALIBRATION,
      redirectFetcher: async () => {
        redirectCalls += 1;
        return new Response(
          JSON.stringify({ ok: true, data: { finalUrl: COUNTRY_FINAL_URL } }),
          { status: 200 },
        );
      },
      fetcher: async () => {
        lookupCalls += 1;
        return googleResponse();
      },
    });

    expect(redirectCalls).toBe(1);
    expect(lookupCalls).toBe(2);
    expect(place.sourceUrl).toBe(sourceUrl);
    expect(place.resolvedUrl).toBe(COUNTRY_FINAL_URL);
  });

  it('attempts expansion for any valid unrecognized HTTP URL', async () => {
    let redirectCalls = 0;
    let lookupCalls = 0;
    const place = await resolvePlaceFromInput('https://example.com/share/abc', {
      calibration: BUNDLED_CALIBRATION,
      redirectFetcher: async () => {
        redirectCalls += 1;
        return new Response(
          JSON.stringify({ ok: true, data: { finalUrl: COMPLETE_URL } }),
          { status: 200 },
        );
      },
      fetcher: async () => {
        lookupCalls += 1;
        return googleResponse();
      },
    });

    expect(place.originalName).toBe('Whats Good Cafe');
    expect(redirectCalls).toBe(1);
    expect(lookupCalls).toBe(2);
  });

  it('rejects an expanded URL that is valid HTTP but not a Maps URL', async () => {
    let lookupCalls = 0;
    await expect(
      resolvePlaceFromInput(SHORT_URL, {
        calibration: BUNDLED_CALIBRATION,
        redirectFetcher: async () =>
          new Response(
            JSON.stringify({ ok: true, data: { finalUrl: 'https://example.com/catalog' } }),
            { status: 200 },
          ),
        fetcher: async () => {
          lookupCalls += 1;
          return googleResponse();
        },
      }),
    ).rejects.toThrow('recognizable complete Maps URL');
    expect(lookupCalls).toBe(0);
  });

  it('passes a successful expansion into Google lookup and surfaces lookup failures', async () => {
    let lookupCalls = 0;
    await expect(
      resolvePlaceFromInput(SHORT_URL, {
        calibration: BUNDLED_CALIBRATION,
        redirectFetcher: async () =>
          new Response(JSON.stringify({ ok: true, data: { finalUrl: COMPLETE_URL } }), {
            status: 200,
          }),
        fetcher: async () => {
          lookupCalls += 1;
          return new Response('blocked', { status: 503 });
        },
      }),
    ).rejects.toThrow('HTTP 503');
    expect(lookupCalls).toBe(1);
  });

  it('does not expand a non-HTTP(S) input', async () => {
    let redirectCalls = 0;
    await expect(
      resolvePlaceFromInput('ftp://example.com/share/abc', {
        calibration: BUNDLED_CALIBRATION,
        redirectFetcher: async () => {
          redirectCalls += 1;
          return new Response('{}', { status: 200 });
        },
        fetcher: async () => googleResponse(),
      }),
    ).rejects.toThrow('valid HTTP or HTTPS URL');
    expect(redirectCalls).toBe(0);
  });
});
