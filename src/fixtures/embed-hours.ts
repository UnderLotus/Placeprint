import type { Weekday } from '../place-info';

const WEEKDAYS: Weekday[] = [
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
  '星期日',
];

function day(weekday: Weekday): unknown[] {
  return [weekday, 1, null, [['06:30–13:30', [[6, 30], [13, 30]]]]];
}

// Minimized from the captured Maps output: the first block is a one-day
// current-day entry, while the later schedule contains the complete week.
const currentDay = [day('星期日')];
const fullSchedule = WEEKDAYS.map(day);

export const EMBED_HOURS_HTML = [
  '<!doctype html>',
  '<script>',
  'initEmbed(' + JSON.stringify([currentDay, fullSchedule]) + ');',
  '</script>',
].join('\n');
