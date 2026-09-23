const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

export function segmentGraphemes(value: string): string[] {
  return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

export function normalizeAndSegment(value: string): {
  text: string;
  graphemes: string[];
} {
  const text = normalizeWhitespace(value);
  return { text, graphemes: segmentGraphemes(text) };
}
