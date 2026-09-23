import type { PlaceInfo } from './place-info';
import {
  calculateCropRect,
  createCenteredCropState,
  type CropRect,
  type CropState,
} from './photo-crop';
import type { JpegOrientation } from './image-orientation';
import {
  createQrCodeBox,
  createQrCodeResult,
  drawQrCode,
  type QrCodeBox,
  type QrCodeMatrix,
  type QrCodeResult,
} from './qr-code';
import { normalizeAndSegment, normalizeWhitespace, segmentGraphemes } from './grapheme';

export const CARD_WIDTH = 1536;
export const CARD_HEIGHT = 1919;
export const PHOTO_HEIGHT = 1229;
export const INFO_HEIGHT = 690;

const CARD_INSET = 128;
const INFO_START_Y = 1341;
const NAME_WIDTH = 1280;
const BODY_WIDTH = 1032;
const FIELD_GAP = 24;
const SOCIAL_LINE_HEIGHT = 48;
export const SOCIAL_INK_BOTTOM = 1862;
const NAME_LINE_HEIGHT = 120;
const NAME_FONT_FAMILY = '"Avenir Next", "Noto Sans TC", "Helvetica Neue", Arial, sans-serif';
const BODY_FONT_FAMILY = '"Noto Sans TC", "Avenir Next", "Helvetica Neue", Arial, sans-serif';
const ELLIPSIS = '…';
const BODY_BASELINE_REFERENCE = 'Ág';

const FONT_SIZES = {
  name: 100,
  rating: 50,
  category: 42,
  hours: 40,
  address: 38,
  social: 42,
} as const;

const LINE_HEIGHTS = {
  rating: 62,
  category: 54,
  hours: 52,
  address: 52,
} as const;
const FULL_ADDRESS_TOP = INFO_START_Y +
  NAME_LINE_HEIGHT + FIELD_GAP +
  LINE_HEIGHTS.rating + FIELD_GAP +
  LINE_HEIGHTS.category + FIELD_GAP +
  LINE_HEIGHTS.hours + FIELD_GAP;

export interface ShareCardImage {
  naturalWidth: number;
  naturalHeight: number;
  width: number;
  height: number;
  /** The decoded, orientation-applied source used by drawImage when present. */
  source?: CanvasImageSource;
  /** Metadata retained for fixture/probe checks; never applied a second time. */
  orientation?: JpegOrientation;
  release?: () => void;
}

interface ShareCardPlaceData {
  storeName: string;
  rating?: number | null;
  reviewCount?: number | null;
  address?: string | null;
  category?: string | null;
  priceText?: string | null;
  hoursText?: string | null;
  socialId?: string | null;
  qrCode?: string | null;
}

export interface ShareCardContent {
  image?: ShareCardImage | null;
  crop?: CropState | null;
  placeInfo?: PlaceInfo | null;
  // Keep the flat fields as a small compatibility seam for the ticket-01 API.
  storeName?: string;
  rating?: number | null;
  reviewCount?: number | null;
  address?: string | null;
  category?: string | null;
  priceText?: string | null;
  hoursText?: string | null;
  socialId?: string | null;
  qrCode?: string | null;
}

export interface CoverCrop extends CropRect {}

export type RenderLineKind = 'name' | 'rating' | 'category' | 'hours' | 'address' | 'social';

export interface RenderTextInkMetrics {
  ascent: number;
  descent: number;
  baseline: number;
  inkTop: number;
  inkBottom: number;
}

export interface RenderLineBox {
  kind: RenderLineKind;
  text: string;
  lines: string[];
  x: number;
  top: number;
  width: number;
  height: number;
  font: string;
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  color: string;
  /** Metrics measured while the layout is built; drawLineBox never re-measures ink. */
  inkMetrics: RenderTextInkMetrics[];
  baseline: number;
  inkTop: number;
  inkBottom: number;
}

export interface InfoLayout {
  lineBoxes: RenderLineBox[];
  mainTop: number;
  mainBottom: number;
  socialTop: number;
  socialInkBottom: number;
  fieldGap: number;
}

export interface RenderTextAnimationRange {
  lineIndex: number;
  start: number;
  end: number;
}

export interface RenderTextAnimation {
  kind: RenderLineKind;
  ranges: RenderTextAnimationRange[];
  progress: number;
}

export interface ShareCardRenderOptions {
  textAnimation?: RenderTextAnimation;
  qrAnimationProgress?: number;
}

export interface RenderPlan {
  width: number;
  height: number;
  photo: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  info: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  name: {
    text: string;
    x: number;
    top: number;
    maxWidth: number;
    fontSize: number;
    lineHeight: number;
  };
  infoLayout?: InfoLayout;
  photoCrop?: CoverCrop;
  qrCodeMatrix?: QrCodeMatrix;
  qrCodeBox?: QrCodeBox;
  qrCodeError?: string;
}

function normalizeOptionalText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function chooseField<T>(
  direct: T | null | undefined,
  nested: T | null | undefined,
): T | null | undefined {
  return direct === undefined ? nested : direct;
}

function resolveShareCardPlaceData(content: ShareCardContent): ShareCardPlaceData {
  const place = content.placeInfo;
  return {
    storeName: content.storeName ?? place?.originalName ?? place?.googleName ?? '',
    rating: chooseField(content.rating, place?.rating),
    reviewCount: chooseField(content.reviewCount, place?.reviewCount),
    address: chooseField(content.address, place?.address),
    category: chooseField(content.category, place?.category),
    priceText: chooseField(content.priceText, place?.priceText),
    hoursText: content.hoursText,
    socialId: content.socialId,
    qrCode: chooseField(content.qrCode, place?.qrCode),
  };
}

function formatRating(value: number | null | undefined): string {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 5
  ) {
    return '';
  }
  const rounded = Math.round(value * 10) / 10;
  return `★ ${rounded.toFixed(1)}`;
}

function formatReviewCount(value: number | null | undefined): string {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return '';
  }
  return `(${new Intl.NumberFormat('en-US').format(Math.round(value))})`;
}

function formatRatingDetails(
  rating: number | null | undefined,
  reviewCount: number | null | undefined,
): string {
  return [formatRating(rating), formatReviewCount(reviewCount)]
    .filter(Boolean)
    .join(' · ');
}

function formatCategoryPrice(
  category: string | null | undefined,
  priceText: string | null | undefined,
): string {
  return [normalizeOptionalText(category), normalizeOptionalText(priceText)]
    .filter(Boolean)
    .join(' · ');
}

function applyQrCodeResultToPlan(plan: RenderPlan, result: QrCodeResult): void {
  plan.qrCodeMatrix = result.matrix;
  plan.qrCodeBox = result.matrix ? createQrCodeBox(result.matrix) : undefined;
  plan.qrCodeError = result.error;
}

function createRenderPlan(
  storeName: string,
  qrCodeResult: QrCodeResult,
): RenderPlan {
  const plan: RenderPlan = {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    photo: {
      x: 0,
      y: 0,
      width: CARD_WIDTH,
      height: PHOTO_HEIGHT,
    },
    info: {
      x: 0,
      y: PHOTO_HEIGHT,
      width: CARD_WIDTH,
      height: INFO_HEIGHT,
    },
    name: {
      text: normalizeWhitespace(storeName),
      x: CARD_INSET,
      top: INFO_START_Y,
      maxWidth: NAME_WIDTH,
      fontSize: FONT_SIZES.name,
      lineHeight: NAME_LINE_HEIGHT,
    },
  };
  applyQrCodeResultToPlan(plan, qrCodeResult);
  return plan;
}

export function calculatePhotoCrop(
  image: ShareCardImage,
  crop: CropState = createCenteredCropState(),
  destinationWidth = CARD_WIDTH,
  destinationHeight = PHOTO_HEIGHT,
): CoverCrop {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  return calculateCropRect(
    sourceWidth,
    sourceHeight,
    destinationWidth,
    destinationHeight,
    crop,
  );
}

function drawPlaceholder(
  context: CanvasRenderingContext2D,
  photo: RenderPlan['photo'],
): void {
  // The photo-selection guide belongs to the DOM overlay. Canvas stays
  // final-only so an export with no image contains no editor instructions.
  context.fillStyle = '#dcebe8';
  context.fillRect(photo.x, photo.y, photo.width, photo.height);
}

function drawPhoto(
  context: CanvasRenderingContext2D,
  photo: RenderPlan['photo'],
  image: ShareCardImage,
  cropState: CropState,
): CoverCrop | undefined {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    drawPlaceholder(context, photo);
    return undefined;
  }

  const crop = calculatePhotoCrop(image, cropState, photo.width, photo.height);
  context.save();
  context.beginPath();
  context.rect(photo.x, photo.y, photo.width, photo.height);
  context.clip();
  context.drawImage(
    image.source ?? (image as unknown as CanvasImageSource),
    crop.sourceX,
    crop.sourceY,
    crop.sourceWidth,
    crop.sourceHeight,
    photo.x,
    photo.y,
    crop.destinationWidth,
    crop.destinationHeight,
  );
  context.restore();

  context.fillStyle = 'rgba(14, 55, 62, 0.08)';
  context.fillRect(photo.x, photo.y, photo.width, photo.height);
  return crop;
}

function measureText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): number {
  const width = context.measureText(text).width;
  return Number.isFinite(width) ? width : maxWidth + 1;
}

function chooseNameFontSize(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  requestedSize: number,
): number {
  for (let size = requestedSize; size >= 1; size -= 1) {
    context.font = `600 ${size}px ${NAME_FONT_FAMILY}`;
    if (measureText(context, text, maxWidth) <= maxWidth) {
      return size;
    }
  }
  return 1;
}

function prepareStoreName(
  context: CanvasRenderingContext2D,
  value: string,
): { text: string; fontSize: number } {
  const { graphemes } = normalizeAndSegment(value);
  const output = graphemes.slice(0, 24).join('');
  if (!output) {
    return { text: '', fontSize: FONT_SIZES.name };
  }

  context.font = `600 ${FONT_SIZES.name}px ${NAME_FONT_FAMILY}`;
  const requestedSize = graphemes.length <= 12
    ? FONT_SIZES.name
    : chooseNameFontSize(context, output, NAME_WIDTH, FONT_SIZES.name);
  const fontSize = measureText(context, output, NAME_WIDTH) <= NAME_WIDTH
    ? requestedSize
    : chooseNameFontSize(context, output, NAME_WIDTH, requestedSize);
  return { text: output, fontSize };
}

function wrapAddressGraphemes(
  context: CanvasRenderingContext2D,
  graphemes: string[],
  maxWidth: number,
): { lines: string[]; overflow: boolean } {
  const lines: string[] = [];
  let current = '';
  for (const grapheme of graphemes) {
    if (lines.length >= 2) {
      if (/^\s$/u.test(grapheme)) {
        continue;
      }
      return { lines, overflow: true };
    }
    if (!current && /^\s$/u.test(grapheme)) {
      continue;
    }
    const candidate = current + grapheme;
    if (current && measureText(context, candidate, maxWidth) > maxWidth) {
      lines.push(current.trimEnd());
      current = grapheme.trimStart();
      if (lines.length >= 2 && current) {
        return { lines, overflow: true };
      }
      continue;
    }
    current = candidate;
  }
  if (current) {
    lines.push(current.trimEnd());
  }
  return { lines, overflow: false };
}

function replaceLastLineWithEllipsis(
  context: CanvasRenderingContext2D,
  lines: string[],
  maxWidth: number,
): string[] {
  const output = lines.slice(0, 2);
  if (output.length === 0) {
    return [ELLIPSIS];
  }

  const lastIndex = output.length - 1;
  let graphemes = segmentGraphemes(output[lastIndex].trimEnd());
  while (graphemes.length > 0) {
    const candidate = `${graphemes.slice(0, -1).join('')}${ELLIPSIS}`;
    if (measureText(context, candidate, maxWidth) <= maxWidth) {
      output[lastIndex] = candidate;
      return output;
    }
    graphemes = graphemes.slice(0, -1);
  }
  output[lastIndex] = ELLIPSIS;
  return output;
}

function prepareAddress(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): { text: string; lines: string[] } {
  const { text: normalized, graphemes } = normalizeAndSegment(value);
  if (!normalized) {
    return { text: '', lines: [] };
  }

  context.font = `400 ${FONT_SIZES.address}px ${BODY_FONT_FAMILY}`;
  const wrapped = wrapAddressGraphemes(context, graphemes, maxWidth);
  const lines = wrapped.overflow
    ? replaceLastLineWithEllipsis(context, wrapped.lines, maxWidth)
    : wrapped.lines;
  return { text: lines.join('\n'), lines };
}

function fitSingleLine(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized || measureText(context, normalized, maxWidth) <= maxWidth) {
    return normalized;
  }
  const graphemes = segmentGraphemes(normalized);
  for (let count = graphemes.length; count > 0; count -= 1) {
    const candidate = graphemes.slice(0, count - 1).join('') + ELLIPSIS;
    if (measureText(context, candidate, maxWidth) <= maxWidth) {
      return candidate;
    }
  }
  return ELLIPSIS;
}

interface DetailSpec {
  kind: Exclude<RenderLineKind, 'name' | 'social'>;
  text: string;
  font: string;
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  color: string;
}

function createDetailSpecs(place: ShareCardPlaceData): DetailSpec[] {
  const candidates: DetailSpec[] = [
    {
      kind: 'rating',
      text: formatRatingDetails(place.rating, place.reviewCount),
      font: `600 ${FONT_SIZES.rating}px ${BODY_FONT_FAMILY}`,
      fontSize: FONT_SIZES.rating,
      lineHeight: LINE_HEIGHTS.rating,
      maxLines: 1,
      color: '#0a969c',
    },
    {
      kind: 'category',
      text: formatCategoryPrice(place.category, place.priceText),
      font: `500 ${FONT_SIZES.category}px ${BODY_FONT_FAMILY}`,
      fontSize: FONT_SIZES.category,
      lineHeight: LINE_HEIGHTS.category,
      maxLines: 1,
      color: '#345b61',
    },
    {
      kind: 'hours',
      text: normalizeOptionalText(place.hoursText),
      font: `600 ${FONT_SIZES.hours}px ${BODY_FONT_FAMILY}`,
      fontSize: FONT_SIZES.hours,
      lineHeight: LINE_HEIGHTS.hours,
      maxLines: 1,
      color: '#087f8a',
    },
    {
      kind: 'address',
      text: normalizeOptionalText(place.address),
      font: `400 ${FONT_SIZES.address}px ${BODY_FONT_FAMILY}`,
      fontSize: FONT_SIZES.address,
      lineHeight: LINE_HEIGHTS.address,
      maxLines: 2,
      color: '#547277',
    },
  ];
  return candidates.filter((spec) => Boolean(spec.text));
}

function createLineBox(
  box: Omit<RenderLineBox, 'inkMetrics' | 'baseline' | 'inkTop' | 'inkBottom'>,
): RenderLineBox {
  return {
    ...box,
    inkMetrics: [],
    baseline: box.top,
    inkTop: box.top,
    inkBottom: box.top,
  };
}

function applyMeasuredLineMetrics(
  context: CanvasRenderingContext2D,
  box: RenderLineBox,
): void {
  context.font = box.font;
  // Non-social baselines are anchored to a fixed reference glyph, not the current
  // line's actual ascent. Actual metrics remain ink bounds for clipping and
  // animation protection.
  const reference = measureTextInk(
    context,
    BODY_BASELINE_REFERENCE,
    box.fontSize,
    box.lineHeight,
  );
  const metrics = box.lines.map((line, index): RenderTextInkMetrics => {
    const measured = measureTextInk(context, line, box.fontSize, box.lineHeight);
    const baseline = box.top + index * box.lineHeight + reference.ascent;
    return {
      ascent: measured.ascent,
      descent: measured.descent,
      baseline,
      inkTop: baseline - measured.ascent,
      inkBottom: baseline + measured.descent,
    };
  });
  box.inkMetrics = metrics;
  box.baseline = metrics[0]?.baseline ?? box.top;
  box.inkTop = metrics.length > 0
    ? Math.min(...metrics.map((metric) => metric.inkTop))
    : box.top;
  box.inkBottom = metrics.length > 0
    ? Math.max(...metrics.map((metric) => metric.inkBottom))
    : box.top;
}

function alignQrCodeToFixedAnchor(plan: RenderPlan, infoLayout: InfoLayout): void {
  const qrCodeBox = plan.qrCodeBox;
  if (!qrCodeBox) {
    return;
  }

  const hasSocial = infoLayout.lineBoxes.some((box) => box.kind === 'social');
  const hasAddress = infoLayout.lineBoxes.some((box) => box.kind === 'address');
  const visualBottom = hasSocial
    ? SOCIAL_INK_BOTTOM
    : FULL_ADDRESS_TOP + LINE_HEIGHTS.address * (hasAddress ? 2 : 1);
  const delta = visualBottom - qrCodeBox.visualSize - qrCodeBox.visualY;
  qrCodeBox.y += delta;
  qrCodeBox.visualY += delta;
}

function createInfoLayout(
  context: CanvasRenderingContext2D,
  plan: RenderPlan,
  place: ShareCardPlaceData,
): InfoLayout {
  const name = prepareStoreName(context, place.storeName);
  plan.name.text = name.text;
  plan.name.maxWidth = NAME_WIDTH;
  plan.name.fontSize = name.fontSize;
  plan.name.lineHeight = NAME_LINE_HEIGHT;

  const lineBoxes: RenderLineBox[] = [];
  if (name.text) {
    lineBoxes.push(createLineBox({
      kind: 'name',
      text: name.text,
      lines: [name.text],
      x: CARD_INSET,
      top: 0,
      width: NAME_WIDTH,
      height: NAME_LINE_HEIGHT,
      font: `600 ${name.fontSize}px ${NAME_FONT_FAMILY}`,
      fontSize: name.fontSize,
      lineHeight: NAME_LINE_HEIGHT,
      maxLines: 1,
      color: '#12363c',
    }));
  }

  for (const spec of createDetailSpecs(place)) {
    context.font = spec.font;
    const lines = spec.kind === 'address'
      ? prepareAddress(context, spec.text, BODY_WIDTH).lines
      : [fitSingleLine(context, spec.text, BODY_WIDTH)];
    if (lines.length === 0) {
      continue;
    }
    lineBoxes.push(createLineBox({
      kind: spec.kind,
      text: lines.join('\n'),
      lines,
      x: CARD_INSET,
      top: 0,
      width: BODY_WIDTH,
      height: lines.length * spec.lineHeight,
      font: spec.font,
      fontSize: spec.fontSize,
      lineHeight: spec.lineHeight,
      maxLines: spec.maxLines,
      color: spec.color,
    }));
  }

  const normal = lineBoxes;
  let cursor = INFO_START_Y;
  normal.forEach((box, index) => {
    box.top = cursor;
    cursor += box.height;
    if (index < normal.length - 1) {
      cursor += FIELD_GAP;
    }
    applyMeasuredLineMetrics(context, box);
  });

  const mainBottom = normal.length > 0
    ? Math.max(...normal.map((box) => box.top + box.height))
    : INFO_START_Y;

  const socialText = normalizeOptionalText(place.socialId);
  let socialTop = SOCIAL_INK_BOTTOM;
  let socialInkBottom = SOCIAL_INK_BOTTOM;
  if (socialText) {
    const socialFont = `500 ${FONT_SIZES.social}px ${BODY_FONT_FAMILY}`;
    context.font = socialFont;
    const output = fitSingleLine(context, socialText, BODY_WIDTH);
    const measured = measureSocialTextInk(context, output, FONT_SIZES.social, SOCIAL_LINE_HEIGHT);
    const baseline = SOCIAL_INK_BOTTOM - measured.descent;
    socialTop = baseline - measured.ascent;
    const socialBox = createLineBox({
      kind: 'social',
      text: output,
      lines: [output],
      x: CARD_INSET,
      top: socialTop,
      width: BODY_WIDTH,
      height: SOCIAL_LINE_HEIGHT,
      font: socialFont,
      fontSize: FONT_SIZES.social,
      lineHeight: SOCIAL_LINE_HEIGHT,
      maxLines: 1,
      color: '#547277',
    });
    socialBox.inkMetrics = [{
      ascent: measured.ascent,
      descent: measured.descent,
      baseline,
      inkTop: socialTop,
      inkBottom: SOCIAL_INK_BOTTOM,
    }];
    socialBox.baseline = baseline;
    socialBox.inkTop = socialTop;
    socialBox.inkBottom = SOCIAL_INK_BOTTOM;
    lineBoxes.push(socialBox);
    socialInkBottom = socialBox.inkBottom;
  }

  const nameBox = normal.find((box) => box.kind === 'name');
  plan.name.top = nameBox?.top ?? INFO_START_Y;
  return {
    lineBoxes,
    mainTop: INFO_START_Y,
    mainBottom,
    socialTop,
    socialInkBottom,
    fieldGap: FIELD_GAP,
  };
}

interface MeasuredTextInk {
  ascent: number;
  descent: number;
}

function metricOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function socialMetricOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function fallbackTextInkMetrics(
  metrics: TextMetrics,
  fontSize: number,
  lineHeight: number,
): MeasuredTextInk {
  const fallbackAscent = Math.min(fontSize * 0.8, lineHeight * 0.8);
  const fallbackDescent = Math.min(
    fontSize * 0.2,
    Math.max(0, lineHeight - fallbackAscent),
  );
  return {
    ascent: metricOrFallback(
      metrics.fontBoundingBoxAscent,
      metricOrFallback(metrics.emHeightAscent, fallbackAscent),
    ),
    descent: metricOrFallback(
      metrics.fontBoundingBoxDescent,
      metricOrFallback(metrics.emHeightDescent, fallbackDescent),
    ),
  };
}

/** Measure the same font/text used by drawLineBox while the layout is built. */
function measureTextInk(
  context: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  lineHeight: number,
): MeasuredTextInk {
  const metrics = context.measureText(text);
  const fallback = fallbackTextInkMetrics(metrics, fontSize, lineHeight);
  return {
    ascent: metricOrFallback(metrics.actualBoundingBoxAscent, fallback.ascent),
    descent: metricOrFallback(metrics.actualBoundingBoxDescent, fallback.descent),
  };
}

/**
 * Social footer metrics intentionally preserve finite signed actual bounds.
 * Chromium can report a negative descent for glyphs such as em dashes; the
 * signed value is part of the measured ink anchor and must not be normalized.
 */
function measureSocialTextInk(
  context: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  lineHeight: number,
): MeasuredTextInk {
  const metrics = context.measureText(text);
  const fallback = fallbackTextInkMetrics(metrics, fontSize, lineHeight);
  return {
    ascent: socialMetricOrFallback(metrics.actualBoundingBoxAscent, fallback.ascent),
    descent: socialMetricOrFallback(metrics.actualBoundingBoxDescent, fallback.descent),
  };
}

function clampProgress(progress: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 1));
}

function drawFullLine(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  alpha: number,
): void {
  if (!text) {
    return;
  }
  context.globalAlpha = alpha;
  context.fillText(text, x, baseline);
}

interface InkProtectionRegion {
  x: number;
  width: number;
  top: number;
  bottom: number;
}

function visibleInkRegion(
  box: RenderLineBox,
  lineIndex: number,
  metrics: RenderTextInkMetrics,
): InkProtectionRegion {
  const lineBoxTop = box.top + lineIndex * box.lineHeight;
  const lineBoxBottom = lineBoxTop + box.lineHeight;
  return {
    x: box.x,
    width: box.width,
    top: Math.max(lineBoxTop, metrics.inkTop),
    bottom: Math.min(lineBoxBottom, metrics.inkBottom),
  };
}

function subtractInkProtection(
  top: number,
  bottom: number,
  x: number,
  width: number,
  protectedRegions: InkProtectionRegion[],
): Array<{ top: number; bottom: number }> {
  if (bottom <= top || width <= 0) {
    return [];
  }
  const blocked = protectedRegions
    .filter((region) =>
      region.bottom > top &&
      region.top < bottom &&
      region.x < x + width &&
      region.x + region.width > x,
    )
    .map((region) => ({
      top: Math.max(top, region.top),
      bottom: Math.min(bottom, region.bottom),
    }))
    .filter((region) => region.bottom > region.top)
    .sort((first, second) => first.top - second.top);
  if (blocked.length === 0) {
    return [{ top, bottom }];
  }

  const segments: Array<{ top: number; bottom: number }> = [];
  let cursor = top;
  for (const region of blocked) {
    if (region.top > cursor) {
      segments.push({ top: cursor, bottom: region.top });
    }
    cursor = Math.max(cursor, region.bottom);
  }
  if (cursor < bottom) {
    segments.push({ top: cursor, bottom });
  }
  return segments;
}

function drawLineBox(
  context: CanvasRenderingContext2D,
  box: RenderLineBox,
  animation?: RenderTextAnimation,
  protectedRegions: InkProtectionRegion[] = [],
): void {
  context.save();
  context.fillStyle = box.color;
  context.font = box.font;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  const progress = clampProgress(animation?.progress ?? 1);
  const ranges = animation?.kind === box.kind
    ? animation.ranges
      .filter((range) => range.lineIndex >= 0 && range.lineIndex < box.lines.length)
      .sort((first, second) => first.lineIndex - second.lineIndex || first.start - second.start)
    : [];
  const rangeByLine = new Map<number, RenderTextAnimationRange>();
  for (const range of ranges) {
    if (!rangeByLine.has(range.lineIndex)) {
      rangeByLine.set(range.lineIndex, range);
    }
  }
  const lines = box.lines.map((line, index) => ({
    line,
    metrics: box.inkMetrics[index],
  }));
  context.beginPath();
  const outerTop = box.kind === 'social' && box.inkMetrics[0]
    ? visibleInkRegion(box, 0, box.inkMetrics[0]).top
    : box.top;
  const outerBottom = box.kind === 'social' && box.inkMetrics[0]
    ? visibleInkRegion(box, 0, box.inkMetrics[0]).bottom
    : box.top + box.height;
  context.rect(box.x, outerTop, box.width, Math.max(0, outerBottom - outerTop));
  context.clip();
  lines.forEach(({ line, metrics }, lineIndex) => {
    if (!metrics) {
      return;
    }
    // Nested mask restore may return the paper color; every line starts by
    // reasserting its own final text color before any full-line draw.
    context.fillStyle = box.color;
    const range = rangeByLine.get(lineIndex);
    if (!range || progress >= 1) {
      drawFullLine(context, line, box.x, metrics.baseline, 1);
      return;
    }

    const graphemes = segmentGraphemes(line);
    const start = Math.min(graphemes.length, Math.max(0, range.start));
    const end = Math.min(graphemes.length, Math.max(start, range.end));
    if (start >= end) {
      drawFullLine(context, line, box.x, metrics.baseline, 1);
      return;
    }
    const prefix = graphemes.slice(0, start).join('');
    const animated = graphemes.slice(start, end).join('');
    const startAdvance = measureText(context, prefix, box.width);
    const endAdvance = measureText(context, `${prefix}${animated}`, box.width);
    const maskX = box.x + startAdvance;
    const maskWidth = Math.max(0, endAdvance - startAdvance);
    const lineRegion = visibleInkRegion(box, lineIndex, metrics);
    const segments = subtractInkProtection(
      lineRegion.top,
      lineRegion.bottom,
      maskX,
      maskWidth,
      protectedRegions,
    );

    // Keep one final-shaped fillText as the stable base. The paper mask removes
    // only the inserted ink/advance, then the same full string is redrawn so
    // browser kerning never changes at the suffix boundary. For overlapping
    // address/social line boxes, subtract protected address ink before painting
    // paper so the animation can never erase another field.
    drawFullLine(context, line, box.x, metrics.baseline, 1);
    for (const segment of segments) {
      context.globalAlpha = 1;
      context.fillStyle = '#fbfbf6';
      context.fillRect(maskX, segment.top, maskWidth, segment.bottom - segment.top);
      context.save();
      context.beginPath();
      context.rect(maskX, segment.top, maskWidth, segment.bottom - segment.top);
      context.clip();
      context.fillStyle = box.color;
      context.globalAlpha = progress;
      context.fillText(line, box.x, metrics.baseline + (1 - progress) * 8);
      context.globalAlpha = 1;
      context.restore();
    }
  });
  context.globalAlpha = 1;
  context.restore();
}

export function hasExportablePlaceContent(
  content: ShareCardContent | (Partial<ShareCardPlaceData> & { sourceUrl?: string }),
): boolean {
  const data = 'placeInfo' in content
    ? resolveShareCardPlaceData(content as ShareCardContent)
    : content as ShareCardPlaceData;
  const qrCodeResult = typeof data.qrCode === 'string'
    ? createQrCodeResult(data.qrCode)
    : {};
  return Boolean(
    normalizeOptionalText(data.storeName) ||
    formatRating(data.rating) ||
    formatReviewCount(data.reviewCount) ||
    normalizeOptionalText(data.address) ||
    normalizeOptionalText(data.category) ||
    normalizeOptionalText(data.priceText) ||
    normalizeOptionalText(data.hoursText) ||
    normalizeOptionalText(data.socialId) ||
    qrCodeResult.matrix,
  );
}

export function renderShareCard(
  canvas: HTMLCanvasElement,
  content: ShareCardContent,
  options: ShareCardRenderOptions = {},
): RenderPlan {
  const place = resolveShareCardPlaceData(content);
  const qrCodeResult = typeof place.qrCode === 'string'
    ? createQrCodeResult(place.qrCode)
    : {};
  const plan = createRenderPlan(place.storeName, qrCodeResult);
  canvas.width = plan.width;
  canvas.height = plan.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is unavailable.');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, plan.width, plan.height);

  if (content.image) {
    plan.photoCrop = drawPhoto(
      context,
      plan.photo,
      content.image,
      content.crop ?? createCenteredCropState(),
    );
  } else {
    drawPlaceholder(context, plan.photo);
  }

  context.fillStyle = '#fbfbf6';
  context.fillRect(
    plan.info.x,
    plan.info.y,
    plan.info.width,
    plan.info.height,
  );

  plan.infoLayout = createInfoLayout(context, plan, place);
  alignQrCodeToFixedAnchor(plan, plan.infoLayout);
  for (const lineBox of plan.infoLayout.lineBoxes) {
    const protectedRegions = plan.infoLayout.lineBoxes
      .filter((otherBox) => otherBox !== lineBox)
      .flatMap((otherBox) => otherBox.inkMetrics.map((metrics, index) =>
        visibleInkRegion(otherBox, index, metrics),
      ));
    drawLineBox(context, lineBox, options.textAnimation, protectedRegions);
  }
  if (plan.qrCodeMatrix && plan.qrCodeBox) {
    drawQrCode(
      context,
      plan.qrCodeMatrix,
      plan.qrCodeBox,
      clampProgress(options.qrAnimationProgress ?? 1),
    );
  }
  return plan;
}
