import { describe, expect, it } from 'vitest';
import { normalizeAndSegment, normalizeWhitespace } from './grapheme';
import {
  findPureGraphemeInsertion,
  mapFormattedRangeToLines,
  mapRawInsertionToFormatted,
} from './preview-animation';

describe('preview grapheme animation seams', () => {
  it('finds one contiguous Unicode grapheme insertion', () => {
    expect(findPureGraphemeInsertion('A', 'A😀B')).toEqual({
      start: 1,
      end: 3,
      inserted: ['😀', 'B'],
    });
    expect(findPureGraphemeInsertion('e\u0301', 'e\u0301🇯🇵')).toEqual({
      start: 1,
      end: 2,
      inserted: ['🇯🇵'],
    });
  });

  it('rejects deletion, replacement, and unchanged values', () => {
    expect(findPureGraphemeInsertion('AB', 'A')).toBeNull();
    expect(findPureGraphemeInsertion('AB', 'AC')).toBeNull();
    expect(findPureGraphemeInsertion('AB', 'AB')).toBeNull();
  });

  it('maps raw ordinal ranges through formatting, repeated graphemes, and wrapped lines', () => {
    const rating = findPureGraphemeInsertion('4.', '4.8')!;
    expect(mapRawInsertionToFormatted('4.8', rating, '4.8')).toEqual({ start: 2, end: 3 });

    const review = findPureGraphemeInsertion('100', '1000')!;
    expect(mapRawInsertionToFormatted('1000', review, '1,000')).toEqual({ start: 4, end: 5 });

    const repeatedTail = findPureGraphemeInsertion('店', '店店')!;
    const repeatedTailRange = mapRawInsertionToFormatted('店店', repeatedTail, '店店')!;
    expect(mapFormattedRangeToLines('店店', repeatedTailRange, ['店店'])).toEqual([
      { lineIndex: 0, start: 1, end: 2 },
    ]);

    const repeated = findPureGraphemeInsertion('店甲乙', '店甲店乙')!;
    const repeatedRange = mapRawInsertionToFormatted('店甲店乙', repeated, '店甲店乙')!;
    expect(mapFormattedRangeToLines('店甲店乙', repeatedRange, ['店甲店乙'])).toEqual([
      { lineIndex: 0, start: 2, end: 3 },
    ]);

    expect(mapFormattedRangeToLines('店 · 店', { start: 4, end: 5 }, ['店 · 店'])).toEqual([
      { lineIndex: 0, start: 4, end: 5 },
    ]);

    const name13 = findPureGraphemeInsertion('店'.repeat(12), `${'店'.repeat(12)}乙`)!;
    const name13Range = mapRawInsertionToFormatted(`${'店'.repeat(12)}乙`, name13, `${'店'.repeat(12)}乙`)!;
    expect(mapFormattedRangeToLines(`${'店'.repeat(12)}乙`, name13Range, [`${'店'.repeat(12)}乙`])).toEqual([
      { lineIndex: 0, start: 12, end: 13 },
    ]);

    const wrapped = findPureGraphemeInsertion('甲'.repeat(27), `${'甲'.repeat(27)}乙`)!;
    const wrappedRange = mapRawInsertionToFormatted(`${'甲'.repeat(27)}乙`, wrapped, `${'甲'.repeat(27)}乙`)!;
    expect(mapFormattedRangeToLines(`${'甲'.repeat(27)}乙`, wrappedRange, ['甲'.repeat(27), '乙'])).toEqual([
      { lineIndex: 1, start: 0, end: 1 },
    ]);
  });
});

describe('shared grapheme normalization', () => {
  it('trims and collapses whitespace without changing output graphemes', () => {
    expect(normalizeWhitespace('  港口\n\t 書店   café  ')).toBe('港口 書店 café');
    expect(normalizeAndSegment('  港口\n\t 書店   café  ')).toEqual({
      text: '港口 書店 café',
      graphemes: ['港', '口', ' ', '書', '店', ' ', 'c', 'a', 'f', 'é'],
    });
  });
});
