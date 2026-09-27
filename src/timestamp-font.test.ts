import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { TIMESTAMP_FONT_STYLESHEET_URL, createTimestampFontLoader } from './timestamp-font';

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('timestamp font loader', () => {
  it('does nothing for empty text and loads each nonempty current text after one stylesheet', async () => {
    expect(TIMESTAMP_FONT_STYLESHEET_URL).toBe(
      'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap',
    );
    const dom = new Window();
    const fonts = { load: vi.fn(() => Promise.resolve([])) } as unknown as FontFaceSet;
    const onReady = vi.fn();
    const request = createTimestampFontLoader(dom.document as unknown as Document, fonts, onReady);

    request('  ');
    expect(dom.document.querySelectorAll('link')).toHaveLength(0);
    expect(fonts.load).not.toHaveBeenCalled();

    request('2011.10.3');
    request('restored draft');
    const links = dom.document.querySelectorAll('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(TIMESTAMP_FONT_STYLESHEET_URL);
    links[0].dispatchEvent(new dom.Event('load'));
    await flush();

    expect(fonts.load).toHaveBeenNthCalledWith(1, '400 60px "Share Tech Mono"', '2011.10.3');
    expect(fonts.load).toHaveBeenNthCalledWith(2, '400 60px "Share Tech Mono"', 'restored draft');
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(2));
    expect(onReady).toHaveBeenCalledWith();
    dom.close();
  });

  it('catches stylesheet and font failures without calling ready', async () => {
    const stylesheetDom = new Window();
    const readyAfterStylesheetError = vi.fn();
    const stylesheetRequest = createTimestampFontLoader(
      stylesheetDom.document as unknown as Document,
      { load: vi.fn() } as unknown as FontFaceSet,
      readyAfterStylesheetError,
    );
    stylesheetRequest('a date');
    stylesheetDom.document.querySelector('link')!.dispatchEvent(new stylesheetDom.Event('error'));
    await flush();
    expect(readyAfterStylesheetError).not.toHaveBeenCalled();
    stylesheetDom.close();

    const fontDom = new Window();
    const readyAfterFontError = vi.fn();
    const fontRequest = createTimestampFontLoader(
      fontDom.document as unknown as Document,
      { load: vi.fn(() => Promise.reject(new Error('font failed'))) } as unknown as FontFaceSet,
      readyAfterFontError,
    );
    fontRequest('a date');
    fontDom.document.querySelector('link')!.dispatchEvent(new fontDom.Event('load'));
    await flush();
    expect(readyAfterFontError).not.toHaveBeenCalled();
    fontDom.close();
  });
});
