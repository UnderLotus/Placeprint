export const DEFAULT_PHOTO_FRAME_WIDTH = 1536;
export const DEFAULT_PHOTO_FRAME_HEIGHT = 1229;
export const DEFAULT_CARD_HEIGHT = 1919;
export const MIN_CROP_ZOOM = 1;
export const MAX_CROP_ZOOM = 3;

/**
 * A crop's pan is normalized to the available source extent. -1 is the
 * left/top edge, 0 is centered, and 1 is the right/bottom edge. Keeping pan
 * normalized makes the editor stable when the CSS-scaled preview is resized.
 */
export interface CropState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface CropRect {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  destinationWidth: number;
  destinationHeight: number;
  scale: number;
}

export interface CanvasDelta {
  x: number;
  y: number;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(label + ' must be a positive finite number.');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeZoom(value: number): number {
  return clamp(
    Number.isFinite(value) ? value : MIN_CROP_ZOOM,
    MIN_CROP_ZOOM,
    MAX_CROP_ZOOM,
  );
}

function normalizePan(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, -1, 1);
}

function assertCropDimensions(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): void {
  assertPositiveFinite(sourceWidth, 'Source width');
  assertPositiveFinite(sourceHeight, 'Source height');
  assertPositiveFinite(frameWidth, 'Frame width');
  assertPositiveFinite(frameHeight, 'Frame height');
}

export function createCenteredCropState(): CropState {
  return { zoom: MIN_CROP_ZOOM, panX: 0, panY: 0 };
}

/** Clamp zoom and normalized pan while preserving the source dimensions. */
export function clampCropState(
  state: CropState,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth = DEFAULT_PHOTO_FRAME_WIDTH,
  frameHeight = DEFAULT_PHOTO_FRAME_HEIGHT,
): CropState {
  assertCropDimensions(sourceWidth, sourceHeight, frameWidth, frameHeight);
  const zoom = normalizeZoom(state.zoom);
  const crop = calculateCropRect(
    sourceWidth,
    sourceHeight,
    frameWidth,
    frameHeight,
    { zoom, panX: normalizePan(state.panX), panY: normalizePan(state.panY) },
  );
  const availableX = Math.max(0, sourceWidth - crop.sourceWidth);
  const availableY = Math.max(0, sourceHeight - crop.sourceHeight);
  return {
    zoom,
    panX: availableX > Number.EPSILON ? normalizePan(state.panX) : 0,
    panY: availableY > Number.EPSILON ? normalizePan(state.panY) : 0,
  };
}

/**
 * Calculate the source rectangle for one crop state. The scale at zoom 1 is
 * the normal cover scale; zoom then narrows the source rectangle, never the
 * destination frame, so every returned crop remains fully covered.
 */
export function calculateCropRect(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  state: CropState = createCenteredCropState(),
): CropRect {
  assertCropDimensions(sourceWidth, sourceHeight, frameWidth, frameHeight);
  const zoom = normalizeZoom(state.zoom);
  const panX = normalizePan(state.panX);
  const panY = normalizePan(state.panY);
  const coverScale = Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const scale = coverScale * zoom;
  const cropWidth = Math.min(sourceWidth, frameWidth / scale);
  const cropHeight = Math.min(sourceHeight, frameHeight / scale);
  const availableX = Math.max(0, sourceWidth - cropWidth);
  const availableY = Math.max(0, sourceHeight - cropHeight);
  const sourceX = clamp(((panX + 1) / 2) * availableX, 0, availableX);
  const sourceY = clamp(((panY + 1) / 2) * availableY, 0, availableY);
  return {
    sourceX,
    sourceY,
    sourceWidth: cropWidth,
    sourceHeight: cropHeight,
    destinationWidth: frameWidth,
    destinationHeight: frameHeight,
    scale,
  };
}

/**
 * Apply a drag in destination/canvas pixels. Dragging the photo right moves
 * the source window left, hence the negative source-space delta.
 */
export function panCropByCanvasDelta(
  state: CropState,
  deltaX: number,
  deltaY: number,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth = DEFAULT_PHOTO_FRAME_WIDTH,
  frameHeight = DEFAULT_PHOTO_FRAME_HEIGHT,
): CropState {
  assertCropDimensions(sourceWidth, sourceHeight, frameWidth, frameHeight);
  const current = clampCropState(
    state,
    sourceWidth,
    sourceHeight,
    frameWidth,
    frameHeight,
  );
  const crop = calculateCropRect(
    sourceWidth,
    sourceHeight,
    frameWidth,
    frameHeight,
    current,
  );
  const availableX = Math.max(0, sourceWidth - crop.sourceWidth);
  const availableY = Math.max(0, sourceHeight - crop.sourceHeight);
  const safeDeltaX = Number.isFinite(deltaX) ? deltaX : 0;
  const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;
  return clampCropState(
    {
      zoom: current.zoom,
      panX:
        availableX > Number.EPSILON
          ? current.panX - (safeDeltaX / crop.scale) * (2 / availableX)
          : 0,
      panY:
        availableY > Number.EPSILON
          ? current.panY - (safeDeltaY / crop.scale) * (2 / availableY)
          : 0,
    },
    sourceWidth,
    sourceHeight,
    frameWidth,
    frameHeight,
  );
}

/** Convert CSS/client movement into the internal canvas coordinate system. */
export function mapPointerDeltaToCanvas(
  clientDeltaX: number,
  clientDeltaY: number,
  renderedWidth: number,
  renderedHeight: number,
  canvasWidth = DEFAULT_PHOTO_FRAME_WIDTH,
  canvasHeight = DEFAULT_CARD_HEIGHT,
): CanvasDelta {
  assertPositiveFinite(renderedWidth, 'Rendered width');
  assertPositiveFinite(renderedHeight, 'Rendered height');
  assertPositiveFinite(canvasWidth, 'Canvas width');
  assertPositiveFinite(canvasHeight, 'Canvas height');
  return {
    x: (Number.isFinite(clientDeltaX) ? clientDeltaX : 0) * canvasWidth / renderedWidth,
    y: (Number.isFinite(clientDeltaY) ? clientDeltaY : 0) * canvasHeight / renderedHeight,
  };
}
