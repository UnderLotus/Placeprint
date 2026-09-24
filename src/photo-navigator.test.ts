import { describe, expect, it } from 'vitest';
import {
  calculateNavigatorContain,
  drawPhotoNavigator,
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

  it('draws the navigator using its independent preview palette without changing geometry', () => {
    const mapping = calculateNavigatorContain(1600, 900, 160, 120);
    const crop = mapCropRectToNavigator({
      sourceX: 200, sourceY: 100, sourceWidth: 800, sourceHeight: 450,
      destinationWidth: 1536, destinationHeight: 1229, scale: 1,
    }, mapping);
    const palette = {
      navigatorSurface: 'rgb(1, 2, 3)',
      navigatorTint: 'rgba(4, 5, 6, 0.2)',
      navigatorStroke: '#070809',
    };
    let fillStyle = '';
    let strokeStyle = '';
    let lineWidth = 0;
    const fills: Array<{ color: string; rect: number[] }> = [];
    let imageArguments: unknown[] = [];
    let stroke: { color: string; width: number; rect: number[] } | null = null;
    const context = {
      clearRect: () => undefined,
      fillRect: (x: number, y: number, width: number, height: number) => {
        fills.push({ color: fillStyle, rect: [x, y, width, height] });
      },
      drawImage: (...args: unknown[]) => { imageArguments = args; },
      strokeRect: (x: number, y: number, width: number, height: number) => {
        stroke = { color: strokeStyle, width: lineWidth, rect: [x, y, width, height] };
      },
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperties(context, {
      fillStyle: { get: () => fillStyle, set: (value: string) => { fillStyle = value; } },
      strokeStyle: { get: () => strokeStyle, set: (value: string) => { strokeStyle = value; } },
      lineWidth: { get: () => lineWidth, set: (value: number) => { lineWidth = value; } },
    });
    const source = {} as CanvasImageSource;

    drawPhotoNavigator(context, source, 1600, 900, 160, 120, mapping, crop, palette);

    expect(fills).toEqual([
      { color: palette.navigatorSurface, rect: [0, 0, 160, 120] },
      { color: palette.navigatorTint, rect: [mapping.imageX, mapping.imageY, mapping.imageWidth, mapping.imageHeight] },
    ]);
    expect(imageArguments).toEqual([
      source, 0, 0, 1600, 900, mapping.imageX, mapping.imageY, mapping.imageWidth, mapping.imageHeight,
    ]);
    expect(stroke).toEqual({ color: palette.navigatorStroke, width: 2, rect: [crop.x, crop.y, crop.width, crop.height] });
  });
});
