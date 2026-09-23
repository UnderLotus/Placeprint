import type { CropState } from './photo-crop';
import type { PlaceEditorDraft } from './place-editor';

export const DRAFT_VERSION = 1 as const;
export const DRAFT_STORAGE_KEY = 'placeprint:draft:v1';
export const DRAFT_PHOTO_DB_NAME = 'placeprint-draft-v1';
export const DRAFT_PHOTO_STORE_NAME = 'photo';
const DRAFT_PHOTO_RECORD_KEY = 'current';

export interface DraftMetadata {
  readonly version: typeof DRAFT_VERSION;
  readonly editor: PlaceEditorDraft;
  readonly crop: CropState;
  readonly hasPhoto: boolean;
}

export interface DraftPhotoStore {
  get(): Promise<Blob | null>;
  put(photo: Blob): Promise<void>;
  delete(): Promise<void>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const WEEKDAYS = [
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
  '星期日',
] as const;

function isHoursOptionValue(value: string): boolean {
  return value === 'weekday' || value === 'weekend' || value === 'custom' ||
    WEEKDAYS.some((weekday) => value === `day:${weekday}`);
}

function sanitizeWeeklyHours(value: unknown): PlaceEditorDraft['weeklyHours'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const result: PlaceEditorDraft['weeklyHours'] = {};
  for (const weekday of WEEKDAYS) {
    const raw = source[weekday];
    if (typeof raw === 'string') {
      result[weekday] = raw;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeEditor(value: unknown): PlaceEditorDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const sourceUrl = readString(source.sourceUrl);
  const originalName = readString(source.originalName);
  const rating = readString(source.rating);
  const reviewCount = readString(source.reviewCount);
  const address = readString(source.address);
  const category = readString(source.category);
  const priceText = readString(source.priceText);
  const customHoursText = readString(source.customHoursText);
  const socialId = readString(source.socialId);
  const qrCode = readString(source.qrCode);
  const selectedHoursOption = readString(source.selectedHoursOption);
  if (
    sourceUrl === null ||
    originalName === null ||
    rating === null ||
    reviewCount === null ||
    address === null ||
    category === null ||
    priceText === null ||
    customHoursText === null ||
    socialId === null ||
    qrCode === null ||
    selectedHoursOption === null
  ) {
    return null;
  }
  return {
    sourceUrl,
    originalName,
    rating,
    reviewCount,
    address,
    category,
    priceText,
    weeklyHours: sanitizeWeeklyHours(source.weeklyHours),
    selectedHoursOption: (isHoursOptionValue(selectedHoursOption) ? selectedHoursOption : 'custom') as PlaceEditorDraft['selectedHoursOption'],
    customHoursText,
    socialId,
    qrCode,
    qrCodeOverridden: typeof source.qrCodeOverridden === 'boolean' ? source.qrCodeOverridden : false,
  };
}

export function sanitizeDraftMetadata(value: unknown): DraftMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (source.version !== DRAFT_VERSION || typeof source.hasPhoto !== 'boolean') {
    return null;
  }
  const editor = sanitizeEditor(source.editor);
  if (!editor || !source.crop || typeof source.crop !== 'object' || Array.isArray(source.crop)) {
    return null;
  }
  const crop = source.crop as Record<string, unknown>;
  return {
    version: DRAFT_VERSION,
    editor,
    crop: {
      zoom: clamp(finiteOr(crop.zoom, 1), 1, 3),
      panX: clamp(finiteOr(crop.panX, 0), -1, 1),
      panY: clamp(finiteOr(crop.panY, 0), -1, 1),
    },
    hasPhoto: source.hasPhoto,
  };
}

export function loadDraftMetadata(storage: Storage | null | undefined): DraftMetadata | null {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const metadata = sanitizeDraftMetadata(JSON.parse(raw));
    if (!metadata) {
      try {
        storage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // A storage implementation can fail independently for each operation.
      }
    }
    return metadata;
  } catch {
    return null;
  }
}

export function saveDraftMetadata(
  storage: Storage | null | undefined,
  metadata: DraftMetadata,
): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(metadata));
    return true;
  } catch {
    return false;
  }
}

export function clearDraftMetadata(storage: Storage | null | undefined): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.removeItem(DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function defaultIndexedDb(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DRAFT_PHOTO_DB_NAME, 1);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DRAFT_PHOTO_STORE_NAME)) {
        request.result.createObjectStore(DRAFT_PHOTO_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked.'));
  });
}

export function createDraftPhotoStore(
  factory: IDBFactory | null | undefined = defaultIndexedDb(),
): DraftPhotoStore {
  const unavailable = (): Promise<never> => Promise.reject(new Error('IndexedDB is unavailable.'));
  return {
    async get(): Promise<Blob | null> {
      if (!factory) {
        return unavailable();
      }
      const database = await openDatabase(factory);
      try {
        const transaction = database.transaction(DRAFT_PHOTO_STORE_NAME, 'readonly');
        const request = transaction.objectStore(DRAFT_PHOTO_STORE_NAME).get(DRAFT_PHOTO_RECORD_KEY);
        const [value] = await Promise.all([requestResult(request), transactionResult(transaction)]);
        return typeof Blob !== 'undefined' && value instanceof Blob ? value : null;
      } finally {
        database.close();
      }
    },
    async put(photo: Blob): Promise<void> {
      if (!factory) {
        return unavailable();
      }
      const database = await openDatabase(factory);
      try {
        const transaction = database.transaction(DRAFT_PHOTO_STORE_NAME, 'readwrite');
        transaction.objectStore(DRAFT_PHOTO_STORE_NAME).put(photo, DRAFT_PHOTO_RECORD_KEY);
        await transactionResult(transaction);
      } finally {
        database.close();
      }
    },
    async delete(): Promise<void> {
      if (!factory) {
        return unavailable();
      }
      const database = await openDatabase(factory);
      try {
        const transaction = database.transaction(DRAFT_PHOTO_STORE_NAME, 'readwrite');
        transaction.objectStore(DRAFT_PHOTO_STORE_NAME).delete(DRAFT_PHOTO_RECORD_KEY);
        await transactionResult(transaction);
      } finally {
        database.close();
      }
    },
  };
}
