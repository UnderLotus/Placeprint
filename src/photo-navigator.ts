import type { CropRect } from './photo-crop';

export interface NavigatorContainMapping {
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  scale: number;
}

export interface NavigatorCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(label + ' must be a positive finite number.');
  }
}

/** Return the corrected source's contain box, including its letterbox offset. */
export function calculateNavigatorContain(
  sourceWidth: number,
  sourceHeight: number,
  navigatorWidth: number,
  navigatorHeight: number,
): NavigatorContainMapping {
  assertPositiveFinite(sourceWidth, 'Source width');
  assertPositiveFinite(sourceHeight, 'Source height');
  assertPositiveFinite(navigatorWidth, 'Navigator width');
  assertPositiveFinite(navigatorHeight, 'Navigator height');
  const scale = Math.min(
    navigatorWidth / sourceWidth,
    navigatorHeight / sourceHeight,
  );
  const imageWidth = sourceWidth * scale;
  const imageHeight = sourceHeight * scale;
  return {
    imageX: (navigatorWidth - imageWidth) / 2,
    imageY: (navigatorHeight - imageHeight) / 2,
    imageWidth,
    imageHeight,
    scale,
  };
}

/** Map a source crop rectangle into the contain box rather than the canvas origin. */
export function mapCropRectToNavigator(
  crop: CropRect,
  mapping: NavigatorContainMapping,
): NavigatorCropRect {
  return {
    x: mapping.imageX + crop.sourceX * mapping.scale,
    y: mapping.imageY + crop.sourceY * mapping.scale,
    width: crop.sourceWidth * mapping.scale,
    height: crop.sourceHeight * mapping.scale,
  };
}
