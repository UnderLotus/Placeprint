import { describe, expect, it } from 'vitest';
import {
  createHoursOptions,
  getDefaultHoursOption,
  getHoursText,
} from './business-hours';
import type { Weekday } from './place-info';

const WEEKDAYS: Weekday[] = [
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
  '星期日',
];

function allHours(value = '10:00~20:30'): Partial<Record<Weekday, string>> {
  return Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, value])) as Partial<Record<Weekday, string>>;
}

function dateForDay(day: number): Date {
  return new Date(2024, 0, 7 + day);
}

describe('weekly hours options', () => {
  it('offers equal weekday and weekend groups plus each weekday', () => {
    const options = createHoursOptions(allHours());

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
    expect(options[0]).toMatchObject({
      label: '平日營業時間｜平日 10:00~20:30',
      hoursText: '平日 10:00~20:30',
    });
    expect(options[1]).toMatchObject({
      label: '假日營業時間｜假日 10:00~20:30',
      hoursText: '假日 10:00~20:30',
    });
  });

  it('omits unequal groups while retaining available weekday options', () => {
    const hours = allHours();
    hours.星期五 = '11:00~21:00';
    hours.星期日 = '公休';
    const options = createHoursOptions(hours);

    expect(options.some((option) => option.value === 'weekday')).toBe(false);
    expect(options.some((option) => option.value === 'weekend')).toBe(false);
    expect(options.map((option) => option.value)).toEqual([
      'day:星期一',
      'day:星期二',
      'day:星期三',
      'day:星期四',
      'day:星期五',
      'day:星期六',
      'day:星期日',
      'custom',
    ]);
  });

  it('trims final strings for exact grouping and keeps custom as the only empty-data option', () => {
    const equal = allHours(' 10:00~20:30 ');
    expect(createHoursOptions(equal)[0].value).toBe('weekday');
    equal.星期三 = '10:00 ~20:30';
    expect(createHoursOptions(equal).some((option) => option.value === 'weekday')).toBe(false);
    expect(createHoursOptions(undefined)).toEqual([
      { value: 'custom', label: '自填', hoursText: '' },
    ]);
  });

  it('defaults to weekday group, then today, then custom', () => {
    const grouped = createHoursOptions(allHours());
    expect(getDefaultHoursOption(grouped, dateForDay(2))).toBe('weekday');

    const weekdays = createHoursOptions({ 星期三: '10:00~20:30', 星期五: '11:00~21:00' });
    expect(getDefaultHoursOption(weekdays, dateForDay(3))).toBe('day:星期三');
    expect(getDefaultHoursOption(weekdays, dateForDay(1))).toBe('custom');
  });

  it('keeps custom text when switching away and back to 自填', () => {
    const options = createHoursOptions({ 星期一: '10:00~20:30' });
    const custom = '我想顯示的時間';
    expect(getHoursText(options, 'custom', custom)).toBe(custom);
    expect(getHoursText(options, 'day:星期一', custom)).toBe('星期一 10:00~20:30');
    expect(getHoursText(options, 'custom', custom)).toBe(custom);
    expect(getHoursText(options, 'custom', '')).toBe('');
  });
});
