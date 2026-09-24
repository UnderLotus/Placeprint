import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_THEME_OPTIONS,
  DEFAULT_THEME_ID,
  NANDO_PREVIEW_PALETTE,
  NANDO_SHARE_CARD_PALETTE,
  THEME_STORAGE_KEY,
  applyTheme,
  parseThemeId,
  readPalettes,
  readPreviewPalette,
  readShareCardPalette,
  readThemePreference,
  writeThemePreference,
} from './theme';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const styles = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

function cssDeclarations(themeId: string): Map<string, string> {
  const selector = themeId === 'nando' ? ':root' : `html[data-theme='${themeId}']`;
  const start = styles.indexOf(selector);
  const open = styles.indexOf('{', start);
  const close = styles.indexOf('}', open);
  if (start < 0 || open < 0 || close < 0) throw new Error('Missing CSS palette for ' + themeId);
  return new Map([...styles.slice(open + 1, close).matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)]
    .map((match) => [match[1], match[2].trim()]));
}

function rootStyle(): Pick<CSSStyleDeclaration, 'getPropertyValue'> {
  const root = cssDeclarations('nando');
  return { getPropertyValue: (name) => root.get(name) ?? '' };
}

function memoryStorage(initial: string | null = null): Storage {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    removeItem: () => { value = null; },
    clear: () => { value = null; },
    key: () => null,
    get length() { return value === null ? 0 : 1; },
  } as Storage;
}

type CorePalette = {
  id: string;
  label: string;
  identity: string;
  page: string;
  surface: string;
  ink: string;
  muted: string;
  action: string;
  photo: string;
  paper: string;
  primary: string;
  rating: string;
  category: string;
  hours: string;
  secondary: string;
  qr: string;
};

const palettes: CorePalette[] = [
  {
    id: 'nando', label: '納戸', identity: '#087f8a', page: '#eef6f4',
    surface: 'rgba(255, 255, 252, 0.86)', ink: '#12363c', muted: '#547277', action: '#087f8a',
    photo: '#dcebe8', paper: '#fbfbf6', primary: '#12363c', rating: '#0a969c',
    category: '#345b61', hours: '#087f8a', secondary: '#547277', qr: '#12363c',
  },
  {
    id: 'koubai', label: '紅梅', identity: '#e16b8c', page: '#f8f1f4',
    surface: 'rgba(255, 252, 253, 0.88)', ink: '#462832', muted: '#765c64', action: '#a43e5e',
    photo: '#f0dee4', paper: '#fff9fa', primary: '#462832', rating: '#b54868',
    category: '#684852', hours: '#a43e5e', secondary: '#765c64', qr: '#462832',
  },
  {
    id: 'konjou', label: '紺青', identity: '#113285', page: '#f0f2f8',
    surface: 'rgba(253, 253, 255, 0.88)', ink: '#1e2945', muted: '#59637a', action: '#113285',
    photo: '#dde3f0', paper: '#fbfcff', primary: '#1e2945', rating: '#315db2',
    category: '#3e4d6d', hours: '#113285', secondary: '#59637a', qr: '#1e2945',
  },
  {
    id: 'kincha', label: '金茶', identity: '#c7802d', page: '#f8f3eb',
    surface: 'rgba(255, 253, 249, 0.88)', ink: '#432f1f', muted: '#756554', action: '#8d571c',
    photo: '#efe2d1', paper: '#fffcf7', primary: '#432f1f', rating: '#a66620',
    category: '#69533b', hours: '#8d571c', secondary: '#756554', qr: '#432f1f',
  },
];

function colorChannels(color: string): number[] {
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!hex) throw new Error('Expected a hex color, received: ' + color);
  const expanded = hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex;
  return expanded.match(/[\da-f]{2}/gi)!.map((part) => parseInt(part, 16));
}

function luminance(color: string): number {
  const channels = colorChannels(color).map((channel) => channel / 255).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('computed palette reader', () => {
  it('reads nando root CSS palettes equal to the nando defaults', () => {
    const style = rootStyle();
    expect(readShareCardPalette(style)).toEqual(NANDO_SHARE_CARD_PALETTE);
    expect(readPreviewPalette(style)).toEqual(NANDO_PREVIEW_PALETTE);
    expect(readPalettes(style)).toEqual({
      shareCard: NANDO_SHARE_CARD_PALETTE,
      preview: NANDO_PREVIEW_PALETTE,
    });
  });

  it('falls back to nando colors for missing, empty, or invalid computed values', () => {
    const style = {
      getPropertyValue: (name: string) => ({
        '--card-primary': '',
        '--card-qr': 'url(https://example.test/ink)',
        '--surface-a84': 'not-a-color',
      })[name] ?? '',
    };
    expect(readPalettes(style)).toEqual({
      shareCard: NANDO_SHARE_CARD_PALETTE,
      preview: NANDO_PREVIEW_PALETTE,
    });
  });

  it('reads each current palette afresh rather than retaining an earlier value', () => {
    const style = (primary: string) => ({
      getPropertyValue: (name: string) => name === '--card-primary' ? primary : '',
    });
    expect(readShareCardPalette(style('#102030')).primary).toBe('#102030');
    expect(readShareCardPalette(style('#405060')).primary).toBe('#405060');
  });
});

describe('theme preference', () => {
  it('defines the default theme, storage key, and accepted IDs', () => {
    expect(DEFAULT_THEME_ID).toBe('nando');
    expect(THEME_STORAGE_KEY).toBe('placeprint:theme:v1');
    for (const id of ['nando', 'koubai', 'konjou', 'kincha'] as const) {
      expect(parseThemeId(id)).toBe(id);
    }
    expect(parseThemeId('unknown')).toBeNull();
  });

  it('falls back to nando for invalid, absent, or throwing storage reads', () => {
    expect(readThemePreference(memoryStorage('nando'))).toBe('nando');
    expect(readThemePreference(memoryStorage('koubai'))).toBe('koubai');
    expect(readThemePreference(memoryStorage('unsupported'))).toBe('nando');
    expect(readThemePreference(memoryStorage('{not-json'))).toBe('nando');
    expect(readThemePreference(null)).toBe('nando');
    const blocked = { getItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(readThemePreference(blocked)).toBe('nando');
  });

  it('stores and applies every active theme while rejecting unsupported values', () => {
    const storage = memoryStorage();
    const root = { dataset: {} } as HTMLElement;
    for (const id of ['nando', 'koubai', 'konjou', 'kincha'] as const) {
      expect(writeThemePreference(storage, id)).toBe(true);
      expect(storage.getItem(THEME_STORAGE_KEY)).toBe(id);
      expect(applyTheme(root, id)).toBe(id);
      expect(root.dataset.theme).toBe(id);
      expect(readThemePreference(storage)).toBe(id);
    }
    expect(writeThemePreference(storage, 'not-a-theme')).toBe(false);
    expect(applyTheme(root, 'not-a-theme')).toBe('nando');
    const blocked = { setItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(writeThemePreference(blocked, 'nando')).toBe(false);
  });
});

describe('core theme palettes', () => {
  it('keeps the approved identities and maps core UI and Share Card roles', () => {
    expect(ACTIVE_THEME_OPTIONS.map(({ id, label, swatch }) => [id, label, swatch])).toEqual(
      palettes.map(({ id, label, identity }) => [id, label, identity]),
    );

    for (const palette of palettes) {
      const values = cssDeclarations(palette.id);
      const roles: Record<string, string> = {
        '--theme-page': palette.page,
        '--theme-ink': palette.ink,
        '--theme-muted': palette.muted,
        '--theme-action': palette.action,
        '--theme-kofi': palette.action,
        '--card-photo': palette.photo,
        '--card-paper': palette.paper,
        '--card-primary': palette.primary,
        '--card-rating': palette.rating,
        '--card-category': palette.category,
        '--card-hours': palette.hours,
        '--card-secondary': palette.secondary,
        '--card-qr': palette.qr,
      };
      for (const [name, expected] of Object.entries(roles)) {
        expect(values.get(name), `${palette.id} ${name}`).toBe(expected);
      }
      const surface = values.get('--theme-surface');
      const resolvedSurface = surface?.startsWith('var(')
        ? values.get(surface.slice(4, -1))
        : surface;
      expect(resolvedSurface, `${palette.id} surface`).toBe(palette.surface);

      const rendered = readPalettes({ getPropertyValue: (name) => values.get(name) ?? '' });
      expect(rendered.shareCard).toEqual({
        photoPlaceholder: palette.photo,
        paper: palette.paper,
        primary: palette.primary,
        rating: palette.rating,
        category: palette.category,
        hours: palette.hours,
        secondary: palette.secondary,
        qr: palette.qr,
      });
    }
  });

  it('keeps applicable UI, action-label, and Share Card text at WCAG AA contrast', () => {
    for (const palette of palettes) {
      expect(contrast(palette.action, '#ffffff'), `${palette.id} action / white`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.ink, palette.page), `${palette.id} UI ink / page`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.muted, palette.page), `${palette.id} UI muted / page`).toBeGreaterThanOrEqual(4.5);
      for (const text of [palette.primary, palette.category, palette.hours, palette.secondary]) {
        expect(contrast(text, palette.paper), `${palette.id} ${text} / card paper`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('theme first paint', () => {
  it('executes the stored-theme boot before the stylesheet and application module', () => {
    const inlineBoot = /<script>([\s\S]*?)<\/script>/.exec(html);
    expect(inlineBoot).not.toBeNull();
    const stylesheetIndex = html.indexOf('<link rel="stylesheet"');
    const moduleIndex = html.indexOf('src="/src/main.ts"');
    const bootEnd = inlineBoot!.index + inlineBoot![0].length;
    expect(bootEnd).toBeLessThan(stylesheetIndex);
    expect(bootEnd).toBeLessThan(moduleIndex);

    const runBoot = (storedTheme: string | null, blocked = false) => {
      const root: { dataset: Record<string, string> } = { dataset: {} };
      const fakeWindow = blocked
        ? Object.defineProperty({}, 'localStorage', { get: () => { throw new Error('storage unavailable'); } })
        : { localStorage: { getItem: () => storedTheme } };
      new Function('window', 'document', inlineBoot![1])(
        fakeWindow,
        { documentElement: root },
      );
      return root.dataset.theme;
    };

    for (const id of ['nando', 'koubai', 'konjou', 'kincha']) expect(runBoot(id)).toBe(id);
    expect(runBoot('unsupported')).toBeUndefined();
    expect(runBoot(null)).toBeUndefined();
    expect(runBoot('kincha', true)).toBeUndefined();
  });
});
