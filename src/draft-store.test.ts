import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from './theme';
import {
  clearDraftMetadata,
  createDraftPhotoStore,
  DRAFT_STORAGE_KEY,
  loadDraftMetadata,
  saveDraftMetadata,
  sanitizeDraftMetadata,
  type DraftMetadata,
} from './draft-store';

const metadata: DraftMetadata = {
  version: 1,
  editor: {
    sourceUrl: '  https://maps.example/raw  ',
    originalName: '原始店名',
    rating: '4.50',
    reviewCount: '0012',
    address: '原始地址',
    category: '咖啡',
    priceText: '$$',
    weeklyHours: { 星期一: '09:00~18:00' },
    selectedHoursOption: 'day:星期一',
    customHoursText: '自填營業時間',
    socialId: '@placeprint',
    qrCode: 'https://example.test/qr',
    qrCodeOverridden: true,
  },
  crop: { zoom: 2.25, panX: -0.4, panY: 0.7 },
  hasPhoto: true,
};

function memoryStorage(initial?: string): Storage {
  const entries = new Map<string, string>();
  if (initial !== undefined) entries.set(DRAFT_STORAGE_KEY, initial);
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
    clear: () => { entries.clear(); },
    key: (index) => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  } as Storage;
}

function fakeIndexedDb(): IDBFactory {
  const data = new Map<IDBValidKey, Blob>();
  const objectStoreNames = {
    contains: (name: string) => name === 'photo',
  };
  const objectStore = {
    get: (key: IDBValidKey) => {
      const request: any = { result: data.get(key) };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    put: (value: Blob, key: IDBValidKey) => {
      data.set(key, value);
      const request: any = { result: key };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    delete: (key: IDBValidKey) => {
      data.delete(key);
      const request: any = { result: undefined };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  const database: any = {
    objectStoreNames,
    createObjectStore: () => objectStore,
    transaction: () => {
      const transaction: any = {
        objectStore: () => objectStore,
        error: null,
      };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    },
    close: () => undefined,
  };
  return {
    open: () => {
      const request: any = { result: database };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
}

describe('draft-store', () => {
  it('round-trips raw metadata through injected storage', () => {
    const storage = memoryStorage();
    expect(saveDraftMetadata(storage, metadata)).toBe(true);
    expect(loadDraftMetadata(storage)).toEqual(metadata);
    storage.setItem(THEME_STORAGE_KEY, 'kincha');
    expect(clearDraftMetadata(storage)).toBe(true);
    expect(storage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('kincha');
  });

  it('sanitizes crop and invalid hours selections without throwing', () => {
    const sanitized = sanitizeDraftMetadata({
      ...metadata,
      editor: { ...metadata.editor, selectedHoursOption: 'missing-option' },
      crop: { zoom: 99, panX: -4, panY: 4 },
      extra: 'ignored',
    });
    expect(sanitized?.editor.selectedHoursOption).toBe('custom');
    expect(sanitized?.crop).toEqual({ zoom: 3, panX: -1, panY: 1 });
  });

  it('ignores corrupt and future metadata and removes only the draft key', () => {
    const corruptStorage = memoryStorage('{not-json');
    expect(loadDraftMetadata(corruptStorage)).toBeNull();
    expect(corruptStorage.getItem(DRAFT_STORAGE_KEY)).toBe('{not-json');

    const futureStorage = memoryStorage(JSON.stringify({ ...metadata, version: 99 }));
    expect(loadDraftMetadata(futureStorage)).toBeNull();
    expect(futureStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('round-trips one photo through an injected IndexedDB adapter and surfaces open failures', async () => {
    const store = createDraftPhotoStore(fakeIndexedDb());
    const photo = new Blob(['photo'], { type: 'image/png' });
    await store.put(photo);
    expect(await store.get()).toBe(photo);
    await store.delete();
    expect(await store.get()).toBeNull();

    const failingFactory = { open: () => { throw new Error('open failed'); } } as unknown as IDBFactory;
    await expect(createDraftPhotoStore(failingFactory).get()).rejects.toThrow('open failed');
  });

  it('treats throwing storage and unavailable IndexedDB as non-fatal failures', async () => {
    const throwingStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    } as unknown as Storage;
    expect(loadDraftMetadata(throwingStorage)).toBeNull();
    expect(saveDraftMetadata(throwingStorage, metadata)).toBe(false);
    expect(clearDraftMetadata(throwingStorage)).toBe(false);

    const unavailable = createDraftPhotoStore(null);
    await expect(unavailable.get()).rejects.toThrow('IndexedDB is unavailable');
    await expect(unavailable.put(new Blob(['photo'], { type: 'image/png' }))).rejects.toThrow('IndexedDB is unavailable');
    await expect(unavailable.delete()).rejects.toThrow('IndexedDB is unavailable');
  });
});
