import { describe, expect, it } from 'vitest';
import { BUNDLED_CALIBRATION } from './calibration';
import {
  createHoursOptions,
  getDefaultHoursOption,
  getHoursText,
} from './business-hours';
import { EMBED_HOURS_HTML } from './fixtures/embed-hours';
import {
  buildEmbedHoursRequest,
  countRecognizedWeekdays,
  extractInitEmbedJson,
  parseEmbedWeeklyHours,
} from './embed-hours';
import { placeInfoToFormValues } from './place-form';
import { resolvePlace } from './place-resolver';
import { renderShareCard } from './share-card';
import { createShareCardCanvas } from './test-support/share-card-canvas';

function day(name: string, text: string): unknown[] {
  return [name, null, null, [[text]]];
}

function embedHtml(blocks: unknown[]): string {
  return '<script>initEmbed(' + JSON.stringify(blocks) + ');</script>';
}

function deeplyNestedEmbedHtml(depth: number): string {
  const leaf = JSON.stringify([[day('Sunday', 'embed')]]);
  const nestedJson = '['.repeat(depth) + leaf + ']'.repeat(depth);
  return '<script>initEmbed(' + nestedJson + ');</script>';
}

function searchBody(days: unknown[]): string {
  const place: unknown[] = [];
  place[11] = 'Test Cafe';
  place[9] = [null, null, 35.1, 139.2];
  place[203] = [days];
  const root: unknown[] = Array.from({ length: 65 }, () => null);
  root[64] = [[null, place]];
  return JSON.stringify(root);
}

async function resolveWithEmbed(
  searchDays: unknown[],
  embed: string | Response | Error,
): Promise<{ calls: string[]; weeklyHours: ReturnType<typeof parseEmbedWeeklyHours> }> {
  const calls: string[] = [];
  const place = await resolvePlace(
    'https://www.google.com/maps/place/Test+Cafe/@35.1,139.2',
    {
      calibration: BUNDLED_CALIBRATION,
      language: 'en-US',
      fetcher: async (input) => {
        calls.push(String(input));
        if (calls.length === 1) {
          return new Response(searchBody(searchDays), { status: 200 });
        }
        if (embed instanceof Error) {
          throw embed;
        }
        return typeof embed === 'string'
          ? new Response(embed, { status: 200 })
          : embed;
      },
    },
  );
  return { calls, weeklyHours: place.weeklyHours };
}

describe('Maps embed weekly-hours enrichment', () => {
  it('enriches the 阿枝早點 one-day search result into ten complete-week options', async () => {
    const searchPlace = '阿枝早點';
    const searchDays = [day('星期日', '06:30–13:30')];
    const searchRoot: unknown[] = Array.from({ length: 65 }, () => null);
    const placeEntry: unknown[] = [];
    placeEntry[11] = searchPlace;
    placeEntry[9] = [null, null, 25.0751922, 121.6174295];
    placeEntry[203] = [searchDays];
    searchRoot[64] = [[null, placeEntry]];

    const calls: string[] = [];
    const place = await resolvePlace(
      'https://www.google.com/maps/place/%E9%98%BF%E6%9E%9D%E6%97%A9%E9%BB%9E/@25.0751922,121.6174295',
      {
        calibration: BUNDLED_CALIBRATION,
        language: 'zh-TW',
        fetcher: async (input) => {
          calls.push(String(input));
          return calls.length === 1
            ? new Response(JSON.stringify(searchRoot), { status: 200 })
            : new Response(EMBED_HOURS_HTML, { status: 200 });
        },
      },
    );

    expect(place.originalName).toBe(searchPlace);
    expect(place.weeklyHours).toEqual({
      星期一: '06:30–13:30',
      星期二: '06:30–13:30',
      星期三: '06:30–13:30',
      星期四: '06:30–13:30',
      星期五: '06:30–13:30',
      星期六: '06:30–13:30',
      星期日: '06:30–13:30',
    });

    const options = createHoursOptions(place.weeklyHours);
    expect(options).toHaveLength(10);
    expect(options.map((option) => option.value)).toEqual([
      'weekday',
      'weekend',
      'day:星期一',
      'day:星期二',
      'day:星期三',
      'day:星期四',
      'day:星期五',
      'day:星期六',
      'day:星期日',
      'custom',
    ]);
    expect(getDefaultHoursOption(options, new Date(2024, 0, 8))).toBe('weekday');
    expect(getHoursText(options, 'weekday', '')).toBe('平日 06:30–13:30');

    expect(calls).toHaveLength(2);
    const embedProxy = new URL(calls[1]);
    const embedUrl = new URL(embedProxy.searchParams.get('url') || '');
    expect(embedUrl.pathname).toBe('/maps');
    expect(embedUrl.searchParams.get('q')).toBe('阿枝早點 25.0751922,121.6174295');
    expect(embedUrl.searchParams.get('hl')).toBe('zh-TW');
    expect(embedUrl.searchParams.get('gl')).toBe('tw');
    expect(embedUrl.searchParams.get('output')).toBe('embed');
  });

  it('carries URL lookup through PlaceInfo, options, selected text, and renderer', async () => {
    const place = await resolvePlace(
      'https://www.google.com/maps/place/Hours+Place/@35.1,139.2',
      {
        calibration: BUNDLED_CALIBRATION,
        language: 'en-US',
        fetcher: async () => new Response(searchBody([
          day('Monday', '10:00~20:30'),
          day('Tuesday', '10:00~20:30'),
          day('Wednesday', '10:00~20:30'),
          day('Thursday', '10:00~20:30'),
          day('Friday', '10:00~20:30'),
          day('Saturday', '10:00~20:30'),
          day('Sunday', '10:00~20:30'),
        ]), { status: 200 }),
      },
    );

    expect(place.weeklyHours).toEqual({
      星期一: '10:00~20:30',
      星期二: '10:00~20:30',
      星期三: '10:00~20:30',
      星期四: '10:00~20:30',
      星期五: '10:00~20:30',
      星期六: '10:00~20:30',
      星期日: '10:00~20:30',
    });
    expect(Object.keys(place)).not.toContain('statusText');
    expect(placeInfoToFormValues(place).weeklyHours).toEqual(place.weeklyHours);

    const options = createHoursOptions(place.weeklyHours);
    const selected = getDefaultHoursOption(options, new Date(2024, 0, 8));
    const hoursText = getHoursText(options, selected, '');
    expect(selected).toBe('weekday');
    expect(hoursText).toBe('平日 10:00~20:30');

    const { canvas, recording } = createShareCardCanvas();
    renderShareCard(canvas, { placeInfo: place, hoursText });
    expect(recording.fillText.map((call) => call.text)).toContain(hoursText);
  });

  it('builds the selected-place query with language and locale region', () => {
    const request = buildEmbedHoursRequest(
      { name: '阿枝早點', lat: 25.0751922, lng: 121.6174295 },
      'zh-TW',
    );
    const endpoint = new URL(request.endpoint);
    expect(endpoint.pathname).toBe('/maps');
    expect(endpoint.searchParams.get('q')).toBe('阿枝早點 25.0751922,121.6174295');
    expect(endpoint.searchParams.get('hl')).toBe('zh-TW');
    expect(endpoint.searchParams.get('gl')).toBe('tw');
    expect(endpoint.searchParams.get('output')).toBe('embed');
    expect(request.proxyUrl).toContain('allorigins.hexlet.app/raw?url=');

    const noRegion = new URL(buildEmbedHoursRequest({ name: 'Cafe', lat: 1, lng: 2 }, 'en').endpoint);
    expect(noRegion.searchParams.has('gl')).toBe(false);
  });

  it('extracts the complete JSON argument and picks the deepest seven-day schedule', () => {
    const json = extractInitEmbedJson(EMBED_HOURS_HTML);
    expect(json).toBeDefined();
    expect(() => JSON.parse(json || '')).not.toThrow();
    expect(parseEmbedWeeklyHours(EMBED_HOURS_HTML)).toEqual({
      星期一: '06:30–13:30',
      星期二: '06:30–13:30',
      星期三: '06:30–13:30',
      星期四: '06:30–13:30',
      星期五: '06:30–13:30',
      星期六: '06:30–13:30',
      星期日: '06:30–13:30',
    });
  });

  it('does not count unknown weekdays or empty ranges', () => {
    const hours = parseEmbedWeeklyHours(embedHtml([
      [
        day('Monday', '10:00–12:00'),
        day('Mysteryday', '11:00–13:00'),
        day('Tuesday', '   '),
        day('星期八', '14:00–16:00'),
      ],
    ]));
    expect(hours).toEqual({ 星期一: '10:00–12:00' });
    expect(countRecognizedWeekdays(hours)).toBe(1);
  });

  it('treats missing marker and invalid JSON as unavailable without executing script text', () => {
    const key = '__shareCardEmbedParserExecuted';
    delete (globalThis as Record<string, unknown>)[key];
    const maliciousRange = '<script>globalThis.' + key + '=true</script>';
    const html = embedHtml([[day('Monday', maliciousRange)]]) +
      '<script>globalThis.' + key + '=true</script>';

    expect(parseEmbedWeeklyHours('<html>without marker</html>')).toBeUndefined();
    expect(parseEmbedWeeklyHours('<script>initEmbed([invalid]);</script>')).toBeUndefined();
    expect(parseEmbedWeeklyHours(html)).toEqual({ 星期一: maliciousRange });
    expect((globalThis as Record<string, unknown>)[key]).toBeUndefined();
  });

  it('does not request embed when search already recognizes all seven days', async () => {
    const days = [
      day('Monday', 'search'),
      day('Tuesday', 'search'),
      day('Wednesday', 'search'),
      day('Thursday', 'search'),
      day('Friday', 'search'),
      day('Saturday', 'search'),
      day('Sunday', 'search'),
    ];
    const calls: string[] = [];
    const place = await resolvePlace(
      'https://www.google.com/maps/place/Test+Cafe/@35.1,139.2',
      {
        calibration: BUNDLED_CALIBRATION,
        language: 'en-US',
        fetcher: async (input) => {
          calls.push(String(input));
          return new Response(searchBody(days), { status: 200 });
        },
      },
    );
    expect(calls).toHaveLength(1);
    expect(place.weeklyHours).toEqual({
      星期一: 'search',
      星期二: 'search',
      星期三: 'search',
      星期四: 'search',
      星期五: 'search',
      星期六: 'search',
      星期日: 'search',
    });
  });

  it.each([
    ['same day', [day('Sunday', 'search')], embedHtml([[day('Sunday', 'embed')]]), { 星期日: 'search' }],
    [
      'fewer days',
      [day('Monday', 'search'), day('Tuesday', 'search')],
      embedHtml([[day('Monday', 'embed')]]),
      { 星期一: 'search', 星期二: 'search' },
    ],
    ['missing marker', [day('Sunday', 'search')], '<html>no embed</html>', { 星期日: 'search' }],
  ])('keeps sparse search hours when enrichment is %s', async (_label, searchDays, embed, expected) => {
    const result = await resolveWithEmbed(searchDays, embed);
    expect(result.calls).toHaveLength(2);
    expect(result.weeklyHours).toEqual(expected);
  });

  it('keeps search hours when embed JSON has 20,000 nested arrays', async () => {
    const result = await resolveWithEmbed(
      [day('Sunday', 'search')],
      deeplyNestedEmbedHtml(20_000),
    );
    expect(result.calls).toHaveLength(2);
    expect(result.weeklyHours).toEqual({ 星期日: 'search' });
  });

  it('keeps search hours after an HTTP failure and only attempts one embed request', async () => {
    const result = await resolveWithEmbed(
      [day('Sunday', 'search')],
      new Response('unavailable', { status: 503 }),
    );
    expect(result.calls).toHaveLength(2);
    expect(result.weeklyHours).toEqual({ 星期日: 'search' });
  });

});
