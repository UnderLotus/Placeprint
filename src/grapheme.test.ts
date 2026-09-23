import { describe, expect, it } from 'vitest';
import { normalizeAndSegment, normalizeWhitespace } from './grapheme';

describe('shared grapheme normalization', () => {
  it('trims and collapses whitespace without changing output graphemes', () => {
    expect(normalizeWhitespace('  港口\n\t 書店   café  ')).toBe('港口 書店 café');
    expect(normalizeAndSegment('  港口\n\t 書店   café  ')).toEqual({
      text: '港口 書店 café',
      graphemes: ['港', '口', ' ', '書', '店', ' ', 'c', 'a', 'f', 'é'],
    });
  });

});
