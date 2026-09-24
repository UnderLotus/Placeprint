import { InvalidHttpUrlError } from './maps-url';
import {
  clampPlaceFormValues,
  EMPTY_PLACE_FORM_VALUES,
  PLACE_FIELD_LIMITS,
  placeInfoToFormValues,
  type PlaceFormValues,
} from './place-form';
import {
  createHoursOptions,
  getDefaultHoursOption,
  getHoursText,
  type HoursOption,
  type HoursOptionValue,
} from './business-hours';
import { createQrCodeResult } from './qr-code';
import { setInputValueClamped } from './text-limit';
import type { PlaceInfo } from './place-info';

export interface PlaceEditorContent {
  placeInfo: PlaceInfo;
  hoursText: string;
  qrCode: string;
  socialId: string;
}

/** Raw form state persisted in the local draft. Keep input strings intact. */
export interface PlaceEditorDraft {
  sourceUrl: string;
  originalName: string;
  rating: string;
  reviewCount: string;
  address: string;
  category: string;
  priceText: string;
  weeklyHours?: PlaceInfo['weeklyHours'];
  selectedHoursOption: HoursOptionValue;
  customHoursText: string;
  socialId: string;
  qrCode: string;
  qrCodeOverridden: boolean;
}

export interface PlaceEditorSnapshot {
  readonly content: PlaceEditorContent;
  readonly valid: boolean;
}

export type PlaceEditorChangeSource = 'manual' | 'lookup-success' | 'lookup-failure';

export type PlaceEditorChangeTarget =
  | 'maps-url'
  | 'store-name'
  | 'rating'
  | 'review-count'
  | 'address'
  | 'category'
  | 'price-text'
  | 'social-id'
  | 'qr-code'
  | 'hours-select'
  | 'custom-hours';

export type PlaceEditorControl = HTMLInputElement | HTMLSelectElement;

export type PlaceEditorNotice =
  | { type: 'lookup-start' }
  | {
      type: 'change';
      source: 'manual';
      target: PlaceEditorChangeTarget;
      control: PlaceEditorControl;
      previousValue: string;
      value: string;
      snapshot: PlaceEditorSnapshot;
    }
  | {
      type: 'change';
      source: 'lookup-success' | 'lookup-failure';
      target: 'lookup';
      control: null;
      snapshot: PlaceEditorSnapshot;
    }
  | { type: 'status'; message: string; error: boolean }
  | { type: 'invalid'; field: HTMLElement };

export interface PlaceEditor {
  read(): PlaceEditorSnapshot;
  readDraft(): PlaceEditorDraft;
  validate(): boolean;
  restore(draft: PlaceEditorDraft | null): PlaceEditorSnapshot;
  reset(): PlaceEditorSnapshot;
  dispose(): void;
}

export interface MountPlaceEditorOptions {
  root?: ParentNode;
  initialDraft?: PlaceEditorDraft;
  resolvePlace(sourceUrl: string): Promise<PlaceInfo>;
  onNotice(notice: PlaceEditorNotice): void;
}

type EditorControl = PlaceEditorControl;

type ListenerCleanup = () => void;

interface EditorElements {
  urlInput: HTMLInputElement;
  mapsUrlError: HTMLParagraphElement;
  fetchPlaceButton: HTMLButtonElement;
  storeNameInput: HTMLInputElement;
  ratingInput: HTMLInputElement;
  ratingError: HTMLParagraphElement;
  reviewCountInput: HTMLInputElement;
  reviewCountError: HTMLParagraphElement;
  addressInput: HTMLInputElement;
  categoryInput: HTMLInputElement;
  priceInput: HTMLInputElement;
  socialIdInput: HTMLInputElement;
  qrCodeInput: HTMLInputElement;
  qrCodeError: HTMLParagraphElement;
  hoursSelect: HTMLSelectElement;
  customHoursInput: HTMLInputElement;
  editorForm: HTMLFormElement;
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required place editor element: ${selector}`);
  }
  return element;
}

function collectElements(root: ParentNode): EditorElements {
  return {
    urlInput: requireElement<HTMLInputElement>(root, '#maps-url'),
    mapsUrlError: requireElement<HTMLParagraphElement>(root, '#maps-url-error'),
    fetchPlaceButton: requireElement<HTMLButtonElement>(root, '#fetch-place-button'),
    storeNameInput: requireElement<HTMLInputElement>(root, '#store-name'),
    ratingInput: requireElement<HTMLInputElement>(root, '#rating'),
    ratingError: requireElement<HTMLParagraphElement>(root, '#rating-error'),
    reviewCountInput: requireElement<HTMLInputElement>(root, '#review-count'),
    reviewCountError: requireElement<HTMLParagraphElement>(root, '#review-count-error'),
    addressInput: requireElement<HTMLInputElement>(root, '#address'),
    categoryInput: requireElement<HTMLInputElement>(root, '#category'),
    priceInput: requireElement<HTMLInputElement>(root, '#price-text'),
    socialIdInput: requireElement<HTMLInputElement>(root, '#social-id'),
    qrCodeInput: requireElement<HTMLInputElement>(root, '#qr-code'),
    qrCodeError: requireElement<HTMLParagraphElement>(root, '#qr-code-error'),
    hoursSelect: requireElement<HTMLSelectElement>(root, '#hours-select'),
    customHoursInput: requireElement<HTMLInputElement>(root, '#custom-hours'),
    editorForm: requireElement<HTMLFormElement>(root, '#editor-form'),
  };
}

function ownerDocument(root: ParentNode): Document {
  if ('ownerDocument' in root && root.ownerDocument) {
    return root.ownerDocument;
  }
  return root as Document;
}

function cloneWeeklyHours(
  weeklyHours: PlaceInfo['weeklyHours'],
): PlaceInfo['weeklyHours'] {
  return weeklyHours && Object.keys(weeklyHours).length > 0
    ? { ...weeklyHours }
    : undefined;
}

function setLookupErrorState(
  error: HTMLParagraphElement,
  message: string,
): void {
  error.textContent = message;
  error.hidden = !message;
}

function setErrorState(
  error: HTMLParagraphElement,
  valid: boolean,
  message: string,
): void {
  error.textContent = valid ? '' : message;
  error.hidden = valid;
}

const GENERIC_FIELD_ERROR = '欄位格式不正確';

function hasDecimalPart(raw: string): boolean {
  return raw.includes('.');
}

function hasMoreThanOneDecimalPlace(raw: string): boolean {
  const match = raw.match(/^[+-]?(?:\d+)?\.(\d+)/);
  return Boolean(match && match[1].length > 1);
}

function isRatingStepAligned(value: number): boolean {
  const scaled = value * 10;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-9;
}

function hasTooLongValue(input: HTMLInputElement): boolean {
  return input.maxLength >= 0 && input.value.length > input.maxLength;
}

function mapNativeValidity(input: HTMLInputElement): string {
  const validity = input.validity;
  if (validity.valueMissing) {
    return '此欄位為必填';
  }
  if (validity.badInput || validity.typeMismatch || validity.patternMismatch) {
    return GENERIC_FIELD_ERROR;
  }
  if (validity.tooLong || hasTooLongValue(input)) {
    return input.maxLength >= 0
      ? `此欄位最多 ${input.maxLength} 個字元`
      : GENERIC_FIELD_ERROR;
  }
  if (validity.tooShort) {
    return GENERIC_FIELD_ERROR;
  }
  return '';
}

function mapNumberValidity(
  input: HTMLInputElement,
  kind: 'rating' | 'review-count',
): string {
  const raw = input.value.trim();
  const parsed = Number(raw);
  const validity = input.validity;
  const isEmpty = !raw && !validity.badInput;

  if (validity.badInput || (!isEmpty && !Number.isFinite(parsed))) {
    return kind === 'rating' ? '評分請輸入數字' : '評價數請輸入數字';
  }
  if (isEmpty) {
    return mapNativeValidity(input);
  }

  if (kind === 'rating' && hasMoreThanOneDecimalPlace(raw)) {
    return '數字僅接受到小數點第一位';
  }

  const inRange = kind === 'rating'
    ? parsed >= 0 && parsed <= 5
    : parsed >= 0 && parsed <= PLACE_FIELD_LIMITS.reviewCount;
  if (
    validity.rangeUnderflow ||
    validity.rangeOverflow ||
    !inRange
  ) {
    return kind === 'rating'
      ? '評分請輸入 0～5 的數字'
      : '評價數請輸入 0～999999999 的整數';
  }

  if (
    kind === 'rating'
      ? !isRatingStepAligned(parsed)
      : validity.stepMismatch || hasDecimalPart(raw)
  ) {
    return kind === 'rating'
      ? '數字僅接受到小數點第一位'
      : '評價數僅接受整數';
  }

  return mapNativeValidity(input);
}

function syncNumberValidity(
  input: HTMLInputElement,
  error: HTMLParagraphElement,
  kind: 'rating' | 'review-count',
): void {
  const message = mapNumberValidity(input, kind);
  input.setCustomValidity(message);
  setErrorState(error, !message, message);
}

function syncTextValidity(input: HTMLInputElement): void {
  const message = mapNativeValidity(input);
  input.setCustomValidity(message);
}

function syncQrCodeValidity(
  input: HTMLInputElement,
  error: HTMLParagraphElement,
): void {
  const result = createQrCodeResult(input.value);
  const message = result.error ?? mapNativeValidity(input);
  input.setCustomValidity(message);
  setErrorState(error, !message, message);
}

function findFirstInvalidField(elements: EditorElements): HTMLElement | null {
  const controls: EditorControl[] = [
    elements.urlInput,
    elements.storeNameInput,
    elements.ratingInput,
    elements.reviewCountInput,
    elements.categoryInput,
    elements.priceInput,
    elements.hoursSelect,
    elements.customHoursInput,
    elements.addressInput,
    elements.socialIdInput,
    elements.qrCodeInput,
  ];
  return controls.find((control) => !control.checkValidity()) ?? null;
}

export function mountPlaceEditor(options: MountPlaceEditorOptions): PlaceEditor {
  const root = options.root ?? document;
  // Resolve every required node before installing any listener. A malformed
  // production fixture therefore fails atomically instead of leaking handlers.
  const elements = collectElements(root);
  const documentRef = ownerDocument(root);
  const cleanups: ListenerCleanup[] = [];

  let disposed = false;
  let generation = 0;
  let requestInFlight = false;
  let weeklyHours: PlaceInfo['weeklyHours'];
  let hoursOptions: HoursOption[] = createHoursOptions();
  let selectedHoursOption: HoursOptionValue = getDefaultHoursOption(hoursOptions);
  let customHoursText = '';
  let qrCodeValue = '';
  let qrCodeOverridden = false;
  const controlValues = new Map<EditorControl, string>();

  const emit = (notice: PlaceEditorNotice): void => {
    if (!disposed) {
      options.onNotice(notice);
    }
  };

  const syncControlValues = (): void => {
    for (const control of [
      elements.urlInput,
      elements.storeNameInput,
      elements.ratingInput,
      elements.reviewCountInput,
      elements.addressInput,
      elements.categoryInput,
      elements.priceInput,
      elements.socialIdInput,
      elements.qrCodeInput,
      elements.hoursSelect,
      elements.customHoursInput,
    ]) {
      controlValues.set(control, control.value);
    }
  };

  const clearMapsUrlError = (): void => {
    setLookupErrorState(elements.mapsUrlError, '');
  };

  const syncFieldValidity = (): void => {
    syncTextValidity(elements.urlInput);
    syncNumberValidity(elements.ratingInput, elements.ratingError, 'rating');
    syncNumberValidity(elements.reviewCountInput, elements.reviewCountError, 'review-count');
    syncTextValidity(elements.categoryInput);
    syncTextValidity(elements.priceInput);
    syncTextValidity(elements.customHoursInput);
    syncTextValidity(elements.socialIdInput);
    syncQrCodeValidity(elements.qrCodeInput, elements.qrCodeError);
  };

  const syncHoursControls = (): void => {
    elements.hoursSelect.replaceChildren(
      ...hoursOptions.map((option) => {
        const element = documentRef.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        return element;
      }),
    );
    elements.hoursSelect.value = selectedHoursOption;
    elements.customHoursInput.value = customHoursText;
    elements.customHoursInput.hidden = selectedHoursOption !== 'custom';
  };

  const setHoursEditor = (nextWeeklyHours: PlaceInfo['weeklyHours']): void => {
    weeklyHours = cloneWeeklyHours(nextWeeklyHours);
    hoursOptions = createHoursOptions(weeklyHours);
    selectedHoursOption = getDefaultHoursOption(hoursOptions);
    customHoursText = '';
    syncHoursControls();
  };

  const selectedHoursText = (): string =>
    getHoursText(hoursOptions, selectedHoursOption, customHoursText);

  const readPlaceInfo = (): PlaceInfo => {
    const place: PlaceInfo = {
      sourceUrl: elements.urlInput.value.trim(),
      originalName: elements.storeNameInput.value,
    };
    const rating = elements.ratingInput.value.trim();
    const reviewCount = elements.reviewCountInput.value.trim();
    if (rating) {
      const parsed = Number(rating);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 5) {
        place.rating = Math.round(parsed * 10) / 10;
      }
    }
    if (reviewCount) {
      const parsed = Number(reviewCount);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= PLACE_FIELD_LIMITS.reviewCount) {
        place.reviewCount = parsed;
      }
    }

    const address = elements.addressInput.value.trim();
    const category = elements.categoryInput.value.trim();
    const priceText = elements.priceInput.value.trim();
    if (address) {
      place.address = address;
    }
    if (category) {
      place.category = category;
    }
    if (priceText) {
      place.priceText = priceText;
    }
    const clonedHours = cloneWeeklyHours(weeklyHours);
    if (clonedHours) {
      place.weeklyHours = clonedHours;
    }
    return place;
  };

  const read = (): PlaceEditorSnapshot => {
    syncFieldValidity();
    const content: PlaceEditorContent = {
      placeInfo: readPlaceInfo(),
      hoursText: selectedHoursText(),
      qrCode: qrCodeValue,
      socialId: elements.socialIdInput.value,
    };
    return {
      content,
      valid: elements.editorForm.checkValidity(),
    };
  };

  const readDraft = (): PlaceEditorDraft => ({
    sourceUrl: elements.urlInput.value,
    originalName: elements.storeNameInput.value,
    rating: elements.ratingInput.value,
    reviewCount: elements.reviewCountInput.value,
    address: elements.addressInput.value,
    category: elements.categoryInput.value,
    priceText: elements.priceInput.value,
    weeklyHours: cloneWeeklyHours(weeklyHours),
    selectedHoursOption,
    customHoursText,
    socialId: elements.socialIdInput.value,
    qrCode: qrCodeValue,
    qrCodeOverridden,
  });

  const notifyLookupChange = (source: 'lookup-success' | 'lookup-failure'): void => {
    emit({
      type: 'change',
      source,
      target: 'lookup',
      control: null,
      snapshot: read(),
    });
  };

  const notifyManualChange = (
    target: PlaceEditorChangeTarget,
    control: EditorControl,
  ): void => {
    const value = control.value;
    const previousValue = controlValues.get(control) ?? '';
    controlValues.set(control, value);
    emit({
      type: 'change',
      source: 'manual',
      target,
      control,
      previousValue,
      value,
      snapshot: read(),
    });
  };

  const invalidatePlaceRequest = (): void => {
    generation += 1;
    if (requestInFlight) {
      requestInFlight = false;
      elements.fetchPlaceButton.disabled = false;
    }
  };

  const applyDraft = (draft: PlaceEditorDraft): void => {
    elements.urlInput.value = draft.sourceUrl;
    elements.storeNameInput.value = draft.originalName;
    elements.ratingInput.value = draft.rating;
    elements.reviewCountInput.value = draft.reviewCount;
    elements.addressInput.value = draft.address;
    elements.categoryInput.value = draft.category;
    elements.priceInput.value = draft.priceText;
    elements.socialIdInput.value = draft.socialId;
    qrCodeValue = draft.qrCode;
    qrCodeOverridden = draft.qrCodeOverridden;
    elements.qrCodeInput.value = qrCodeValue;
    weeklyHours = cloneWeeklyHours(draft.weeklyHours);
    hoursOptions = createHoursOptions(weeklyHours);
    selectedHoursOption = hoursOptions.some((option) => option.value === draft.selectedHoursOption)
      ? draft.selectedHoursOption
      : getDefaultHoursOption(hoursOptions);
    customHoursText = draft.customHoursText;
    syncHoursControls();
    syncFieldValidity();
    syncControlValues();
  };

  const restore = (draft: PlaceEditorDraft | null): PlaceEditorSnapshot => {
    invalidatePlaceRequest();
    clearMapsUrlError();
    if (draft) {
      applyDraft(draft);
    } else {
      elements.urlInput.value = '';
      elements.storeNameInput.value = '';
      elements.ratingInput.value = '';
      elements.reviewCountInput.value = '';
      elements.addressInput.value = '';
      elements.categoryInput.value = '';
      elements.priceInput.value = '';
      elements.socialIdInput.value = '';
      elements.qrCodeInput.value = '';
      weeklyHours = undefined;
      hoursOptions = createHoursOptions();
      selectedHoursOption = getDefaultHoursOption(hoursOptions);
      customHoursText = '';
      qrCodeValue = '';
      qrCodeOverridden = false;
      syncHoursControls();
      syncFieldValidity();
      syncControlValues();
    }
    return read();
  };

  const reset = (): PlaceEditorSnapshot => restore(null);

  const isCurrentRequest = (token: { generation: number; sourceUrl: string }): boolean =>
    !disposed &&
    token.generation === generation &&
    elements.urlInput.value === token.sourceUrl;

  const applyPlaceFormValues = (values: PlaceFormValues): void => {
    const bounded = clampPlaceFormValues(values);
    elements.storeNameInput.value = bounded.storeName;
    elements.ratingInput.value = bounded.rating;
    elements.reviewCountInput.value = bounded.reviewCount;
    elements.addressInput.value = bounded.address;
    setInputValueClamped(
      elements.categoryInput,
      bounded.category,
      elements.categoryInput.maxLength,
    );
    setInputValueClamped(
      elements.priceInput,
      bounded.priceText,
      elements.priceInput.maxLength,
    );
    syncFieldValidity();
  };

  const syncAutomaticQrCode = (): void => {
    if (qrCodeOverridden && elements.qrCodeInput.value.trim() !== '') {
      return;
    }
    qrCodeOverridden = false;
    qrCodeValue = elements.urlInput.value;
    elements.qrCodeInput.value = qrCodeValue;
    controlValues.set(elements.qrCodeInput, qrCodeValue);
    syncFieldValidity();
  };

  const lookup = async (requestUrl: string): Promise<void> => {
    const token = { generation: ++generation, sourceUrl: requestUrl };
    clearMapsUrlError();
    syncAutomaticQrCode();
    requestInFlight = true;
    elements.fetchPlaceButton.disabled = true;
    let resolvedPlace: PlaceInfo | undefined;
    let lookupError: unknown;
    try {
      // Keep notice delivery outside the resolver catch so renderer/caller
      // exceptions remain programming errors rather than lookup failures.
      emit({ type: 'lookup-start' });
      emit({ type: 'status', message: '', error: false });
      try {
        resolvedPlace = await options.resolvePlace(requestUrl);
        if (!isCurrentRequest(token)) {
          return;
        }
        applyPlaceFormValues(placeInfoToFormValues(resolvedPlace));
        setHoursEditor(resolvedPlace.weeklyHours);
        syncControlValues();
      } catch (error) {
        lookupError = error;
      }

      if (!isCurrentRequest(token)) {
        return;
      }

      if (lookupError !== undefined || !resolvedPlace) {
        console.error('Place lookup failed.', lookupError);
        applyPlaceFormValues(EMPTY_PLACE_FORM_VALUES);
        setHoursEditor(undefined);
        syncControlValues();
        setLookupErrorState(
          elements.mapsUrlError,
          lookupError instanceof InvalidHttpUrlError
            ? '請輸入Google Map網址'
            : '無法取得店家資料，請重試或手動填寫',
        );
        notifyLookupChange('lookup-failure');
      } else {
        clearMapsUrlError();
        notifyLookupChange('lookup-success');
        emit({ type: 'status', message: '', error: false });
      }
    } finally {
      if (isCurrentRequest(token)) {
        requestInFlight = false;
        elements.fetchPlaceButton.disabled = false;
      }
    }
  };

  const onUrlInput = (): void => {
    clearMapsUrlError();
    invalidatePlaceRequest();
    syncFieldValidity();
    notifyManualChange('maps-url', elements.urlInput);
  };

  const onFetchPlaceClick = (): void => {
    if (requestInFlight || disposed) {
      return;
    }
    void lookup(elements.urlInput.value);
  };

  const onGeneralPlaceInput = (control: EditorControl, target: PlaceEditorChangeTarget): void => {
    invalidatePlaceRequest();
    syncFieldValidity();
    notifyManualChange(target, control);
  };

  const onQrInput = (): void => {
    qrCodeOverridden = elements.qrCodeInput.value.trim() !== '';
    qrCodeValue = elements.qrCodeInput.value;
    syncFieldValidity();
    notifyManualChange('qr-code', elements.qrCodeInput);
  };

  const onHoursChange = (): void => {
    invalidatePlaceRequest();
    selectedHoursOption = elements.hoursSelect.value as HoursOptionValue;
    syncHoursControls();
    controlValues.set(elements.customHoursInput, elements.customHoursInput.value);
    notifyManualChange('hours-select', elements.hoursSelect);
  };

  const onCustomHoursInput = (): void => {
    invalidatePlaceRequest();
    customHoursText = elements.customHoursInput.value;
    notifyManualChange('custom-hours', elements.customHoursInput);
  };

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    validate();
  };

  const validate = (): boolean => {
    syncFieldValidity();
    const valid = elements.editorForm.checkValidity();
    if (!valid && !disposed) {
      const field = findFirstInvalidField(elements);
      if (field) {
        emit({ type: 'invalid', field });
      }
      emit({
        type: 'status',
        message: '部分欄位格式有誤，請修正後再下載',
        error: true,
      });
    }
    return valid;
  };

  const listen = (
    target: EventTarget,
    type: string,
    handler: EventListener,
  ): void => {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };

  restore(options.initialDraft ?? null);

  listen(elements.urlInput, 'input', onUrlInput);
  listen(elements.fetchPlaceButton, 'click', onFetchPlaceClick);
  listen(elements.storeNameInput, 'input', () => onGeneralPlaceInput(elements.storeNameInput, 'store-name'));
  listen(elements.ratingInput, 'input', () => onGeneralPlaceInput(elements.ratingInput, 'rating'));
  listen(elements.reviewCountInput, 'input', () => onGeneralPlaceInput(elements.reviewCountInput, 'review-count'));
  listen(elements.addressInput, 'input', () => onGeneralPlaceInput(elements.addressInput, 'address'));
  listen(elements.categoryInput, 'input', () => onGeneralPlaceInput(elements.categoryInput, 'category'));
  listen(elements.priceInput, 'input', () => onGeneralPlaceInput(elements.priceInput, 'price-text'));
  listen(elements.socialIdInput, 'input', () => onGeneralPlaceInput(elements.socialIdInput, 'social-id'));
  listen(elements.qrCodeInput, 'input', onQrInput);
  listen(elements.hoursSelect, 'change', onHoursChange);
  listen(elements.customHoursInput, 'input', onCustomHoursInput);
  listen(elements.editorForm, 'submit', onSubmit);

  syncFieldValidity();
  syncHoursControls();
  elements.qrCodeInput.value = qrCodeValue;
  syncControlValues();

  return {
    read,
    readDraft,
    validate,
    restore,
    reset,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      generation += 1;
      requestInFlight = false;
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
    },
  };
}
