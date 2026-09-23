import { describe, expect, it } from 'vitest';
import {
  ORIENTATION_6_FIXTURE_BASE64,
  ORIENTATION_8_FIXTURE_BASE64,
  ORIENTATION_NORMAL_FIXTURE_BASE64,
} from './fixtures/orientation-fixtures';
import {
  orientedDimensions,
  readJpegOrientation,
} from './image-orientation';

function fixture(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

describe('JPEG orientation fixtures', () => {
  it('reads orientation 6 and swaps decoded dimensions once', () => {
    const orientation = readJpegOrientation(fixture(ORIENTATION_6_FIXTURE_BASE64));

    expect(orientation).toBe(6);
    expect(orientedDimensions(4, 2, orientation)).toEqual({ width: 2, height: 4 });
  });

  it('reads orientation 8 and swaps decoded dimensions once', () => {
    const orientation = readJpegOrientation(fixture(ORIENTATION_8_FIXTURE_BASE64));

    expect(orientation).toBe(8);
    expect(orientedDimensions(4, 2, orientation)).toEqual({ width: 2, height: 4 });
  });

  it('keeps an ordinary JPEG unrotated', () => {
    const orientation = readJpegOrientation(fixture(ORIENTATION_NORMAL_FIXTURE_BASE64));

    expect(orientation).toBe(1);
    expect(orientedDimensions(4, 2, orientation)).toEqual({ width: 4, height: 2 });
  });
});
