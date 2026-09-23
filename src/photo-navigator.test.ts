import { describe, expect, it } from 'vitest';
import {
  calculateNavigatorContain,
  mapCropRectToNavigator,
} from './photo-navigator';

describe('photo navigator mapping', () => {
  it('maps a crop through contain letterbox offsets', () => {
    const mapping = calculateNavigatorContain(1600, 900, 160, 120);

    expect(mapping).toEqual({
      imageX: 0,
      imageY: 15,
      imageWidth: 160,
      imageHeight: 90,
      scale: 0.1,
    });

    expect(mapCropRectToNavigator({
      sourceX: 200,
      sourceY: 100,
      sourceWidth: 800,
      sourceHeight: 450,
      destinationWidth: 1536,
      destinationHeight: 1229,
      scale: 1,
    }, mapping)).toEqual({
      x: 20,
      y: 25,
      width: 80,
      height: 45,
    });
  });

  it('uses horizontal letterbox offsets for a portrait source', () => {
    const mapping = calculateNavigatorContain(900, 1600, 160, 120);

    expect(mapping.imageX).toBeCloseTo(46.25, 8);
    expect(mapping.imageY).toBe(0);
    expect(mapping.imageWidth).toBeCloseTo(67.5, 8);
    expect(mapping.imageHeight).toBe(120);
  });
});
