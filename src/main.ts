import {
  beginImageLoad,
  canDownload,
  completeImageLoad,
  failImageLoad,
  releaseImage,
  type ImageLoadState,
} from './image-load-state';
import { decodeShareCardImage, isSupportedImageFile } from './image-decode';
import {
  beginExportGeneration,
  createBrowserExportEnvironment,
  invalidateExportGeneration,
  isCurrentExportGeneration,
  isIosSafari,
  openPngBlob,
  preparePngPreview,
  type PngExportResult,
} from './export-image';
import { createCalibrationLoader } from './calibration';
import { normalizeAndSegment, segmentGraphemes } from './grapheme';
import { resolvePlaceFromInput } from './place-resolver';
import {
  mountPlaceEditor,
  type PlaceEditorChangeTarget,
  type PlaceEditorNotice,
  type PlaceEditorSnapshot,
} from './place-editor';
import {
  clearDraftMetadata,
  createDraftPhotoStore,
  DRAFT_VERSION,
  loadDraftMetadata,
  saveDraftMetadata,
  type DraftMetadata,
} from './draft-store';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  PHOTO_HEIGHT,
  calculatePhotoCrop,
  hasExportablePlaceContent,
  renderShareCard,
  type RenderLineKind,
  type RenderPlan,
  type ShareCardRenderOptions,
} from './share-card';
import {
  findPureGraphemeInsertion,
  mapFormattedRangeToLines,
  mapRawInsertionToFormatted,
} from './preview-animation';
import {
  clampCropState,
  createCenteredCropState,
  mapPointerDeltaToCanvas,
  panCropByCanvasDelta,
  type CropState,
} from './photo-crop';
import {
  calculateNavigatorContain,
  drawPhotoNavigator,
  mapCropRectToNavigator,
} from './photo-navigator';
import {
  ACTIVE_THEME_OPTIONS,
  applyTheme,
  parseThemeId,
  readPalettes,
  readThemePreference,
  writeThemePreference,
  type PreviewPalette,
  type ThemeId,
} from './theme';
import { mountThemePicker } from './theme-picker';
import { createThemeTransition } from './theme-transition';
import {
  beginGesturePointer,
  cancelGesture,
  endGesturePointer,
  updateGesturePointer,
  type PanGestureState,
} from './photo-pan';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required editor element: ${selector}`);
  }
  return element;
}

const photoInput = requireElement<HTMLInputElement>('#photo-input');
const photoPicker = requireElement<HTMLButtonElement>('#photo-picker');
const replacePhotoButton = requireElement<HTMLButtonElement>('#replace-photo-button');
const previewCanvas = requireElement<HTMLCanvasElement>('#card-preview');
const photoPanTarget = requireElement<HTMLDivElement>('#photo-pan-target');
const photoNavigator = requireElement<HTMLCanvasElement>('#photo-navigator');
const downloadButton = requireElement<HTMLButtonElement>('#download-button');
const clearDataButton = requireElement<HTMLButtonElement>('#clear-data-button');
const manualExportFallback = requireElement<HTMLDivElement>('#manual-export-fallback');
const manualExportLink = requireElement<HTMLAnchorElement>('#manual-export-link');
const status = requireElement<HTMLParagraphElement>('#status');
const previewActions = requireElement<HTMLDivElement>('.preview-actions');
const themePickerWrapper = requireElement<HTMLDivElement>('#theme-picker-wrapper');
const themePickerTrigger = requireElement<HTMLButtonElement>('#theme-picker-trigger');
const themePickerPanel = requireElement<HTMLDivElement>('#theme-picker-panel');
const workspace = requireElement<HTMLElement>('.workspace');
const editorFocusTarget = requireElement<HTMLInputElement>('#maps-url');
const editorPanel = requireElement<HTMLElement>('#editor-panel');
const infoHotspot = requireElement<HTMLButtonElement>('#info-hotspot');
const infoHotspotLabel = requireElement<HTMLSpanElement>('.info-hotspot-label');
const infoGhost = requireElement<HTMLSpanElement>('#info-ghost');
const infoRevealOverlay = requireElement<HTMLSpanElement>('#info-reveal-overlay');
const closeEditorButton = requireElement<HTMLButtonElement>('#close-editor-button');

const state: ImageLoadState = {
  image: null,
  objectUrl: null,
  loading: false,
};
const NAVIGATOR_HIDE_DELAY_MS = 2_000;
const KEYBOARD_ZOOM_FACTOR = 1.1;
const EDITOR_REVEAL_SCROLL_DURATION_MS = 840;
const DESKTOP_EDITOR_MEDIA_QUERY = '(min-width: 960px)';
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';
const MANUAL_PREVIEW_ANIMATION_DURATION_MS = 90;

type InfoRevealPhase = 'lookup' | 'success';

const themeStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
let selectedThemeId: ThemeId = readThemePreference(themeStorage);
applyTheme(document.documentElement, selectedThemeId);
let activeThemePalettes = readPalettes(getComputedStyle(document.documentElement));

const draftStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const restoredDraftMetadata = loadDraftMetadata(draftStorage);
const draftPhotoStore = createDraftPhotoStore();

let cropState: CropState = restoredDraftMetadata?.crop ?? createCenteredCropState();
let draftHasPhoto = restoredDraftMetadata?.hasPhoto ?? false;
let draftPersistenceDisabled = false;
let photoSaveFailedGeneration: number | null = null;
let photoLoadGeneration = 0;
let photoMutationRevision = 0;
let photoMutationChain: Promise<void> = Promise.resolve();
let lastPlaceEditorSnapshot: PlaceEditorSnapshot | null = null;
let manualPreviewAnimationFrame: number | null = null;
let manualPreviewAnimationGeneration = 0;
let infoRevealFrame: number | null = null;
let infoRevealGeneration = 0;
let gestureState: PanGestureState = cancelGesture();
let navigatorHideTimer: number | null = null;
let navigatorGeneration = 0;
let editorRevealScrollFrame: number | null = null;
let activeExportCleanup: (() => void) | null = null;
let exportGeneration = 0;
const pendingExportPreviewWindows = new Map<Window, number>();
const themeTransition = createThemeTransition({
  root: document.documentElement,
  canvas: previewCanvas,
  window,
  reducedMotion: prefersReducedMotion,
  cancelAnimations: () => {
    cancelManualPreviewAnimation();
    clearInfoReveal();
  },
});

type StatusSource = 'validation' | 'non-validation';

let visibleStatusSource: StatusSource = 'non-validation';
let nextPlaceStatusSource: StatusSource | null = null;

const calibrationStorage = draftStorage;
const calibrationLoader = createCalibrationLoader({
  storage: calibrationStorage,
});
void calibrationLoader.load();

function setStatus(
  message: string,
  isError = false,
  source: StatusSource = 'non-validation',
): void {
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
  visibleStatusSource = source;
}

function setMainStatus(message: string, isError = false): void {
  nextPlaceStatusSource = null;
  setStatus(message, isError, 'non-validation');
}

function currentDraftMetadata(): DraftMetadata {
  return {
    version: DRAFT_VERSION,
    editor: placeEditor.readDraft(),
    crop: { ...cropState },
    hasPhoto: draftHasPhoto,
  };
}

function persistDraftMetadata(): void {
  if (draftPersistenceDisabled) {
    return;
  }
  saveDraftMetadata(draftStorage, currentDraftMetadata());
}

function enqueuePhotoMutation(operation: () => Promise<void>): Promise<void> {
  const next = photoMutationChain.then(operation, operation);
  photoMutationChain = next.catch(() => undefined);
  return next;
}

function currentShareCardContent(snapshot = placeEditor.read()) {
  return {
    ...snapshot.content,
    image: state.image,
    crop: state.image ? cropState : undefined,
  };
}

function syncInfoGhost(
  content: ReturnType<typeof currentShareCardContent>,
  snapshot: PlaceEditorSnapshot,
): void {
  const hasFinalContent = hasExportablePlaceContent(content);
  const isInvalid = !snapshot.valid;
  const revealPhase = infoHotspot.dataset.revealPhase as InfoRevealPhase | undefined;
  infoGhost.dataset.visible = String(Boolean(revealPhase) || !hasFinalContent);
  infoHotspot.dataset.hasContent = String(hasFinalContent);
  infoHotspot.dataset.invalid = String(isInvalid);
  infoHotspotLabel.textContent = isInvalid ? '修正地點資料' : '編輯地點資料';
  infoHotspot.setAttribute(
    'aria-label',
    isInvalid
      ? '修正地點資料，部分欄位需要修正'
      : hasFinalContent
        ? '編輯地點資料'
        : '編輯地點資料，目前尚無可輸出的文字',
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches;
}

function cancelInfoRevealFrame(): void {
  infoRevealGeneration += 1;
  if (infoRevealFrame !== null) {
    window.cancelAnimationFrame(infoRevealFrame);
    infoRevealFrame = null;
  }
}

function clearInfoReveal(): void {
  cancelInfoRevealFrame();
  infoHotspot.removeAttribute('data-reveal-phase');
  if (lastPlaceEditorSnapshot) {
    syncInfoGhost(
      currentShareCardContent(lastPlaceEditorSnapshot),
      lastPlaceEditorSnapshot,
    );
  }
}

function startInfoLookupReveal(): void {
  cancelInfoRevealFrame();
  infoHotspot.dataset.revealPhase = 'lookup';
  if (lastPlaceEditorSnapshot) {
    syncInfoGhost(
      currentShareCardContent(lastPlaceEditorSnapshot),
      lastPlaceEditorSnapshot,
    );
  }
}

function finishInfoReveal(): void {
  cancelInfoRevealFrame();
  if (prefersReducedMotion()) {
    clearInfoReveal();
    return;
  }
  const generation = infoRevealGeneration;
  infoRevealFrame = window.requestAnimationFrame(() => {
    infoRevealFrame = null;
    if (
      generation !== infoRevealGeneration ||
      infoHotspot.dataset.revealPhase !== 'lookup'
    ) {
      return;
    }
    if (prefersReducedMotion()) {
      clearInfoReveal();
      return;
    }
    infoHotspot.dataset.revealPhase = 'success';
  });
}

function handleInfoRevealAnimationEnd(event: AnimationEvent): void {
  if (
    event.target !== infoRevealOverlay ||
    event.animationName !== 'info-reveal-overlay-fade' ||
    infoHotspot.dataset.revealPhase !== 'success'
  ) {
    return;
  }
  clearInfoReveal();
}

infoRevealOverlay.addEventListener('animationend', handleInfoRevealAnimationEnd);

function clearNavigatorHideTimer(): void {
  if (navigatorHideTimer !== null) {
    window.clearTimeout(navigatorHideTimer);
    navigatorHideTimer = null;
  }
}

function hideNavigator(): void {
  clearNavigatorHideTimer();
  navigatorGeneration += 1;
  photoNavigator.hidden = true;
  photoNavigator.removeAttribute('data-active');
}

function scheduleNavigatorHide(): void {
  if (!state.image || gestureState.pointers.length > 0) {
    return;
  }
  clearNavigatorHideTimer();
  navigatorGeneration += 1;
  const generation = navigatorGeneration;
  navigatorHideTimer = window.setTimeout(() => {
    navigatorHideTimer = null;
    if (
      generation !== navigatorGeneration ||
      gestureState.pointers.length > 0 ||
      !state.image
    ) {
      return;
    }
    photoNavigator.hidden = false;
    photoNavigator.dataset.active = 'false';
  }, NAVIGATOR_HIDE_DELAY_MS);
}

function getActivePalettes() {
  return readPalettes(getComputedStyle(document.documentElement));
}

function renderNavigator(palette: PreviewPalette = getActivePalettes().preview): void {
  if (!state.image) {
    hideNavigator();
    return;
  }
  const sourceWidth = state.image.naturalWidth || state.image.width;
  const sourceHeight = state.image.naturalHeight || state.image.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    hideNavigator();
    return;
  }
  const context = photoNavigator.getContext('2d');
  if (!context) {
    return;
  }
  const width = photoNavigator.width;
  const height = photoNavigator.height;
  const source = state.image.source ?? (state.image as unknown as CanvasImageSource);
  const mapping = calculateNavigatorContain(
    sourceWidth,
    sourceHeight,
    width,
    height,
  );
  const crop = calculatePhotoCrop(state.image, cropState, CARD_WIDTH, PHOTO_HEIGHT);
  const cropRect = mapCropRectToNavigator(crop, mapping);

  drawPhotoNavigator(
    context,
    source,
    sourceWidth,
    sourceHeight,
    width,
    height,
    mapping,
    cropRect,
    palette,
  );
}

function showNavigator(): void {
  if (!state.image) {
    return;
  }
  clearNavigatorHideTimer();
  navigatorGeneration += 1;
  renderNavigator();
  photoNavigator.hidden = false;
  photoNavigator.dataset.active = 'true';
  if (gestureState.pointers.length === 0) {
    scheduleNavigatorHide();
  }
}

type ManualChangeNotice = Extract<
  PlaceEditorNotice,
  { type: 'change'; source: 'manual' }
>;

function cancelManualPreviewAnimation(): void {
  manualPreviewAnimationGeneration += 1;
  if (manualPreviewAnimationFrame !== null) {
    window.cancelAnimationFrame(manualPreviewAnimationFrame);
    manualPreviewAnimationFrame = null;
  }
}

function targetRenderLineKind(target: PlaceEditorChangeTarget): RenderLineKind | null {
  switch (target) {
    case 'store-name':
      return 'name';
    case 'rating':
    case 'review-count':
      return 'rating';
    case 'category':
    case 'price-text':
      return 'category';
    case 'hours-select':
    case 'custom-hours':
      return 'hours';
    case 'address':
      return 'address';
    case 'social-id':
      return 'social';
    default:
      return null;
  }
}

function lineBoxFor(
  plan: RenderPlan | null,
  kind: RenderLineKind,
): NonNullable<RenderPlan['infoLayout']>['lineBoxes'][number] | undefined {
  return plan?.infoLayout?.lineBoxes.find((box) => box.kind === kind);
}

function mapCurrentFormattedRange(
  box: NonNullable<RenderPlan['infoLayout']>['lineBoxes'][number],
  formattedValue: string,
  formattedRange: { start: number; end: number },
): Array<{ lineIndex: number; start: number; end: number }> {
  return mapFormattedRangeToLines(formattedValue, formattedRange, box.lines);
}

function mapSimpleTarget(
  notice: ManualChangeNotice,
  box: NonNullable<RenderPlan['infoLayout']>['lineBoxes'][number],
): Array<{ lineIndex: number; start: number; end: number }> {
  const normalizedPrevious = notice.target === 'store-name' || notice.target === 'address'
    ? normalizeAndSegment(notice.previousValue).text
    : notice.previousValue.trim();
  const normalizedCurrent = notice.target === 'store-name' || notice.target === 'address'
    ? normalizeAndSegment(notice.value).text
    : notice.value.trim();
  const insertion = findPureGraphemeInsertion(normalizedPrevious, normalizedCurrent);
  if (!insertion) {
    return [];
  }
  const formattedRange = mapRawInsertionToFormatted(
    normalizedCurrent,
    insertion,
    normalizedCurrent,
  );
  return formattedRange ? mapCurrentFormattedRange(box, normalizedCurrent, formattedRange) : [];
}

function mapCategoryPriceTarget(
  notice: ManualChangeNotice,
  box: NonNullable<RenderPlan['infoLayout']>['lineBoxes'][number],
): Array<{ lineIndex: number; start: number; end: number }> {
  const previous = notice.previousValue.trim();
  const current = notice.value.trim();
  const insertion = findPureGraphemeInsertion(previous, current);
  if (!insertion) {
    return [];
  }
  const category = notice.snapshot.content.placeInfo.category?.trim() ?? '';
  const price = notice.snapshot.content.placeInfo.priceText?.trim() ?? '';
  const formatted = [category, price].filter(Boolean).join(' · ');
  const localRange = mapRawInsertionToFormatted(current, insertion, current);
  if (!localRange) {
    return [];
  }
  const prefix = notice.target === 'price-text' && category ? `${category} · ` : '';
  const prefixLength = segmentGraphemes(prefix).length;
  return mapCurrentFormattedRange(box, formatted, {
    start: prefixLength + localRange.start,
    end: prefixLength + localRange.end,
  });
}

function formattedRating(value: string): string {
  const number = Number(value.trim());
  return Number.isFinite(number) && number >= 0 && number <= 5
    ? (Math.round(number * 10) / 10).toFixed(1)
    : '';
}

function formattedReviewCount(value: string): string {
  const number = Number(value.trim());
  return Number.isInteger(number) && number >= 0 && number <= 999999999
    ? new Intl.NumberFormat('en-US').format(number)
    : '';
}

function mapRatingReviewTarget(
  notice: ManualChangeNotice,
  box: NonNullable<RenderPlan['infoLayout']>['lineBoxes'][number],
): Array<{ lineIndex: number; start: number; end: number }> {
  const insertion = findPureGraphemeInsertion(notice.previousValue.trim(), notice.value.trim());
  if (!insertion) {
    return [];
  }
  const ratingValue = formattedRating(
    notice.target === 'rating'
      ? notice.value
      : String(notice.snapshot.content.placeInfo.rating ?? ''),
  );
  const reviewValue = formattedReviewCount(
    notice.target === 'review-count'
      ? notice.value
      : String(notice.snapshot.content.placeInfo.reviewCount ?? ''),
  );
  const ratingPart = ratingValue ? `★ ${ratingValue}` : '';
  const reviewPart = reviewValue ? `(${reviewValue})` : '';
  const parts = [ratingPart, reviewPart].filter(Boolean);
  const formatted = parts.join(' · ');
  const numericValue = notice.target === 'rating' ? ratingValue : reviewValue;
  const numericRange = mapRawInsertionToFormatted(notice.value.trim(), insertion, numericValue);
  if (!numericRange || !formatted) {
    return [];
  }
  let offset = 0;
  if (notice.target === 'rating') {
    offset += segmentGraphemes('★ ').length;
  } else {
    if (ratingPart) {
      offset += segmentGraphemes(ratingPart + ' · ').length;
    }
    offset += 1;
  }
  return mapCurrentFormattedRange(box, formatted, {
    start: offset + numericRange.start,
    end: offset + numericRange.end,
  });
}

function createManualPreviewOptions(
  notice: ManualChangeNotice,
  previousSnapshot: PlaceEditorSnapshot | null,
  currentPlan: RenderPlan,
): ShareCardRenderOptions | null {
  if (notice.target === 'maps-url' || notice.target === 'qr-code') {
    if (
      !previousSnapshot ||
      previousSnapshot.content.qrCode === notice.snapshot.content.qrCode ||
      !currentPlan.qrCodeMatrix
    ) {
      return null;
    }
    return { qrAnimationProgress: 0 };
  }

  if (notice.target === 'hours-select') {
    return null;
  }
  const kind = targetRenderLineKind(notice.target);
  if (!kind) {
    return null;
  }
  const box = lineBoxFor(currentPlan, kind);
  if (!box) {
    return null;
  }

  const ranges = notice.target === 'category' || notice.target === 'price-text'
    ? mapCategoryPriceTarget(notice, box)
    : notice.target === 'rating' || notice.target === 'review-count'
      ? mapRatingReviewTarget(notice, box)
      : mapSimpleTarget(notice, box);
  return ranges.length > 0
    ? { textAnimation: { kind, ranges, progress: 0 } }
    : null;
}

function renderPreview(
  snapshot = placeEditor.read(),
  options: ShareCardRenderOptions = {},
  preserveManualAnimation = false,
  palettes = activeThemePalettes,
): RenderPlan {
  if (!preserveManualAnimation) {
    cancelManualPreviewAnimation();
  }
  lastPlaceEditorSnapshot = snapshot;
  const content = currentShareCardContent(snapshot);
  const plan = renderShareCard(previewCanvas, content, {
    ...options,
    palette: palettes.shareCard,
  });
  syncInfoGhost(content, snapshot);
  renderNavigator(palettes.preview);
  return plan;
}

function startManualPreviewAnimation(
  snapshot: PlaceEditorSnapshot,
  options: ShareCardRenderOptions,
): void {
  if (prefersReducedMotion()) {
    return;
  }
  cancelManualPreviewAnimation();
  const generation = manualPreviewAnimationGeneration;
  renderPreview(snapshot, options, true);
  let startTime: number | null = null;
  const animate = (timestamp: number): void => {
    if (generation !== manualPreviewAnimationGeneration) {
      return;
    }
    if (startTime === null) {
      startTime = timestamp;
    }
    const progress = Math.min(
      (timestamp - startTime) / MANUAL_PREVIEW_ANIMATION_DURATION_MS,
      1,
    );
    const nextOptions: ShareCardRenderOptions = options.textAnimation
      ? {
          textAnimation: { ...options.textAnimation, progress },
        }
      : {
          qrAnimationProgress: progress,
        };
    renderPreview(snapshot, nextOptions, true);
    if (progress >= 1) {
      manualPreviewAnimationFrame = null;
      renderPreview(snapshot, {}, true);
      return;
    }
    manualPreviewAnimationFrame = window.requestAnimationFrame(animate);
  };
  manualPreviewAnimationFrame = window.requestAnimationFrame(animate);
}

function syncPhotoControls(): void {
  const hasImage = Boolean(state.image);
  photoPanTarget.hidden = !hasImage;
  photoPicker.hidden = hasImage;
  replacePhotoButton.hidden = !hasImage;
  if (!hasImage) {
    hideNavigator();
  }
  photoPanTarget.dataset.dragging = String(gestureState.pointers.length > 0);
  photoPanTarget.setAttribute(
    'aria-valuetext',
    '縮放 ' + cropState.zoom.toFixed(2) + '×，可用方向鍵微調位置',
  );
}

function syncDownloadAvailability(snapshot = placeEditor.read()): void {
  downloadButton.disabled = !canDownload(state) || !snapshot.valid;
}

function captureThemePalettes(themeId: ThemeId): ReturnType<typeof readPalettes> {
  const previousThemeId = selectedThemeId;
  applyTheme(document.documentElement, themeId);
  const palettes = getActivePalettes();
  applyTheme(document.documentElement, previousThemeId);
  // Commit the restored theme before the transition captures its old token values.
  getComputedStyle(document.documentElement).getPropertyValue('--theme-page');
  return palettes;
}

function selectTheme(value: string): void {
  const themeId = parseThemeId(value);
  if (!themeId || themeId === selectedThemeId) return;

  // Interruptions intentionally snap to the last selected palette before a fresh snapshot.
  themeTransition.cancel();
  const targetPalettes = captureThemePalettes(themeId);
  themeTransition.start({
    applyTarget: () => {
      selectedThemeId = themeId;
      applyTheme(document.documentElement, themeId);
      writeThemePreference(themeStorage, themeId);
      activeThemePalettes = targetPalettes;
    },
    renderTarget: () => {
      renderPreview(lastPlaceEditorSnapshot ?? placeEditor.read(), {}, false, targetPalettes);
    },
  });
}

function clearManualExportFallback(): void {
  activeExportCleanup?.();
  activeExportCleanup = null;
  manualExportLink.removeAttribute('href');
  manualExportFallback.hidden = true;
}

function trackExportPreviewWindow(previewWindow: Window | null, token: number): void {
  if (previewWindow) {
    pendingExportPreviewWindows.set(previewWindow, token);
  }
}

function clearExportPreviewReference(previewWindow: Window | null, token: number): void {
  if (previewWindow && pendingExportPreviewWindows.get(previewWindow) === token) {
    pendingExportPreviewWindows.delete(previewWindow);
  }
}

function closeExportPreview(previewWindow: Window | null, token: number): void {
  if (!previewWindow || pendingExportPreviewWindows.get(previewWindow) !== token) {
    return;
  }
  pendingExportPreviewWindows.delete(previewWindow);
  try {
    previewWindow.close();
  } catch {
    // A closed or cross-origin preview is already no longer pending.
  }
}

function closePendingExportPreviews(): void {
  for (const previewWindow of pendingExportPreviewWindows.keys()) {
    try {
      previewWindow.close();
    } catch {
      // A closed or cross-origin preview is already no longer pending.
    }
  }
  pendingExportPreviewWindows.clear();
}

function showManualExportFallback(result: Extract<PngExportResult, { mode: 'manual' }>): void {
  activeExportCleanup = result.cleanup;
  manualExportLink.href = result.url;
  manualExportFallback.hidden = false;
}

function keepExportUrl(result: PngExportResult): void {
  activeExportCleanup?.();
  activeExportCleanup = result.mode === 'download' ? null : result.cleanup;
}

function releaseObjectUrl(): void {
  hideNavigator();
  gestureState = cancelGesture();
  releaseImage(state.image);
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
  }
  Object.assign(state, { image: null, objectUrl: null, loading: false });
}

function imageDimensions(): { width: number; height: number } | null {
  if (!state.image) {
    return null;
  }
  const width = state.image.naturalWidth || state.image.width;
  const height = state.image.naturalHeight || state.image.height;
  return width > 0 && height > 0 ? { width, height } : null;
}

function updateCrop(next: CropState): void {
  draftPersistenceDisabled = false;
  const dimensions = imageDimensions();
  cropState = dimensions
    ? clampCropState(next, dimensions.width, dimensions.height, CARD_WIDTH, PHOTO_HEIGHT)
    : createCenteredCropState();
  renderPreview();
  syncPhotoControls();
  showNavigator();
  persistDraftMetadata();
}

function openPhotoPicker(): void {
  photoInput.click();
}

photoPicker.addEventListener('click', openPhotoPicker);
replacePhotoButton.addEventListener('click', openPhotoPicker);

photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0];
  if (!file) {
    return;
  }
  if (!isSupportedImageFile(file)) {
    photoInput.value = '';
    setMainStatus('');
    return;
  }

  const loadGeneration = ++photoLoadGeneration;
  const photoRevision = ++photoMutationRevision;
  draftPersistenceDisabled = false;
  photoSaveFailedGeneration = null;
  releaseObjectUrl();
  cropState = createCenteredCropState();
  draftHasPhoto = false;
  persistDraftMetadata();
  const objectUrl = URL.createObjectURL(file);
  Object.assign(state, beginImageLoad(objectUrl));
  renderPreview();
  syncPhotoControls();
  syncDownloadAvailability();

  void enqueuePhotoMutation(async () => {
    try {
      await draftPhotoStore.put(file);
      if (photoRevision !== photoMutationRevision || loadGeneration !== photoLoadGeneration) {
        return;
      }
      draftHasPhoto = true;
      persistDraftMetadata();
    } catch (error) {
      if (photoRevision !== photoMutationRevision || loadGeneration !== photoLoadGeneration) {
        return;
      }
      console.error('Local draft photo save failed.', error);
      draftHasPhoto = false;
      photoSaveFailedGeneration = loadGeneration;
      persistDraftMetadata();
      setMainStatus('照片暫存失敗，重新整理後需重新選擇照片', true);
    }
  });

  void decodeShareCardImage(file, objectUrl)
    .then((image) => {
      if (loadGeneration !== photoLoadGeneration) {
        releaseImage(image);
        return;
      }
      const nextState = completeImageLoad(state, objectUrl, image);
      if (!nextState) {
        releaseImage(image);
        return;
      }
      Object.assign(state, nextState);
      renderPreview();
      syncPhotoControls();
      syncDownloadAvailability();
      if (photoSaveFailedGeneration !== loadGeneration) {
        setMainStatus('');
      }
      showNavigator();
      persistDraftMetadata();
    })
    .catch((error) => {
      if (loadGeneration !== photoLoadGeneration) {
        return;
      }
      console.error('Local image decode failed.', error);
      const failedImage = state.objectUrl === objectUrl ? state.image : null;
      const nextState = failImageLoad(state, objectUrl);
      if (!nextState) {
        return;
      }
      releaseImage(failedImage);
      if (state.objectUrl === objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      Object.assign(state, nextState);
      const invalidatedRevision = ++photoMutationRevision;
      draftHasPhoto = false;
      persistDraftMetadata();
      void enqueuePhotoMutation(async () => {
        if (invalidatedRevision !== photoMutationRevision) {
          return;
        }
        try {
          await draftPhotoStore.delete();
        } catch (deleteError) {
          console.error('Local draft photo delete failed.', deleteError);
        }
      });
      renderPreview();
      syncPhotoControls();
      syncDownloadAvailability();
      setMainStatus('無法讀取此圖片', true);
    });
  setMainStatus('');
});

function asDraftPhotoFile(blob: Blob): File {
  if (typeof File !== 'undefined' && blob instanceof File) {
    return blob;
  }
  if (typeof File !== 'undefined') {
    return new File([blob], 'placeprint-draft-photo', { type: blob.type || 'image/*' });
  }
  return blob as unknown as File;
}

async function restoreStoredPhoto(): Promise<void> {
  if (!restoredDraftMetadata?.hasPhoto) {
    return;
  }
  const loadGeneration = ++photoLoadGeneration;
  const photoRevision = photoMutationRevision;
  let blob: Blob | null;
  try {
    blob = await draftPhotoStore.get();
  } catch (error) {
    console.error('Local draft photo load failed.', error);
    return;
  }
  if (!blob) {
    if (loadGeneration === photoLoadGeneration && photoRevision === photoMutationRevision) {
      draftHasPhoto = false;
      persistDraftMetadata();
    }
    return;
  }
  if (loadGeneration !== photoLoadGeneration || photoRevision !== photoMutationRevision) {
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const file = asDraftPhotoFile(blob);
  Object.assign(state, beginImageLoad(objectUrl));
  renderPreview();
  syncPhotoControls();
  syncDownloadAvailability();
  try {
    const image = await decodeShareCardImage(file, objectUrl);
    if (loadGeneration !== photoLoadGeneration || photoRevision !== photoMutationRevision) {
      releaseImage(image);
      return;
    }
    const nextState = completeImageLoad(state, objectUrl, image);
    if (!nextState) {
      releaseImage(image);
      return;
    }
    Object.assign(state, nextState);
    const dimensions = imageDimensions();
    if (dimensions) {
      cropState = clampCropState(
        cropState,
        dimensions.width,
        dimensions.height,
        CARD_WIDTH,
        PHOTO_HEIGHT,
      );
    }
    draftHasPhoto = true;
    renderPreview();
    syncPhotoControls();
    syncDownloadAvailability();
    showNavigator();
    persistDraftMetadata();
  } catch (error) {
    if (loadGeneration !== photoLoadGeneration || photoRevision !== photoMutationRevision) {
      return;
    }
    console.error('Restored local image decode failed.', error);
    if (state.objectUrl === objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    Object.assign(state, { image: null, objectUrl: null, loading: false });
    draftHasPhoto = false;
    persistDraftMetadata();
    renderPreview();
    syncPhotoControls();
    syncDownloadAvailability();
    setMainStatus('無法讀取此圖片', true);
  }
}

function cancelEditorRevealScroll(): void {
  if (editorRevealScrollFrame !== null) {
    window.cancelAnimationFrame(editorRevealScrollFrame);
    editorRevealScrollFrame = null;
  }
}

function easeInOutEditorScroll(progress: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * progress);
}

function getEditorRevealScrollTarget(): number {
  const editorTop = editorPanel.getBoundingClientRect().top + window.scrollY;
  const documentHeight = Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
  );
  const maxScrollY = Math.max(0, documentHeight - window.innerHeight);
  return Math.min(Math.max(editorTop, 0), maxScrollY);
}

function scrollEditorIntoViewOnMobile(): void {
  cancelEditorRevealScroll();
  if (editorPanel.hidden || window.matchMedia(DESKTOP_EDITOR_MEDIA_QUERY).matches) {
    return;
  }

  const startScrollY = window.scrollY;
  const targetScrollY = getEditorRevealScrollTarget();
  if (window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches) {
    window.scrollTo(0, targetScrollY);
    return;
  }

  let animationStartTime: number | null = null;
  const animateScroll = (timestamp: number): void => {
    if (editorPanel.hidden || window.matchMedia(DESKTOP_EDITOR_MEDIA_QUERY).matches) {
      editorRevealScrollFrame = null;
      return;
    }
    if (animationStartTime === null) {
      animationStartTime = timestamp;
    }
    const elapsed = timestamp - animationStartTime;
    const progress = Math.min(elapsed / EDITOR_REVEAL_SCROLL_DURATION_MS, 1);
    const easedProgress = easeInOutEditorScroll(progress);
    const documentHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    const maxScrollY = Math.max(0, documentHeight - window.innerHeight);
    const nextScrollY = Math.min(
      Math.max(startScrollY + (targetScrollY - startScrollY) * easedProgress, 0),
      maxScrollY,
    );
    window.scrollTo(0, nextScrollY);
    if (progress >= 1) {
      editorRevealScrollFrame = null;
      return;
    }
    editorRevealScrollFrame = window.requestAnimationFrame(animateScroll);
  };

  editorRevealScrollFrame = window.requestAnimationFrame(animateScroll);
}

function setEditorExpanded(
  expanded: boolean,
  focusTarget?: HTMLElement | null,
  shouldFocus = true,
): void {
  cancelEditorRevealScroll();
  editorPanel.hidden = !expanded;
  workspace.dataset.editorOpen = String(expanded);
  infoHotspot.setAttribute('aria-expanded', String(expanded));
  if (expanded && shouldFocus) {
    const target = focusTarget ?? editorFocusTarget;
    window.setTimeout(() => target.focus({ preventScroll: true }), 0);
  } else if (document.activeElement instanceof HTMLElement && editorPanel.contains(document.activeElement)) {
    infoHotspot.focus();
  }
}

infoHotspot.addEventListener('click', () => {
  const expanded = infoHotspot.getAttribute('aria-expanded') === 'true';
  if (!expanded && !placeEditor.read().valid) {
    placeEditor.validate();
    return;
  }
  setEditorExpanded(!expanded);
  if (!expanded) {
    window.setTimeout(scrollEditorIntoViewOnMobile, 0);
  }
});

closeEditorButton.addEventListener('click', () => {
  setEditorExpanded(false);
});

function expandEditorForInvalidField(field: HTMLElement): void {
  setEditorExpanded(true, field);
  window.setTimeout(() => {
    field.closest<HTMLElement>('.field-group')?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
    });
    field.focus();
    if ('reportValidity' in field && typeof field.reportValidity === 'function') {
      field.reportValidity();
    }
  });
}

const placeEditor = mountPlaceEditor({
  root: document,
  initialDraft: restoredDraftMetadata?.editor,
  resolvePlace(sourceUrl) {
    const fetcher = window.fetch.bind(window);
    return resolvePlaceFromInput(sourceUrl, {
      calibration: calibrationLoader.getActive(),
      fetcher,
      redirectFetcher: fetcher,
      language: navigator.language,
    });
  },
  onNotice(notice: PlaceEditorNotice): void {
    draftPersistenceDisabled = false;
    persistDraftMetadata();
    if (notice.type === 'lookup-start') {
      cancelManualPreviewAnimation();
      startInfoLookupReveal();
      return;
    }
    if (notice.type === 'change') {
      if (notice.source === 'manual') {
        const previousSnapshot = lastPlaceEditorSnapshot;
        clearInfoReveal();
        const currentPlan = renderPreview(notice.snapshot);
        syncDownloadAvailability(notice.snapshot);
        const animationOptions = createManualPreviewOptions(
          notice,
          previousSnapshot,
          currentPlan,
        );
        if (animationOptions) {
          startManualPreviewAnimation(notice.snapshot, animationOptions);
        }
      } else {
        cancelManualPreviewAnimation();
        if (notice.source === 'lookup-failure') {
          clearInfoReveal();
        }
        renderPreview(notice.snapshot);
        syncDownloadAvailability(notice.snapshot);
        if (notice.source === 'lookup-success') {
          finishInfoReveal();
        }
      }
      if (notice.snapshot.valid && visibleStatusSource === 'validation') {
        setMainStatus('');
      }
      return;
    }
    if (notice.type === 'status') {
      const source = nextPlaceStatusSource ?? 'non-validation';
      setStatus(notice.message, notice.error, source);
      nextPlaceStatusSource = null;
      return;
    }
    nextPlaceStatusSource = 'validation';
    expandEditorForInvalidField(notice.field);
  },
});

window.addEventListener('pageshow', (event: PageTransitionEvent) => {
  if (event.persisted) {
    return;
  }
  const metadata = loadDraftMetadata(draftStorage);
  const snapshot = placeEditor.restore(metadata?.editor ?? null);
  lastPlaceEditorSnapshot = snapshot;
  renderPreview(snapshot);
  syncDownloadAvailability(snapshot);
});

function moveCropByCanvasDelta(deltaX: number, deltaY: number): void {
  const dimensions = imageDimensions();
  if (!dimensions) {
    return;
  }
  updateCrop(
    panCropByCanvasDelta(
      cropState,
      deltaX,
      deltaY,
      dimensions.width,
      dimensions.height,
      CARD_WIDTH,
      PHOTO_HEIGHT,
    ),
  );
}

photoPanTarget.addEventListener('wheel', (event) => {
  if (!state.image || state.loading) {
    return;
  }
  event.preventDefault();
  const zoomFactor = Math.exp(-(Number.isFinite(event.deltaY) ? event.deltaY : 0) * 0.002);
  updateCrop({
    ...cropState,
    zoom: cropState.zoom * zoomFactor,
  });
}, { passive: false });

function finishPointer(pointerId: number): void {
  if (!gestureState.pointers.some((pointer) => pointer.pointerId === pointerId)) {
    return;
  }
  gestureState = endGesturePointer(gestureState, pointerId);
  photoPanTarget.dataset.dragging = String(gestureState.pointers.length > 0);
  if (gestureState.pointers.length === 0) {
    scheduleNavigatorHide();
  }
}

photoPanTarget.addEventListener('pointerdown', (event) => {
  if (!state.image || state.loading) {
    return;
  }
  gestureState = beginGesturePointer(gestureState, {
    pointerId: event.pointerId,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
  });
  try {
    photoPanTarget.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is best effort; cancel/lost events still clear state.
  }
  photoPanTarget.dataset.dragging = 'true';
  showNavigator();
  event.preventDefault();
});

photoPanTarget.addEventListener('pointermove', (event) => {
  if (!state.image || !gestureState.pointers.some((pointer) => pointer.pointerId === event.pointerId)) {
    return;
  }
  const previous = gestureState;
  const next = updateGesturePointer(
    previous,
    event.pointerId,
    event.clientX,
    event.clientY,
  );
  if (previous.mode === 'pinch' && next.mode === 'pinch' && previous.pinch && next.pinch) {
    const ratio = previous.pinch.distance > 0
      ? next.pinch.distance / previous.pinch.distance
      : 1;
    if (Number.isFinite(ratio) && ratio > 0) {
      updateCrop({
        ...cropState,
        zoom: cropState.zoom * ratio,
      });
    }
  } else if (previous.mode === 'pan' && next.mode === 'pan') {
    const pointer = previous.pointers.find((item) => item.pointerId === event.pointerId);
    const rect = previewCanvas.getBoundingClientRect();
    if (pointer && rect.width > 0 && rect.height > 0) {
      const delta = mapPointerDeltaToCanvas(
        event.clientX - pointer.lastClientX,
        event.clientY - pointer.lastClientY,
        rect.width,
        rect.height,
        CARD_WIDTH,
        CARD_HEIGHT,
      );
      moveCropByCanvasDelta(delta.x, delta.y);
    }
  }
  gestureState = next;
  photoPanTarget.dataset.dragging = 'true';
  showNavigator();
  event.preventDefault();
});

photoPanTarget.addEventListener('pointerup', (event) => {
  finishPointer(event.pointerId);
  if (photoPanTarget.hasPointerCapture(event.pointerId)) {
    photoPanTarget.releasePointerCapture(event.pointerId);
  }
});
photoPanTarget.addEventListener('pointercancel', (event) => {
  finishPointer(event.pointerId);
});
photoPanTarget.addEventListener('lostpointercapture', (event) => {
  finishPointer(event.pointerId);
});

photoPanTarget.addEventListener('keydown', (event) => {
  if (!state.image || state.loading) {
    return;
  }
  if (event.key === '+' || event.key === '=') {
    updateCrop({
      ...cropState,
      zoom: cropState.zoom * KEYBOARD_ZOOM_FACTOR,
    });
    event.preventDefault();
    return;
  }
  if (event.key === '-' || event.key === '_') {
    updateCrop({
      ...cropState,
      zoom: cropState.zoom / KEYBOARD_ZOOM_FACTOR,
    });
    event.preventDefault();
    return;
  }
  const step = event.shiftKey ? 96 : 32;
  const deltas: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const delta = deltas[event.key];
  if (!delta) {
    return;
  }
  moveCropByCanvasDelta(delta[0], delta[1]);
  event.preventDefault();
});

downloadButton.addEventListener('click', async () => {
  if (!placeEditor.validate()) {
    return;
  }
  if (!canDownload(state)) {
    syncDownloadAvailability();
    setMainStatus('照片處理中，請稍候…');
    return;
  }

  exportGeneration = beginExportGeneration(exportGeneration);
  const exportToken = exportGeneration;
  const isCurrentExport = (): boolean =>
    isCurrentExportGeneration(exportGeneration, exportToken);

  clearManualExportFallback();
  downloadButton.disabled = true;
  setMainStatus('正在生成卡片圖片…');
  const previewWindow = isIosSafari(navigator)
    ? preparePngPreview()
    : null;
  trackExportPreviewWindow(previewWindow, exportToken);
  try {
    // Re-render through the same Canvas path used by the live preview.
    renderPreview();
    const blob = await new Promise<Blob>((resolve, reject) => {
      previewCanvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('PNG export returned no data.'));
        }
      }, 'image/png');
    });
    if (!isCurrentExport()) {
      closeExportPreview(previewWindow, exportToken);
      return;
    }

    const exportResult = openPngBlob(
      blob,
      'share-card.png',
      createBrowserExportEnvironment(previewWindow),
    );
    if (!isCurrentExport()) {
      if (exportResult.mode !== 'download') {
        exportResult.cleanup();
      }
      closeExportPreview(previewWindow, exportToken);
      return;
    }
    if (exportResult.mode === 'manual') {
      if (!isCurrentExport()) {
        exportResult.cleanup();
        closeExportPreview(previewWindow, exportToken);
        return;
      }
      showManualExportFallback(exportResult);
      if (!isCurrentExport()) {
        exportResult.cleanup();
        closeExportPreview(previewWindow, exportToken);
        return;
      }
      setMainStatus('');
    } else {
      if (!isCurrentExport()) {
        if (exportResult.mode !== 'download') {
          exportResult.cleanup();
        }
        closeExportPreview(previewWindow, exportToken);
        return;
      }
      keepExportUrl(exportResult);
      if (!isCurrentExport()) {
        closeExportPreview(previewWindow, exportToken);
        return;
      }
      setMainStatus('');
    }
  } catch (error) {
    if (!isCurrentExport()) {
      closeExportPreview(previewWindow, exportToken);
      return;
    }
    closeExportPreview(previewWindow, exportToken);
    console.error(error);
    setMainStatus('輸出失敗，請重新嘗試', true);
  } finally {
    clearExportPreviewReference(previewWindow, exportToken);
    if (isCurrentExport()) {
      syncDownloadAvailability();
    }
  }
});

async function clearAllDraftData(): Promise<void> {
  exportGeneration = invalidateExportGeneration(exportGeneration);
  closePendingExportPreviews();
  draftPersistenceDisabled = true;
  photoLoadGeneration += 1;
  photoMutationRevision += 1;
  clearDraftMetadata(draftStorage);

  const deleteRevision = photoMutationRevision;
  const deletePromise = enqueuePhotoMutation(async () => {
    try {
      await draftPhotoStore.delete();
    } catch (error) {
      console.error('Local draft photo delete failed.', error);
    }
    if (deleteRevision === photoMutationRevision) {
      draftHasPhoto = false;
    }
  });

  cancelManualPreviewAnimation();
  cancelInfoRevealFrame();
  cancelEditorRevealScroll();
  clearInfoReveal();
  clearManualExportFallback();
  hideNavigator();
  lastPlaceEditorSnapshot = null;
  placeEditor.reset();
  releaseObjectUrl();
  Object.assign(state, { image: null, objectUrl: null, loading: false });
  cropState = createCenteredCropState();
  draftHasPhoto = false;
  photoInput.value = '';
  setMainStatus('');
  renderPreview();
  syncPhotoControls();
  syncDownloadAvailability();

  await deletePromise;
}

clearDataButton.addEventListener('click', () => {
  if (!window.confirm('確定要清空所有資料嗎？')) {
    return;
  }
  void clearAllDraftData();
});

const persistOnLifecycle = (): void => {
  persistDraftMetadata();
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    persistOnLifecycle();
  }
});
window.addEventListener('pagehide', persistOnLifecycle);

previewActions.dataset.themePickerVisible = String(ACTIVE_THEME_OPTIONS.length > 1);
const themePicker = mountThemePicker({
  window,
  wrapper: themePickerWrapper,
  trigger: themePickerTrigger,
  panel: themePickerPanel,
  options: ACTIVE_THEME_OPTIONS,
  selectedId: () => selectedThemeId,
  onSelect: selectTheme,
});
window.addEventListener('pagehide', () => {
  themePicker.destroy();
  themeTransition.destroy();
}, { once: true });

setEditorExpanded(window.matchMedia(DESKTOP_EDITOR_MEDIA_QUERY).matches, null, false);
syncPhotoControls();
renderPreview();
syncDownloadAvailability();
void restoreStoredPhoto();
