import { segmentGraphemes } from './grapheme';

export interface GraphemeInsertion {
  start: number;
  end: number;
  inserted: string[];
}

export interface GraphemeRange {
  start: number;
  end: number;
}

/** Return one contiguous grapheme insertion, or null for deletion/replacement/no-op. */
export function findPureGraphemeInsertion(
  previousValue: string,
  nextValue: string,
): GraphemeInsertion | null {
  const previous = segmentGraphemes(previousValue);
  const next = segmentGraphemes(nextValue);
  if (next.length <= previous.length) {
    return null;
  }

  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  if (prefix + suffix !== previous.length) {
    return null;
  }
  return {
    start: prefix,
    end: next.length - suffix,
    inserted: next.slice(prefix, next.length - suffix),
  };
}

/** Map raw current grapheme ordinals into the formatted current value. */
export function mapRawInsertionToFormatted(
  currentRawValue: string,
  insertion: GraphemeInsertion,
  formattedValue: string,
): GraphemeRange | null {
  const raw = segmentGraphemes(currentRawValue);
  const formatted = segmentGraphemes(formattedValue);
  if (insertion.end > raw.length || insertion.start < 0 || insertion.start >= insertion.end) {
    return null;
  }

  const mapped: number[] = [];
  let formattedCursor = 0;
  for (const grapheme of raw) {
    let match = -1;
    for (let index = formattedCursor; index < formatted.length; index += 1) {
      if (formatted[index] === grapheme) {
        match = index;
        break;
      }
    }
    if (match < 0) {
      return null;
    }
    mapped.push(match);
    formattedCursor = match + 1;
  }

  const selected = mapped.slice(insertion.start, insertion.end);
  if (selected.length === 0) {
    return null;
  }
  return {
    start: selected[0],
    end: selected[selected.length - 1] + 1,
  };
}

/** Map one formatted-value range to its visible positions across final wrapped lines. */
export function mapFormattedRangeToLines(
  formattedValue: string,
  range: GraphemeRange,
  renderedLines: string[],
): Array<{ lineIndex: number; start: number; end: number }> {
  const formatted = segmentGraphemes(formattedValue);
  const visible: Array<{ lineIndex: number; index: number }> = [];
  let formattedCursor = 0;

  renderedLines.forEach((line, lineIndex) => {
    const lineGraphemes = segmentGraphemes(line);
    lineGraphemes.forEach((grapheme, lineGraphemeIndex) => {
      let match = -1;
      for (let index = formattedCursor; index < formatted.length; index += 1) {
        if (formatted[index] === grapheme) {
          match = index;
          break;
        }
      }
      if (match < 0) {
        // Renderer-generated ellipsis is not a source grapheme and has no animation range.
        return;
      }
      if (match >= range.start && match < range.end) {
        visible.push({ lineIndex, index: lineGraphemeIndex });
      }
      formattedCursor = match + 1;
    });
  });

  const ranges: Array<{ lineIndex: number; start: number; end: number }> = [];
  for (const item of visible) {
    const previous = ranges[ranges.length - 1];
    if (previous && previous.lineIndex === item.lineIndex && previous.end === item.index) {
      previous.end += 1;
    } else {
      ranges.push({ lineIndex: item.lineIndex, start: item.index, end: item.index + 1 });
    }
  }
  return ranges;
}
