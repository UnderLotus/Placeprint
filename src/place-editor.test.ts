import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasExportablePlaceContent } from './share-card';
import { InvalidHttpUrlError } from './maps-url';
import {
  mountPlaceEditor,
  type PlaceEditorDraft,
  type PlaceEditorNotice,
} from './place-editor';
import type { PlaceInfo, Weekday } from './place-info';

const WEEKDAYS: Weekday[] = [
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
  '星期日',
];

const fixture = `
  <form id="editor-form">
    <button id="close-editor-button" type="button">close</button>
    <input id="maps-url" name="mapsUrl" maxlength="2048">
    <p id="maps-url-error" class="field-error" role="alert" aria-live="polite" hidden></p>
    <button id="fetch-place-button" type="button">fetch</button>
    <input id="store-name" name="storeName">
    <input id="rating" name="rating" type="number" min="0" max="5" step="0.1">
    <p id="rating-error"></p>
    <input id="review-count" name="reviewCount" type="number" min="0" max="999999999" step="1">
    <p id="review-count-error"></p>
    <input id="category" name="category" maxlength="48">
    <input id="price-text" name="priceText" maxlength="32">
    <select id="hours-select" name="hoursOption"></select>
    <input id="custom-hours" name="customHours" maxlength="80">
    <input id="address" name="address">
    <input id="social-id" name="socialId" maxlength="64">
    <input id="qr-code" name="qrCode">
    <p id="qr-code-error"></p>
  </form>
`;

let dom: Window;

function installDom(next: Window): void {
  const values: Record<string, unknown> = {
    window: next,
    document: next.document,
    navigator: next.navigator,
    HTMLElement: next.HTMLElement,
    HTMLInputElement: next.HTMLInputElement,
    HTMLSelectElement: next.HTMLSelectElement,
    HTMLFormElement: next.HTMLFormElement,
    Event: next.Event,
    MouseEvent: next.MouseEvent,
    CustomEvent: next.CustomEvent,
  };
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
}

function dispatch(target: EventTarget, type: string): void {
  target.dispatchEvent(
    new dom.Event(type, { bubbles: true, cancelable: true }) as unknown as Event,
  );
}

function click(target: EventTarget): void {
  target.dispatchEvent(
    new dom.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event,
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function place(name: string, sourceUrl: string): PlaceInfo {
  return {
    sourceUrl,
    originalName: name,
    rating: 4.8,
    reviewCount: 123,
    address: `${name} address`,
    category: '咖啡廳',
    weeklyHours: Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, '10:00~20:30'])) as Partial<Record<Weekday, string>>,
  };
}

function elements(): {
  url: HTMLInputElement;
  urlError: HTMLElement;
  fetch: HTMLButtonElement;
  name: HTMLInputElement;
  rating: HTMLInputElement;
  ratingError: HTMLElement;
  reviewCount: HTMLInputElement;
  reviewError: HTMLElement;
  address: HTMLInputElement;
  category: HTMLInputElement;
  price: HTMLInputElement;
  social: HTMLInputElement;
  qr: HTMLInputElement;
  qrError: HTMLElement;
  hours: HTMLSelectElement;
  customHours: HTMLInputElement;
  form: HTMLFormElement;
} {
  const get = <T extends globalThis.Element>(selector: string): T =>
    dom.document.querySelector(selector) as unknown as T;
  return {
    url: get('#maps-url'),
    urlError: get('#maps-url-error'),
    fetch: get('#fetch-place-button'),
    name: get('#store-name'),
    rating: get('#rating'),
    ratingError: get('#rating-error'),
    reviewCount: get('#review-count'),
    reviewError: get('#review-count-error'),
    address: get('#address'),
    category: get('#category'),
    price: get('#price-text'),
    social: get('#social-id'),
    qr: get('#qr-code'),
    qrError: get('#qr-code-error'),
    hours: get('#hours-select'),
    customHours: get('#custom-hours'),
    form: get('#editor-form'),
  };
}

function mount(
  resolvePlace: (sourceUrl: string) => Promise<PlaceInfo>,
): { editor: ReturnType<typeof mountPlaceEditor>; notices: PlaceEditorNotice[] } {
  const notices: PlaceEditorNotice[] = [];
  const editor = mountPlaceEditor({
    root: dom.document as unknown as ParentNode,
    resolvePlace,
    onNotice: (notice) => notices.push(notice),
  });
  return { editor, notices };
}

beforeEach(() => {
  dom = new Window({ url: 'https://placeprint.test/' });
  dom.document.body.innerHTML = fixture;
  installDom(dom);
});

afterEach(() => {
  dom.close();
});

describe('DOM-first place editor', () => {
  it('mounts without an initial notice and returns detached weekly-hours snapshots', async () => {
    const sourceUrl = 'https://maps.example/one';
    const { editor, notices } = mount(async () => place('Cafe', sourceUrl));
    const controls = elements();

    expect(notices).toEqual([]);
    controls.url.value = sourceUrl;
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();

    expect(notices.filter((notice) => notice.type === 'change')).toHaveLength(2);
    const snapshot = editor.read();
    snapshot.content.placeInfo.weeklyHours!.星期一 = 'mutated';
    snapshot.content.placeInfo.originalName = 'mutated';
    const next = editor.read();
    expect(next.content.placeInfo.originalName).toBe('Cafe');
    expect(next.content.placeInfo.weeklyHours?.星期一).toBe('10:00~20:30');
    editor.dispose();
  });

  it('labels manual, lookup success, and lookup failure changes while suppressing stale success', async () => {
    const first = deferred<PlaceInfo>();
    const second = deferred<PlaceInfo>();
    const third = deferred<PlaceInfo>();
    const resolver = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const { editor, notices } = mount(resolver);
    const controls = elements();

    controls.url.value = 'https://maps.example/a';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    controls.url.value = 'https://maps.example/b';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();

    expect(notices.filter((notice) => notice.type === 'lookup-start')).toHaveLength(2);
    expect(notices.filter((notice) => notice.type === 'change').map((notice) => notice.source)).toContain('manual');

    first.resolve(place('stale', 'https://maps.example/a'));
    await flush();
    expect(notices.filter((notice) => notice.type === 'change' && notice.source === 'lookup-success')).toEqual([]);

    second.resolve(place('fresh', 'https://maps.example/b'));
    await flush();
    expect(notices.filter((notice) => notice.type === 'change' && notice.source === 'lookup-success')).toHaveLength(1);

    controls.url.value = 'https://maps.example/c';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    third.reject(new Error('lookup failed'));
    await flush();
    expect(notices.filter((notice) => notice.type === 'change' && notice.source === 'lookup-failure')).toHaveLength(1);
    editor.dispose();
  });

  it('keeps invalid URL lookup errors local with the exact message and allows manual export content', async () => {
    let globalStatus = 'previous status';
    const notices: PlaceEditorNotice[] = [];
    const editor = mountPlaceEditor({
      root: dom.document as unknown as ParentNode,
      resolvePlace: async () => {
        throw new InvalidHttpUrlError();
      },
      onNotice: (notice) => {
        notices.push(notice);
        if (notice.type === 'status') {
          globalStatus = notice.message;
        }
      },
    });
    const controls = elements();
    controls.url.setAttribute('aria-describedby', 'maps-url-help');
    controls.url.value = 'not a URL';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();

    expect(controls.urlError.hidden).toBe(false);
    expect(controls.urlError.getAttribute('role')).toBe('alert');
    expect(controls.urlError.getAttribute('aria-live')).toBe('polite');
    expect(controls.urlError.textContent).toBe('請輸入Google Map網址');
    expect(controls.url.getAttribute('aria-describedby')).toBe('maps-url-help maps-url-error');
    expect(controls.url.hasAttribute('aria-invalid')).toBe(false);
    expect(controls.url.validationMessage).toBe('');
    expect(globalStatus).toBe('');
    expect(notices.some((notice) => notice.type === 'status' && notice.error)).toBe(false);

    controls.name.value = '手填店名';
    dispatch(controls.name, 'input');
    const snapshot = editor.read();
    expect(snapshot.valid).toBe(true);
    expect(hasExportablePlaceContent(snapshot.content)).toBe(true);

    controls.url.value = 'https://maps.example/manual';
    dispatch(controls.url, 'input');
    expect(controls.url.getAttribute('aria-describedby')).toBe('maps-url-help');
    editor.dispose();
  });

  it('clears URL lookup errors on start, edit, success, and reset', async () => {
    const first = deferred<PlaceInfo>();
    const second = deferred<PlaceInfo>();
    const third = deferred<PlaceInfo>();
    const resolver = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const { editor } = mount(resolver);
    const controls = elements();

    controls.url.value = 'https://maps.example/first';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    first.reject(new Error('network down'));
    await flush();
    expect(controls.urlError.hidden).toBe(false);

    click(controls.fetch);
    await flush();
    expect(controls.urlError.hidden).toBe(true);
    second.resolve(place('Fresh', 'https://maps.example/first'));
    await flush();
    expect(controls.urlError.hidden).toBe(true);

    controls.url.value = 'https://maps.example/third';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    third.reject(new Error('again'));
    await flush();
    expect(controls.urlError.hidden).toBe(false);
    editor.reset();
    expect(controls.urlError.hidden).toBe(true);
    expect(controls.url.getAttribute('aria-describedby')).toBeNull();
    editor.dispose();
  });

  it('does not let a stale lookup failure overwrite the current URL error state', async () => {
    const stale = deferred<PlaceInfo>();
    const current = deferred<PlaceInfo>();
    const resolver = vi.fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const { editor } = mount(resolver);
    const controls = elements();

    controls.url.value = 'https://maps.example/stale';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    controls.url.value = 'https://maps.example/current';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();

    stale.reject(new Error('stale failure'));
    await flush();
    expect(controls.urlError.hidden).toBe(true);
    current.reject(new Error('current failure'));
    await flush();
    expect(controls.urlError.textContent).toBe('無法取得店家資料，請重試或手動填寫');
    editor.dispose();
  });

  it('attaches an explicit target/control and before/after values to every manual control notice', () => {
    const { editor, notices } = mount(async (sourceUrl) => place('Fresh', sourceUrl));
    const controls = elements();
    const cases: Array<{
      target: string;
      control: HTMLInputElement | HTMLSelectElement;
      value: string;
      dispatchType: string;
    }> = [
      { target: 'maps-url', control: controls.url, value: 'https://maps.example/manual', dispatchType: 'input' },
      { target: 'store-name', control: controls.name, value: '店', dispatchType: 'input' },
      { target: 'rating', control: controls.rating, value: '4', dispatchType: 'input' },
      { target: 'review-count', control: controls.reviewCount, value: '1', dispatchType: 'input' },
      { target: 'address', control: controls.address, value: '地址', dispatchType: 'input' },
      { target: 'category', control: controls.category, value: '咖啡', dispatchType: 'input' },
      { target: 'price-text', control: controls.price, value: '$', dispatchType: 'input' },
      { target: 'social-id', control: controls.social, value: '@id', dispatchType: 'input' },
      { target: 'qr-code', control: controls.qr, value: 'https://example.com/qr', dispatchType: 'input' },
      { target: 'hours-select', control: controls.hours, value: 'custom', dispatchType: 'change' },
      { target: 'custom-hours', control: controls.customHours, value: '09:00', dispatchType: 'input' },
    ];

    for (const testCase of cases) {
      testCase.control.value = testCase.value;
      dispatch(testCase.control, testCase.dispatchType);
      const notice = notices.at(-1);
      expect(notice).toMatchObject({
        type: 'change',
        source: 'manual',
        target: testCase.target,
        control: testCase.control,
        value: testCase.value,
      });
      if (notice?.type === 'change' && notice.source === 'manual') {
        expect(typeof notice.previousValue).toBe('string');
      }
    }
    editor.dispose();
  });

  it('invalidates delayed lookup on URL, ordinary fields, hours, and social edits', async () => {
    const cases: Array<{
      label: string;
      edit: (controls: ReturnType<typeof elements>) => void;
    }> = [
      {
        label: 'url',
        edit: (controls) => {
          controls.url.value = 'https://maps.example/two';
          dispatch(controls.url, 'input');
        },
      },
      {
        label: 'place field',
        edit: (controls) => {
          controls.name.value = 'hand entered';
          dispatch(controls.name, 'input');
        },
      },
      {
        label: 'hours select',
        edit: (controls) => {
          controls.hours.value = 'custom';
          dispatch(controls.hours, 'change');
        },
      },
      {
        label: 'custom hours',
        edit: (controls) => {
          controls.customHours.value = '我的手填時間';
          dispatch(controls.customHours, 'input');
        },
      },
      {
        label: 'social',
        edit: (controls) => {
          controls.social.value = '@manual';
          dispatch(controls.social, 'input');
        },
      },
    ];

    for (const testCase of cases) {
      const pending = deferred<PlaceInfo>();
      const sourceUrl = `https://maps.example/${testCase.label}`;
      const { editor, notices } = mount(() => pending.promise);
      const controls = elements();
      controls.url.value = sourceUrl;
      dispatch(controls.url, 'input');
      click(controls.fetch);
      await flush();
      expect(controls.fetch.disabled, testCase.label).toBe(true);

      testCase.edit(controls);
      expect(controls.fetch.disabled, testCase.label).toBe(false);
      pending.resolve(place('stale', sourceUrl));
      await flush();

      expect(controls.name.value, testCase.label).not.toBe('stale');
      expect(notices.filter((notice) => notice.type === 'change' && notice.source === 'lookup-success'), testCase.label).toEqual([]);
      expect(notices.filter((notice) => notice.type === 'change' && notice.source === 'lookup-failure'), testCase.label).toEqual([]);
      expect(notices.filter((notice) => notice.type === 'status' && notice.error), testCase.label).toEqual([]);
      editor.dispose();
    }
  });

  it('restores the lookup lock when the initial status notice throws and propagates the callback error', async () => {
    const sourceUrl = 'https://maps.example/callback-error';
    const callbackError = new Error('status renderer failed');
    const unhandledReasons: unknown[] = [];
    let throwInitialStatus = true;
    let resolverCalls = 0;
    const notices: PlaceEditorNotice[] = [];
    const editor = mountPlaceEditor({
      root: dom.document as unknown as ParentNode,
      resolvePlace: async () => {
        resolverCalls += 1;
        return place('Recovered', sourceUrl);
      },
      onNotice: (notice) => {
        notices.push(notice);
        if (throwInitialStatus && notice.type === 'status' && notice.message === '') {
          throwInitialStatus = false;
          throw callbackError;
        }
      },
    });
    const controls = elements();
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledReasons.push(reason);
    };

    controls.url.value = sourceUrl;
    dispatch(controls.url, 'input');
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      click(controls.fetch);
      await flush();
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }

    expect(resolverCalls).toBe(0);
    expect(controls.fetch.disabled).toBe(false);
    expect(unhandledReasons).toContain(callbackError);
    expect(notices.some((notice) => notice.type === 'status' && notice.error)).toBe(false);

    click(controls.fetch);
    await flush();
    expect(resolverCalls).toBe(1);
    expect(controls.name.value).toBe('Recovered');
    expect(controls.fetch.disabled).toBe(false);
    editor.dispose();
  });

  it('does not let A finally unlock B after A is invalidated and B starts', async () => {
    const first = deferred<PlaceInfo>();
    const second = deferred<PlaceInfo>();
    const resolver = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { editor } = mount(resolver);
    const controls = elements();

    controls.url.value = 'https://maps.example/a';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    controls.url.value = 'https://maps.example/b';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    expect(controls.fetch.disabled).toBe(true);

    first.resolve(place('A', 'https://maps.example/a'));
    await flush();
    expect(controls.fetch.disabled).toBe(true);
    expect(controls.name.value).not.toBe('A');

    second.resolve(place('B', 'https://maps.example/b'));
    await flush();
    expect(controls.name.value).toBe('B');
    expect(controls.fetch.disabled).toBe(false);
    editor.dispose();
  });

  it('ignores a stale rejection while B remains locked and then applies B success', async () => {
    const first = deferred<PlaceInfo>();
    const second = deferred<PlaceInfo>();
    const resolver = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { editor, notices } = mount(resolver);
    const controls = elements();
    controls.name.value = 'manual before lookup';
    controls.address.value = 'manual address';

    controls.url.value = 'https://maps.example/a-reject';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    controls.url.value = 'https://maps.example/b-success';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    expect(controls.fetch.disabled).toBe(true);
    const noticesBeforeStaleReject = [...notices];

    first.reject(new Error('stale network failure'));
    await flush();

    expect(controls.fetch.disabled).toBe(true);
    expect(controls.name.value).toBe('manual before lookup');
    expect(controls.address.value).toBe('manual address');
    expect(notices).toEqual(noticesBeforeStaleReject);

    second.resolve(place('B', 'https://maps.example/b-success'));
    await flush();
    expect(controls.name.value).toBe('B');
    expect(controls.address.value).toBe('B address');
    expect(controls.fetch.disabled).toBe(false);
    editor.dispose();
  });

  it('keeps QR edits non-invalidating and preserves the custom value through success', async () => {
    const pending = deferred<PlaceInfo>();
    const { editor } = mount(() => pending.promise);
    const controls = elements();
    const sourceUrl = '  https://maps.example/raw  ';
    controls.url.value = sourceUrl;
    dispatch(controls.url, 'input');
    expect(controls.qr.value).toBe('');

    click(controls.fetch);
    expect(controls.qr.value).toBe(sourceUrl);
    await flush();
    controls.qr.value = 'https://example.test/custom';
    dispatch(controls.qr, 'input');
    expect(controls.fetch.disabled).toBe(true);
    pending.resolve(place('Fresh', sourceUrl.trim()));
    await flush();

    expect(controls.name.value).toBe('Fresh');
    expect(editor.read().content.qrCode).toBe('https://example.test/custom');
    expect(controls.fetch.disabled).toBe(false);
    editor.dispose();
  });

  it('syncs raw URL on each fetch until the first QR input, including clearing', async () => {
    const first = deferred<PlaceInfo>();
    const second = deferred<PlaceInfo>();
    const resolver = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { editor } = mount(resolver);
    const controls = elements();

    controls.url.value = '  https://maps.example/one  ';
    dispatch(controls.url, 'input');
    expect(controls.qr.value).toBe('');
    click(controls.fetch);
    expect(controls.qr.value).toBe('  https://maps.example/one  ');
    first.resolve(place('First', 'https://maps.example/one'));
    await flush();

    controls.url.value = 'https://maps.example/two';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    expect(controls.qr.value).toBe('https://maps.example/two');
    second.resolve(place('Second', 'https://maps.example/two'));
    await flush();

    controls.qr.value = '';
    dispatch(controls.qr, 'input');
    controls.url.value = 'https://maps.example/three';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    expect(controls.qr.value).toBe('');
    editor.dispose();
  });

  it('maps success data at the form boundary, resets hours, and preserves social/QR', async () => {
    const sourceUrl = 'https://maps.example/clamp';
    const longName = '店名😀'.repeat(30);
    const longAddress = '地址😀'.repeat(80);
    const longCategory = '類別'.repeat(40);
    const longPrice = '價格'.repeat(30);
    const result: PlaceInfo = {
      sourceUrl,
      originalName: longName,
      rating: 4.5,
      reviewCount: 1_000_000_000,
      address: longAddress,
      category: longCategory,
      priceText: longPrice,
      weeklyHours: Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, '09:00~18:00'])) as Partial<Record<Weekday, string>>,
    };
    const { editor } = mount(async () => result);
    const controls = elements();
    controls.social.value = '@keep';
    dispatch(controls.social, 'input');
    controls.url.value = sourceUrl;
    dispatch(controls.url, 'input');
    controls.qr.value = 'https://example.test/keep';
    dispatch(controls.qr, 'input');
    click(controls.fetch);
    await flush();

    expect(controls.name.value).toBe(longName);
    expect(controls.address.value).toBe(longAddress);
    expect(controls.category.value.length).toBeLessThanOrEqual(48);
    expect(controls.price.value.length).toBeLessThanOrEqual(32);
    expect(controls.reviewCount.value).toBe('999999999');
    expect(controls.social.value).toBe('@keep');
    expect(controls.qr.value).toBe('https://example.test/keep');
    expect(controls.hours.value).toBe('weekday');
    expect(editor.read().content.hoursText).toBe('平日 09:00~18:00');
    editor.dispose();
  });

  it('clears automatic fields and hours on current failure while preserving URL, social, and QR', async () => {
    const sourceUrl = 'https://maps.example/failure';
    const failure = deferred<PlaceInfo>();
    const resolver = vi.fn()
      .mockResolvedValueOnce(place('Before', sourceUrl))
      .mockReturnValueOnce(failure.promise);
    const { editor, notices } = mount(resolver);
    const controls = elements();
    controls.url.value = sourceUrl;
    dispatch(controls.url, 'input');
    controls.social.value = '@keep';
    dispatch(controls.social, 'input');
    controls.qr.value = 'https://example.test/keep';
    dispatch(controls.qr, 'input');
    click(controls.fetch);
    await flush();
    expect(controls.name.value).toBe('Before');

    controls.url.value = 'https://maps.example/failure-again';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    failure.reject(new Error('network down'));
    await flush();

    expect(controls.url.value).toBe('https://maps.example/failure-again');
    expect(controls.social.value).toBe('@keep');
    expect(controls.qr.value).toBe('https://example.test/keep');
    expect(controls.name.value).toBe('');
    expect(controls.address.value).toBe('');
    expect(controls.rating.value).toBe('');
    expect(controls.hours.value).toBe('custom');
    expect(editor.read().content.hoursText).toBe('');
    expect(controls.urlError.hidden).toBe(false);
    expect(controls.urlError.textContent).toBe('無法取得店家資料，請重試或手動填寫');
    expect(controls.url.getAttribute('aria-describedby')).toBe('maps-url-error');
    expect(controls.url.hasAttribute('aria-invalid')).toBe(false);
    expect(controls.url.validationMessage).toBe('');
    expect(notices.some((notice) => notice.type === 'status' && notice.error)).toBe(false);
    editor.dispose();
  });

  it('updates native/custom validity and repairs download-facing validity without a change from validate', () => {
    const { editor, notices } = mount(async () => place('Valid', 'https://maps.example/valid'));
    const controls = elements();
    controls.rating.value = '6';
    dispatch(controls.rating, 'input');
    const changesBeforeValidate = notices.filter((notice) => notice.type === 'change').length;
    expect(editor.read().valid).toBe(false);
    expect(controls.rating.getAttribute('aria-invalid')).toBe('true');
    expect(controls.rating.getAttribute('aria-describedby')).toBe('rating-error');
    expect((dom.document.querySelector('#rating-error') as unknown as HTMLElement).hidden).toBe(false);
    expect(controls.rating.validationMessage).toBe('評分請輸入 0～5 的數字');
    expect((dom.document.querySelector('#rating-error') as unknown as HTMLElement).textContent).toBe('評分請輸入 0～5 的數字');

    expect(editor.validate()).toBe(false);
    expect(notices.filter((notice) => notice.type === 'change')).toHaveLength(changesBeforeValidate);
    expect(notices.some((notice) => notice.type === 'invalid' && notice.field === controls.rating)).toBe(true);
    expect(notices.some((notice) => notice.type === 'status' && notice.error)).toBe(true);

    // happy-dom 20.14.5 currently reports decimal stepMismatch for values
    // Chrome accepts (for example 4.5); use a native-valid repair here.
    controls.rating.value = '0.1';
    dispatch(controls.rating, 'input');
    expect(editor.read().valid).toBe(true);
    expect(controls.rating.hasAttribute('aria-invalid')).toBe(false);
    expect((dom.document.querySelector('#rating-error') as unknown as HTMLElement).hidden).toBe(true);
    expect(editor.validate()).toBe(true);
    editor.dispose();
  });

  it('maps every over-precise rating value to the exact Traditional Chinese message', () => {
    const decimalCases = ['0.01', '1.23', '4.35', '4.999', '5.00'];
    for (const value of decimalCases) {
      const { editor } = mount(async () => place('Valid', 'https://maps.example/validity'));
      const controls = elements();
      controls.rating.value = value;
      dispatch(controls.rating, 'input');
      expect(controls.rating.validationMessage, value).toBe('數字僅接受到小數點第一位');
      expect(controls.ratingError.textContent, value).toBe('數字僅接受到小數點第一位');
      editor.dispose();
    }
  });

  it('accepts rating values with at most one decimal place', () => {
    const validCases = ['0.0', '4.3', '5.0'];
    for (const value of validCases) {
      const { editor } = mount(async () => place('Valid', 'https://maps.example/validity'));
      const controls = elements();
      controls.rating.value = value;
      dispatch(controls.rating, 'input');
      // happy-dom reports native stepMismatch for some legal one-decimal values;
      // browser validationMessage/checkValidity is covered by the Chromium probe.
      expect(controls.rating.validity.customError, value).toBe(false);
      expect(controls.rating.hasAttribute('aria-invalid'), value).toBe(false);
      expect(controls.ratingError.textContent, value).toBe('');
      expect(controls.ratingError.hidden, value).toBe(true);
      editor.dispose();
    }
  });

  it('maps rating range and review validity to exact Traditional Chinese messages', () => {
    const { editor } = mount(async () => place('Valid', 'https://maps.example/validity'));
    const controls = elements();

    controls.rating.value = '5.1';
    dispatch(controls.rating, 'input');
    expect(controls.rating.validationMessage).toBe('評分請輸入 0～5 的數字');

    controls.reviewCount.value = '12.5';
    dispatch(controls.reviewCount, 'input');
    expect(controls.reviewCount.validationMessage).toBe('評價數僅接受整數');
    expect(controls.reviewError.textContent).toBe('評價數僅接受整數');

    controls.reviewCount.value = '1000000000';
    dispatch(controls.reviewCount, 'input');
    expect(controls.reviewCount.validationMessage).toBe('評價數請輸入 0～999999999 的整數');

    controls.category.value = 'a'.repeat(49);
    dispatch(controls.category, 'input');
    expect(controls.category.validationMessage).toBe('此欄位最多 48 個字元');
    editor.dispose();
  });

  it('reports QR capacity as custom validity and clears it after repair', () => {
    const { editor } = mount(async () => place('Valid', 'https://maps.example/qr'));
    const controls = elements();
    controls.qr.value = '海'.repeat(1000);
    dispatch(controls.qr, 'input');
    expect(editor.read().valid).toBe(false);
    expect(controls.qr.getAttribute('aria-invalid')).toBe('true');
    expect(controls.qrError.hidden).toBe(false);
    expect(controls.qr.validationMessage).toBe('QR Code 內容過長，請縮短後再試');
    expect(controls.qrError.textContent).toBe('QR Code 內容過長，請縮短後再試');
    expect(editor.validate()).toBe(false);

    controls.qr.value = 'https://example.test/short';
    dispatch(controls.qr, 'input');
    expect(editor.read().valid).toBe(true);
    expect(controls.qrError.hidden).toBe(true);
    editor.dispose();
  });

  it('prevents submit and emits the same invalid notice without changing content', () => {
    const { editor, notices } = mount(async () => place('Valid', 'https://maps.example/submit'));
    const controls = elements();
    controls.reviewCount.value = '-1';
    const event = new dom.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event;
    const dispatched = controls.form.dispatchEvent(event);
    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(notices.some((notice) => notice.type === 'invalid' && notice.field === controls.reviewCount)).toBe(true);
    expect(notices.some((notice) => notice.type === 'status' && notice.error)).toBe(true);
    editor.dispose();
  });

  it('restores a raw draft without notices and reset invalidates pending lookup', async () => {
    const initialDraft: PlaceEditorDraft = {
      sourceUrl: 'https://maps.example/restored',
      originalName: 'Restored',
      rating: '4.50',
      reviewCount: '0012',
      address: 'Raw address',
      category: '咖啡',
      priceText: '$$',
      weeklyHours: { 星期一: '09:00~18:00' },
      selectedHoursOption: 'day:星期一',
      customHoursText: '自填時間',
      socialId: '@restored',
      qrCode: 'https://example.test/qr',
      qrCodeOverridden: true,
    };
    const pending = deferred<PlaceInfo>();
    const notices: PlaceEditorNotice[] = [];
    const editor = mountPlaceEditor({
      root: dom.document as unknown as ParentNode,
      initialDraft,
      resolvePlace: () => pending.promise,
      onNotice: (notice) => notices.push(notice),
    });
    const controls = elements();

    expect(notices).toEqual([]);
    expect(editor.readDraft()).toEqual(initialDraft);
    expect(controls.hours.value).toBe('day:星期一');
    expect(controls.customHours.hidden).toBe(true);

    click(controls.fetch);
    await flush();
    expect(controls.fetch.disabled).toBe(true);
    const empty = editor.reset();
    expect(empty.content.placeInfo.originalName).toBe('');
    expect(editor.readDraft()).toMatchObject({
      sourceUrl: '',
      originalName: '',
      weeklyHours: undefined,
      selectedHoursOption: 'custom',
      customHoursText: '',
      qrCode: '',
      qrCodeOverridden: false,
    });
    expect(controls.fetch.disabled).toBe(false);

    pending.resolve(place('stale', 'https://maps.example/restored'));
    await flush();
    expect(controls.name.value).toBe('');
    expect(notices.some((notice) => notice.type === 'change' && notice.source === 'lookup-success')).toBe(false);
    editor.dispose();
  });

  it('suppresses a stale lookup failure after reset', async () => {
    const pending = deferred<PlaceInfo>();
    const notices: PlaceEditorNotice[] = [];
    const editor = mountPlaceEditor({
      root: dom.document as unknown as ParentNode,
      resolvePlace: () => pending.promise,
      onNotice: (notice) => notices.push(notice),
    });
    const controls = elements();
    controls.url.value = 'https://maps.example/reset-failure';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    editor.reset();
    pending.reject(new Error('stale failure'));
    await flush();
    expect(notices.some((notice) => notice.type === 'change' && notice.source === 'lookup-failure')).toBe(false);
    expect(notices.some((notice) => notice.type === 'status' && notice.error)).toBe(false);
    editor.dispose();
  });

  it('falls back safely when a restored hours selection is no longer available', () => {
    const initialDraft: PlaceEditorDraft = {
      sourceUrl: '',
      originalName: '',
      rating: '',
      reviewCount: '',
      address: '',
      category: '',
      priceText: '',
      weeklyHours: { 星期一: '09:00~18:00' },
      selectedHoursOption: 'weekday',
      customHoursText: '自填時間',
      socialId: '',
      qrCode: '',
      qrCodeOverridden: false,
    };
    const editor = mountPlaceEditor({
      root: dom.document as unknown as ParentNode,
      initialDraft,
      resolvePlace: async () => place('unused', ''),
      onNotice: () => undefined,
    });
    expect(elements().hours.value).toBe('custom');
    expect(editor.readDraft().selectedHoursOption).toBe('custom');
    editor.dispose();
  });

  it('dispose is idempotent, removes listeners, and suppresses delayed completion notices and finally changes', async () => {
    const pending = deferred<PlaceInfo>();
    const { editor, notices } = mount(() => pending.promise);
    const controls = elements();
    controls.url.value = 'https://maps.example/dispose';
    dispatch(controls.url, 'input');
    click(controls.fetch);
    await flush();
    expect(controls.fetch.disabled).toBe(true);
    const noticeCount = notices.length;

    editor.dispose();
    editor.dispose();
    controls.url.value = 'https://maps.example/after-dispose';
    dispatch(controls.url, 'input');
    pending.resolve(place('late', 'https://maps.example/dispose'));
    await flush();

    expect(notices).toHaveLength(noticeCount);
    expect(controls.fetch.disabled).toBe(true);
    expect(controls.qr.value).toBe('https://maps.example/dispose');
  });
});
