import { describe, expect, it } from 'vitest';
import { setInputValueClamped, truncateToMaxLength } from './text-limit';

describe('input boundary truncation', () => {
  it.each([
    ['English boundary', 'abcdef', 4, 'abcd'],
    ['emoji pair boundary', 'ab😀cd', 4, 'ab😀'],
    ['emoji cannot fit', '😀abc', 1, ''],
  ])('%s', (_label, value, limit, expected) => {
    expect(truncateToMaxLength(value, limit)).toBe(expected);
    expect([...truncateToMaxLength(value, limit)].join('')).toBe(expected);
    expect(truncateToMaxLength(value, limit).length).toBeLessThanOrEqual(limit);
  });

  it('clamps a programmatic Google candidate assignment at the input boundary', () => {
    const input = { value: '', maxLength: 4 } as HTMLInputElement;
    setInputValueClamped(input, '東京😀カフェ');
    expect(input.value).toBe('東京😀');
    expect(input.value.length).toBe(4);
  });
});
