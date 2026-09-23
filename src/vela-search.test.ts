import { describe, expect, it } from 'vitest';
import { BUNDLED_CALIBRATION } from './calibration';
import resultsFixture from './fixtures/search-results.json';
import singleFixture from './fixtures/single.json';
import atThisPlaceFixture from './fixtures/at-this-place.json';
import fallbackFixture from './fixtures/fallback.json';
import { parseMapsUrl } from './maps-url';
import { placeInfoToFormValues } from './place-form';
import { placeInfoFromCandidate, resolvePlace } from './place-resolver';
import {
  atPath,
  buildSearchPb,
  buildSearchRequest,
  fetchSearchCandidates,
  haversineMeters,
  normalizeHourText,
  normalizePlaceName,
  normalizeWeekday,
  parseGoogleSearchBody,
  parseSearchRoot,
  parseWeeklyHours,
  readHours,
  selectPlace,
  stripNamePrefix,
} from './vela-search';

describe('Vela search subset', () => {
  it('builds PB placeholders and clamps the calibrated span', () => {
    const pb = buildSearchPb(
      'Tea!Room',
      { lat: 35.1, lng: 139.2 },
      '!1s{QUERY}!2d{LNG}!3d{LAT}!1d999999',
      999999,
    );
    expect(pb).toBe('!1sTea Room!2d139.2!3d35.1!1d500000');
  });

  it('overwrites q, pb, and hl instead of appending duplicate parameters', () => {
    const parsed = parseMapsUrl('https://www.google.com/maps/place/Tea');
    const calibration = {
      ...BUNDLED_CALIBRATION,
      searchEndpoint: 'https://www.google.com/search?tbm=map&q=old&pb=old&hl=old',
    };
    const request = buildSearchRequest(parsed, calibration, 'ja-JP');
    const endpoint = new URL(request.endpoint);
    expect(endpoint.searchParams.getAll('q')).toEqual(['Tea']);
    expect(endpoint.searchParams.getAll('pb')).toHaveLength(1);
    expect(endpoint.searchParams.getAll('hl')).toEqual(['ja-JP']);
    expect(request.proxyUrl).toContain('allorigins.hexlet.app/raw?url=');
  });

  it('strips XSSI, reads safe paths, and rejects malformed HTML before JSON parsing', () => {
    expect(atPath([['ok']], [0, 0])).toBe('ok');
    expect(atPath([['ok']], [0, 2])).toBeUndefined();
    expect(atPath({ value: 'wrong' }, [0])).toBeUndefined();
    expect(atPath(null, [0])).toBeUndefined();

    const body = ")]}'\n" + JSON.stringify(resultsFixture);
    expect(parseGoogleSearchBody(body, BUNDLED_CALIBRATION)).toHaveLength(3);
    expect(parseGoogleSearchBody(")]}',\n" + JSON.stringify(resultsFixture), BUNDLED_CALIBRATION)).toHaveLength(3);
    const legalText = JSON.parse(JSON.stringify(resultsFixture)) as unknown[];
    legalText[0] = 'Consent Cafe';
    legalText[1] = 'captcha token';
    expect(parseGoogleSearchBody(JSON.stringify(legalText), BUNDLED_CALIBRATION)).toHaveLength(3);
    expect(() => parseGoogleSearchBody('<!doctype html><html>consent</html>', BUNDLED_CALIBRATION)).toThrow();
    expect(() => parseGoogleSearchBody('not json', BUNDLED_CALIBRATION)).toThrow();
  });

  it('discovers results, atThisPlace, single, and fallback entries', () => {
    const results = parseSearchRoot(resultsFixture, BUNDLED_CALIBRATION);
    expect(results[1]).toMatchObject({ name: 'Whats Good Cafe', placeId: 'ChIJTARGET' });

    const atThis = parseSearchRoot(atThisPlaceFixture, BUNDLED_CALIBRATION);
    expect(atThis[0]).toMatchObject({ name: 'Address Business', address: '10 Broadway' });

    const single = parseSearchRoot(singleFixture, BUNDLED_CALIBRATION);
    expect(single[0]).toMatchObject({ name: 'Single Place' });
    expect(single[0]).not.toHaveProperty('statusText');
    expect(single[0].address).toBe('100 Main St, Town');

    const fallback = parseSearchRoot(fallbackFixture, BUNDLED_CALIBRATION);
    expect(fallback[0]).toMatchObject({ name: 'Fallback Place' });
    expect(fallback[1]).toMatchObject({ name: 'Fallback Second' });
    expect(fallback[1].rating).toBeUndefined();
    expect(fallback[1].reviewCount).toBeUndefined();
    expect(fallback[1].address).toBeUndefined();
  });

  it('maps required fields and strips only a real name prefix', () => {
    const [target] = parseSearchRoot(resultsFixture, BUNDLED_CALIBRATION).filter(
      (candidate) => candidate.name === 'Whats Good Cafe',
    );
    expect(target).toMatchObject({
      rating: 4.8,
      reviewCount: 1250,
      address: '1-2-3 Chiyoda',
      category: 'Cafe',
      priceText: '$$',
      featureId: '0x1111:0x2222',
      placeId: 'ChIJTARGET',
    });
    expect(stripNamePrefix('Safeway, 1451 W Covell Blvd', 'Safeway')).toBe('1451 W Covell Blvd');
    expect(stripNamePrefix('Safeways Plaza, 1 Main St', 'Safeway')).toBe('Safeways Plaza, 1 Main St');
    expect(stripNamePrefix("Safeway's Fuel, 1 Main St", 'Safeway')).toBe("Safeway's Fuel, 1 Main St");
    expect(normalizePlaceName('  Café—Room! ')).toBe('caféroom');
  });

  it('selects by place ID, feature ID, distance, name, then response order', () => {
    const candidates = parseSearchRoot(resultsFixture, BUNDLED_CALIBRATION);
    const withPlaceId = parseMapsUrl(
      'https://www.google.com/maps/place/Whats+Good+Cafe/@35.68124,139.76712?query_place_id=ChIJTARGET',
    );
    expect(selectPlace(candidates, withPlaceId)?.placeId).toBe('ChIJTARGET');

    const withFeatureId = parseMapsUrl(
      'https://www.google.com/maps/place/Whats+Good+Cafe/data=!1s0x1111:0x2222',
    );
    expect(selectPlace(candidates, withFeatureId)?.featureId).toBe('0x1111:0x2222');

    const byDistance = parseMapsUrl(
      'https://www.google.com/maps/search/?q=Other+Cafe&ll=35.6805,139.768',
    );
    expect(selectPlace(candidates, byDistance)?.name).toBe('Other Cafe');

    const byName = parseMapsUrl(
      'https://www.google.com/maps/search/?q=Whats+Good+Cafe',
    );
    expect(selectPlace(candidates, byName)?.name).toBe('Whats Good Cafe');
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111195, -1);
  });

  it('probes the public resolver seam through a stubbed Hexlet response and editor mapping', async () => {
    const calls: string[] = [];
    const place = await resolvePlace(
      'https://www.google.com/maps/place/Whats+Good+Cafe/@35.68124,139.76712/data=!1s0x1111:0x2222?query_place_id=ChIJTARGET',
      {
        calibration: BUNDLED_CALIBRATION,
        language: 'en-US',
        fetcher: async (input) => {
          calls.push(String(input));
          return new Response(")]}'\n" + JSON.stringify(resultsFixture), { status: 200 });
        },
      },
    );

    expect(calls).toHaveLength(2);
    const proxy = new URL(calls[0]);
    const googleRequest = new URL(proxy.searchParams.get('url') || '');
    expect(googleRequest.searchParams.get('q')).toBe('Whats Good Cafe');
    expect(googleRequest.searchParams.get('hl')).toBe('en-US');
    expect(place).toMatchObject({
      originalName: 'Whats Good Cafe',
      googleName: 'Whats Good Cafe',
      rating: 4.8,
      reviewCount: 1250,
      address: '1-2-3 Chiyoda',
      category: 'Cafe',
      priceText: '$$',
      featureId: '0x1111:0x2222',
      placeId: 'ChIJTARGET',
    });
    expect(placeInfoToFormValues(place)).toEqual({
      storeName: 'Whats Good Cafe',
      rating: '4.8',
      reviewCount: '1250',
      address: '1-2-3 Chiyoda',
      category: 'Cafe',
      priceText: '$$',
    });
  });

  it('keeps a URL path name when the candidate is translated', () => {
    const parsed = parseMapsUrl(
      'https://www.google.com/maps/place/%E5%8E%9F%E6%96%87%E5%BA%97%E5%90%8D',
    );
    const place = placeInfoFromCandidate(parsed, {
      sourceIndex: 0,
      name: 'Translated Cafe',
      lat: 35.68124,
      lng: 139.76712,
    });

    expect(parsed.pathName).toBe('原文店名');
    expect(parsed.query).toBeUndefined();
    expect(place).toMatchObject({
      originalName: '原文店名',
      googleName: 'Translated Cafe',
    });
    expect(placeInfoToFormValues(place).storeName).toBe('原文店名');
  });

  it('uses the candidate name instead of an address-bearing q for the form store name', () => {
    const parsed = parseMapsUrl(
      'https://www.google.com/maps/search/?q=100臺北市中正區光復里重慶南路一段46巷7號城中老牌牛肉拉麵大王',
    );
    const place = placeInfoFromCandidate(parsed, {
      sourceIndex: 0,
      name: '城中老牌牛肉拉麵大王',
      lat: 25.044,
      lng: 121.515,
      address: '100臺北市中正區光復里重慶南路一段46巷7號',
    });

    expect(parsed.pathName).toBeUndefined();
    expect(parsed.query).toContain('100臺北市中正區');
    expect(place.originalName).toBe('城中老牌牛肉拉麵大王');
    expect(place.googleName).toBe('城中老牌牛肉拉麵大王');
    expect(placeInfoToFormValues(place).storeName).toBe('城中老牌牛肉拉麵大王');
  });

  it('does not fetch an unrecognized URL and rejects proxy failures', async () => {
    let calls = 0;
    await expect(
      resolvePlace('https://example.com/catalog/item', {
        calibration: BUNDLED_CALIBRATION,
        fetcher: async () => {
          calls += 1;
          return new Response('[]', { status: 200 });
        },
      }),
    ).rejects.toThrow('recognizable complete Maps URL');
    expect(calls).toBe(0);

    await expect(
      fetchSearchCandidates(
        parseMapsUrl('https://www.google.com/maps/place/Tea'),
        BUNDLED_CALIBRATION,
        { fetcher: async () => new Response('blocked', { status: 503 }) },
      ),
    ).rejects.toThrow('HTTP 503');
  });
});


describe('Vela weekly hours parser', () => {
  const day = (name: string, ranges: string[] = []) => [
    name,
    null,
    null,
    ranges.map((text) => [text]),
  ];

  const entryWithHours = (
    hours203?: unknown[],
    hours118?: unknown[],
  ): unknown[] => {
    const place: unknown[] = [];
    place[11] = 'Hours Place';
    place[9] = [null, null, 35.1, 139.2];
    if (hours203 !== undefined) {
      place[203] = [hours203];
    }
    if (hours118 !== undefined) {
      place[118] = [[null, null, null, [hours118]]];
    }
    return [null, place];
  };

  it('maps Chinese, English, and Japanese weekday aliases and rejects unknown days', () => {
    expect([
      '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日', '星期天',
      '週一', '週二', '週三', '週四', '週五', '週六', '週日',
      '周一', '周二', '周三', '周四', '周五', '周六', '周日',
    ].map(normalizeWeekday)).toEqual([
      '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日', '星期日',
      '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日',
      '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日',
    ]);
    expect(['Monday', 'Mon', 'tUe', 'WEDNESDAY', 'Thu', 'FRI', 'Saturday', 'sun']
      .map(normalizeWeekday)).toEqual([
        '星期一', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日',
      ]);
    expect(['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日']
      .map(normalizeWeekday)).toEqual([
        '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日',
      ]);
    expect(normalizeWeekday('星期八')).toBeUndefined();
    expect(normalizeWeekday('toString')).toBeUndefined();
  });

  it('normalizes closed aliases, preserves all-day text, and joins ranges', () => {
    expect(normalizeHourText('公休')).toBe('公休');
    expect(normalizeHourText('休息')).toBe('公休');
    expect(normalizeHourText('closed')).toBe('公休');
    expect(normalizeHourText('休業')).toBe('公休');
    expect(normalizeHourText('定休日')).toBe('公休');
    expect(normalizeHourText(' Open 24 hours ')).toBe('Open 24 hours');
    expect(readHours([
      day('Monday', [' 09:00~12:00 ', '13:00~18:00']),
      day('土曜日', ['Closed']),
      day('unknown day', ['10:00~12:00']),
      day('星期二', ['   ']),
    ])).toEqual({
      星期一: '09:00~12:00, 13:00~18:00',
      星期六: '公休',
    });
  });

  it('prefers hours203 and falls back to hours118 only when needed', () => {
    const hours203 = [day('星期一', ['203 hours'])];
    const hours118 = [day('星期一', ['118 hours']), day('Sunday', ['Open 24 hours'])];
    expect(parseWeeklyHours(entryWithHours(hours203, hours118), BUNDLED_CALIBRATION)).toEqual({
      星期一: '203 hours',
    });
    expect(parseWeeklyHours(entryWithHours(undefined, hours118), BUNDLED_CALIBRATION)).toEqual({
      星期一: '118 hours',
      星期日: 'Open 24 hours',
    });
    expect(parseWeeklyHours(entryWithHours([], hours118), BUNDLED_CALIBRATION)).toEqual({
      星期一: '118 hours',
      星期日: 'Open 24 hours',
    });
    expect(parseWeeklyHours(entryWithHours([], []), BUNDLED_CALIBRATION)).toEqual({});
  });
});
