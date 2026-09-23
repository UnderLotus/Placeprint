import { describe, expect, it } from 'vitest';
import { BUNDLED_CALIBRATION } from './calibration';
import {
  createHoursOptions,
  getDefaultHoursOption,
  getHoursText,
} from './business-hours';
import { placeInfoToFormValues } from './place-form';
import { resolvePlace } from './place-resolver';
import { renderShareCard } from './share-card';
import { createShareCardCanvas } from './test-support/share-card-canvas';
import { EMBED_HOURS_HTML } from './fixtures/embed-hours';

function day(name: string, text: string): unknown[] {
  return [name, null, null, [[text]]];
}

function fixture(): unknown[] {
  const place: unknown[] = [];
  place[11] = 'Hours Place';
  place[9] = [null, null, 35.1, 139.2];
  place[203] = [[
    day('Monday', '10:00~20:30'),
    day('Tuesday', '10:00~20:30'),
    day('Wednesday', '10:00~20:30'),
    day('Thursday', '10:00~20:30'),
    day('Friday', '10:00~20:30'),
    day('Saturday', '10:00~20:30'),
    day('Sunday', '10:00~20:30'),
  ]];
  const root: unknown[] = Array.from({ length: 65 }, () => null);
  root[64] = [[null, place]];
  return root;
}

describe('weekly hours public seam', () => {
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
        fetcher: async () => new Response(JSON.stringify(fixture()), { status: 200 }),
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
});
