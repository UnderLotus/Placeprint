import { describe, expect, it } from 'vitest';
import {
  calculateCropRect,
  clampCropState,
  DEFAULT_CARD_HEIGHT,
  DEFAULT_PHOTO_FRAME_HEIGHT,
  createCenteredCropState,
  mapPointerDeltaToCanvas,
  panCropByCanvasDelta,
} from './photo-crop';

describe('normalized photo crop model', () => {
  it('uses the centered cover crop at the minimum zoom for a landscape image', () => {
    const crop = calculateCropRect(1600, 900, 1536, 1229);

    expect(crop.scale).toBeCloseTo(1229 / 900, 8);
    expect(crop.sourceHeight).toBeCloseTo(900, 8);
    expect(crop.sourceWidth).toBeCloseTo((1536 * 900) / 1229, 8);
    expect(crop.sourceX).toBeCloseTo((1600 - crop.sourceWidth) / 2, 8);
    expect(crop.sourceY).toBe(0);
  });

  it('covers a portrait source without exposing empty frame space', () => {
    const crop = calculateCropRect(900, 1600, 1536, 1229);

    expect(crop.sourceWidth).toBeCloseTo(900, 8);
    expect(crop.sourceHeight).toBeCloseTo((1229 * 900) / 1536, 8);
    expect(crop.sourceX).toBeCloseTo(0, 8);
    expect(crop.sourceY).toBeCloseTo((1600 - crop.sourceHeight) / 2, 8);
    expect(crop.sourceX + crop.sourceWidth).toBeLessThanOrEqual(900);
    expect(crop.sourceY + crop.sourceHeight).toBeLessThanOrEqual(1600);
  });

  it('narrows the source rectangle when zoom increases while keeping the frame fixed', () => {
    const minimum = calculateCropRect(1600, 900, 1536, 1229);
    const zoomed = calculateCropRect(1600, 900, 1536, 1229, {
      zoom: 2,
      panX: 0,
      panY: 0,
    });

    expect(zoomed.destinationWidth).toBe(1536);
    expect(zoomed.destinationHeight).toBe(1229);
    expect(zoomed.sourceWidth).toBeCloseTo(minimum.sourceWidth / 2, 8);
    expect(calculateCropRect(1600, 900, 1536, 1229, {
      zoom: 99,
      panX: 0,
      panY: 0,
    }).scale).toBeCloseTo(minimum.scale * 3, 8);
    expect(zoomed.sourceHeight).toBeCloseTo(minimum.sourceHeight / 2, 8);
    expect(zoomed.sourceX).toBeCloseTo((1600 - zoomed.sourceWidth) / 2, 8);
  });

  it('clamps all four pan edges to source bounds', () => {
    const leftTop = calculateCropRect(1600, 900, 1536, 1229, {
      zoom: 3,
      panX: -99,
      panY: -99,
    });
    const rightBottom = calculateCropRect(1600, 900, 1536, 1229, {
      zoom: 3,
      panX: 99,
      panY: 99,
    });

    expect(leftTop.sourceX).toBe(0);
    expect(leftTop.sourceY).toBe(0);
    expect(rightBottom.sourceX + rightBottom.sourceWidth).toBeCloseTo(1600, 8);
    expect(rightBottom.sourceY + rightBottom.sourceHeight).toBeCloseTo(900, 8);
    expect(rightBottom.sourceX).toBeGreaterThan(0);
    expect(rightBottom.sourceY).toBeGreaterThan(0);
  });

  it('moves with a drag and clamps when a drag exceeds either boundary', () => {
    const centered = createCenteredCropState();
    const moved = panCropByCanvasDelta(
      centered,
      120,
      -80,
      1600,
      900,
      1536,
      1229,
    );
    const clamped = panCropByCanvasDelta(
      { zoom: 3, panX: 0, panY: 0 },
      100_000,
      -100_000,
      1600,
      900,
      1536,
      1229,
    );

    expect(moved.panX).toBeLessThan(0);
    expect(moved.panY).toBe(0);
    expect(clamped.panX).toBe(-1);
    expect(clamped.panY).toBe(1);
  });

  it('keeps normalized state stable across a responsive frame resize and resets explicitly', () => {
    const state = clampCropState(
      { zoom: 2.2, panX: 0.72, panY: -0.35 },
      2400,
      1600,
      1536,
      1229,
    );
    const resized = clampCropState(state, 2400, 1600, 768, 614.5);

    expect(resized).toEqual(state);
    expect(createCenteredCropState()).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it('maps CSS-scaled pointer deltas to the 1919px card while keeping the 1229px photo frame', () => {
    expect(DEFAULT_CARD_HEIGHT).toBe(1919);
    expect(DEFAULT_PHOTO_FRAME_HEIGHT).toBe(1229);
    expect(mapPointerDeltaToCanvas(96, 128, 384, 512)).toEqual({
      x: 384,
      y: 479.75,
    });
  });
});
