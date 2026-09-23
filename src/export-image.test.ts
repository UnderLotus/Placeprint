import { describe, expect, it } from 'vitest';
import {
  beginExportGeneration,
  choosePngExportMode,
  invalidateExportGeneration,
  isCurrentExportGeneration,
  isIosSafari,
  openPngBlob,
  preparePngPreview,
} from './export-image';

function navigatorLike(userAgent: string, platform: string, maxTouchPoints: number) {
  return { userAgent, platform, maxTouchPoints };
}

describe('PNG export generation', () => {
  it('accepts the current token and rejects invalidated or older exports', () => {
    let generation = 0;
    const firstToken = beginExportGeneration(generation);
    generation = firstToken;

    expect(isCurrentExportGeneration(generation, firstToken)).toBe(true);

    generation = invalidateExportGeneration(generation);
    expect(isCurrentExportGeneration(generation, firstToken)).toBe(false);

    const secondToken = beginExportGeneration(generation);
    generation = secondToken;
    expect(isCurrentExportGeneration(generation, firstToken)).toBe(false);
    expect(isCurrentExportGeneration(generation, secondToken)).toBe(true);
  });
});

describe('PNG export fallback', () => {
  it('uses preview mode for iOS Safari even when download is exposed', () => {
    expect(choosePngExportMode({
      downloadAttributeSupported: true,
      iosSafari: true,
    })).toBe('preview');
    expect(isIosSafari(navigatorLike(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      'iPhone',
      5,
    ))).toBe(true);
  });

  it('keeps normal Chromium on the direct download path and completes anchor cleanup', () => {
    expect(choosePngExportMode({
      downloadAttributeSupported: true,
      iosSafari: false,
    })).toBe('download');
    const clicks: string[] = [];
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const revoked: string[] = [];
    const anchor = {
      href: '',
      download: '',
      click: () => clicks.push('click'),
    };
    const browserNavigator = navigatorLike(
      'Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36',
      'MacIntel',
      0,
    );
    const environment = {
      document: { createElement: () => anchor },
      window: {},
      navigator: browserNavigator,
      url: {
        createObjectURL: () => 'blob:download',
        revokeObjectURL: (url: string) => revoked.push(url),
      },
      schedule: (callback: () => void, delay: number) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
    } as never;

    expect(isIosSafari(browserNavigator)).toBe(false);
    expect(openPngBlob(new Blob(['png']), 'share-card.png', environment)).toEqual({ mode: 'download' });
    expect(anchor).toMatchObject({ href: 'blob:download', download: 'share-card.png' });
    expect(clicks).toEqual(['click']);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].delay).toBe(0);
    expect(revoked).toEqual([]);
    scheduled[0].callback();
    expect(revoked).toEqual(['blob:download']);
  });

  it('returns a manual fallback when the gesture-owned preview window is blocked', () => {
    const calls: string[] = [];
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const anchor = {
      href: '',
      target: '',
      rel: '',
      click: () => calls.push('anchor'),
    };
    const environment = {
      document: { createElement: () => anchor },
      window: { open: () => { calls.push('window-open'); return null; } },
      navigator: navigatorLike('Safari', 'iPhone', 5),
      url: {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: (url: string) => calls.push('revoke:' + url),
      },
      schedule: (callback: () => void, delay: number) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
    } as never;

    const result = openPngBlob(new Blob(['png']), 'share-card.png', environment);

    expect(result.mode).toBe('manual');
    if (result.mode !== 'manual') {
      throw new Error('Expected a manual fallback result.');
    }
    expect(result.url).toBe('blob:test');
    expect(calls).toEqual([]);
    expect(scheduled).toEqual([]);
    result.cleanup();
    result.cleanup();
    expect(calls).toEqual(['revoke:blob:test']);
  });

  it('navigates a real prepared preview window and retains its URL until cleanup', () => {
    const previewWindow = { location: { href: '' } };
    const revoked: string[] = [];
    const anchor = { href: '', download: '', click: () => undefined };
    const environment = {
      document: { createElement: () => anchor },
      window: { open: () => previewWindow },
      navigator: navigatorLike(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
        'iPhone',
        5,
      ),
      previewWindow,
      url: {
        createObjectURL: () => 'blob:preview',
        revokeObjectURL: (url: string) => revoked.push(url),
      },
      schedule: () => 1,
    } as never;

    const result = openPngBlob(new Blob(['png']), 'share-card.png', environment);

    expect(result.mode).toBe('preview');
    if (result.mode !== 'preview') {
      throw new Error('Expected a preview result.');
    }
    expect(previewWindow.location.href).toBe('blob:preview');
    expect(revoked).toEqual([]);
    result.cleanup();
    expect(revoked).toEqual(['blob:preview']);
  });

  it('uses manual fallback when a prepared preview window is already closed', () => {
    const previewWindow = { closed: true, location: { href: 'about:blank' } };
    const revoked: string[] = [];
    const anchor = { href: '', click: () => undefined };
    const environment = {
      document: { createElement: () => anchor },
      window: { open: () => null },
      navigator: navigatorLike(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
        'iPhone',
        5,
      ),
      previewWindow,
      url: {
        createObjectURL: () => 'blob:closed-preview',
        revokeObjectURL: (url: string) => revoked.push(url),
      },
      schedule: () => 1,
    } as never;

    const result = openPngBlob(new Blob(['png']), 'share-card.png', environment);

    expect(result.mode).toBe('manual');
    if (result.mode !== 'manual') {
      throw new Error('Expected a manual fallback result.');
    }
    expect(previewWindow.location.href).toBe('about:blank');
    expect(revoked).toEqual([]);
    result.cleanup();
    expect(revoked).toEqual(['blob:closed-preview']);
  });

  it('reports a blocked prepare gesture without pretending a tab exists', () => {
    const environment = {
      document: { createElement: () => ({}) },
      window: { open: () => null },
      navigator: navigatorLike('Safari', 'iPhone', 5),
    } as never;

    expect(preparePngPreview(environment)).toBeNull();
  });
});
