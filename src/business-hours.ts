import type { Weekday } from './place-info';

export const WEEKDAYS: readonly Weekday[] = [
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
  '星期日',
];

export type HoursOptionValue =
  | 'weekday'
  | 'weekend'
  | 'custom'
  | `day:${Weekday}`;

export interface HoursOption {
  value: HoursOptionValue;
  label: string;
  hoursText: string;
}

const CUSTOM_HOURS_OPTION: HoursOption = {
  value: 'custom',
  label: '自填',
  hoursText: '',
};

function hasHours(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeHoursText(value: string): string {
  return value.trim();
}

function hoursFor(
  weeklyHours: Partial<Record<Weekday, string>> | undefined,
  weekday: Weekday,
): string | undefined {
  const value = weeklyHours?.[weekday];
  return hasHours(value) ? normalizeHoursText(value) : undefined;
}

function allEqual(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value === values[0]);
}

function dayOption(weekday: Weekday, hours: string): HoursOption {
  return {
    value: `day:${weekday}`,
    label: `${weekday}｜${weekday} ${hours}`,
    hoursText: `${weekday} ${hours}`,
  };
}

export function createHoursOptions(
  weeklyHours?: Partial<Record<Weekday, string>>,
): HoursOption[] {
  const options: HoursOption[] = [];
  const weekdays = WEEKDAYS.slice(0, 5)
    .map((weekday) => hoursFor(weeklyHours, weekday))
    .filter((value): value is string => value !== undefined);
  if (weekdays.length === 5 && allEqual(weekdays)) {
    const hours = weekdays[0];
    options.push({
      value: 'weekday',
      label: `平日營業時間｜平日 ${hours}`,
      hoursText: `平日 ${hours}`,
    });
  }

  const weekend = WEEKDAYS.slice(5)
    .map((weekday) => hoursFor(weeklyHours, weekday))
    .filter((value): value is string => value !== undefined);
  if (weekend.length === 2 && allEqual(weekend)) {
    const hours = weekend[0];
    options.push({
      value: 'weekend',
      label: `假日營業時間｜假日 ${hours}`,
      hoursText: `假日 ${hours}`,
    });
  }

  for (const weekday of WEEKDAYS) {
    const hours = hoursFor(weeklyHours, weekday);
    if (hours !== undefined) {
      options.push(dayOption(weekday, hours));
    }
  }

  options.push(CUSTOM_HOURS_OPTION);
  return options;
}

export function weekdayForDate(date: Date = new Date()): Weekday | undefined {
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const index = date.getDay();
  return index === 0 ? '星期日' : WEEKDAYS[index - 1];
}

export function getDefaultHoursOption(
  options: readonly HoursOption[],
  date: Date = new Date(),
): HoursOptionValue {
  if (options.some((option) => option.value === 'weekday')) {
    return 'weekday';
  }

  const today = weekdayForDate(date);
  if (today) {
    const todayValue: HoursOptionValue = `day:${today}`;
    if (options.some((option) => option.value === todayValue)) {
      return todayValue;
    }
  }

  return 'custom';
}

export function getHoursText(
  options: readonly HoursOption[],
  selected: HoursOptionValue,
  customText: string,
): string {
  if (selected === 'custom') {
    return customText;
  }
  return options.find((option) => option.value === selected)?.hoursText ?? '';
}
