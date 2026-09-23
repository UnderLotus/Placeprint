import { describe, expect, it } from 'vitest';
import { BUNDLED_CALIBRATION } from './calibration';
import { EMBED_HOURS_HTML } from './fixtures/embed-hours';
import {
  buildEmbedHoursRequest,
  countRecognizedWeekdays,
  extractInitEmbedJson,
  parseEmbedWeeklyHours,
} from './embed-hours';
import { resolvePlace } from './place-resolver';

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
    ['invalid JSON', [day('Sunday', 'search')], '<script>initEmbed([broken]);</script>', { 星期日: 'search' }],
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

  it('replaces one recognized search day with a richer seven-day embed schedule', async () => {
    const result = await resolveWithEmbed(
      [day('Sunday', 'search')],
      embedHtml([[
        day('Monday', 'embed'),
        day('Tuesday', 'embed'),
        day('Wednesday', 'embed'),
        day('Thursday', 'embed'),
        day('Friday', 'embed'),
        day('Saturday', 'embed'),
        day('Sunday', 'embed'),
      ]]),
    );
    expect(result.calls).toHaveLength(2);
    expect(result.weeklyHours).toEqual({
      星期一: 'embed',
      星期二: 'embed',
      星期三: 'embed',
      星期四: 'embed',
      星期五: 'embed',
      星期六: 'embed',
      星期日: 'embed',
    });
  });
});
