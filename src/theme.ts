export type ThemeId = 'nando' | 'koubai' | 'konjou' | 'kincha';

export interface ThemeMetadata {
  readonly id: ThemeId;
  readonly label: string;
}

export interface ThemeOption extends ThemeMetadata {
  readonly swatch: string;
}

export const THEME_IDS = ['nando', 'koubai', 'konjou', 'kincha'] as const satisfies readonly ThemeId[];
export const DEFAULT_THEME_ID: ThemeId = 'nando';
export const THEME_STORAGE_KEY = 'placeprint:theme:v1';

export const THEME_METADATA: Readonly<Record<ThemeId, ThemeMetadata>> = {
  nando: { id: 'nando', label: '納戸' },
  koubai: { id: 'koubai', label: '紅梅' },
  konjou: { id: 'konjou', label: '紺青' },
  kincha: { id: 'kincha', label: '金茶' },
};

export const ACTIVE_THEME_OPTIONS: readonly ThemeOption[] = [
  { ...THEME_METADATA.nando, swatch: '#087f8a' },
  { ...THEME_METADATA.koubai, swatch: '#e16b8c' },
  { ...THEME_METADATA.konjou, swatch: '#113285' },
  { ...THEME_METADATA.kincha, swatch: '#c7802d' },
];

export function parseThemeId(value: unknown): ThemeId | null {
  if (typeof value !== 'string') return null;
  return ACTIVE_THEME_OPTIONS.some((option) => option.id === value)
    ? value as ThemeId
    : null;
}

export function readThemePreference(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): ThemeId {
  if (!storage) return DEFAULT_THEME_ID;
  try {
    return parseThemeId(storage.getItem(THEME_STORAGE_KEY)) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function writeThemePreference(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  value: unknown,
): boolean {
  const themeId = parseThemeId(value);
  if (!storage || !themeId) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, themeId);
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(root: Pick<HTMLElement, 'dataset'>, value: unknown): ThemeId {
  const themeId = parseThemeId(value) ?? DEFAULT_THEME_ID;
  root.dataset.theme = themeId;
  return themeId;
}

export interface ShareCardPalette {
  photoPlaceholder: string;
  paper: string;
  primary: string;
  rating: string;
  category: string;
  hours: string;
  secondary: string;
  qr: string;
}

export interface PreviewPalette {
  navigatorSurface: string;
  navigatorTint: string;
  navigatorStroke: string;
}

export const NANDO_SHARE_CARD_PALETTE: Readonly<ShareCardPalette> = {
  photoPlaceholder: '#dcebe8',
  paper: '#fbfbf6',
  primary: '#12363c',
  rating: '#0a969c',
  category: '#345b61',
  hours: '#087f8a',
  secondary: '#547277',
  qr: '#12363c',
};

export const NANDO_PREVIEW_PALETTE: Readonly<PreviewPalette> = {
  navigatorSurface: 'rgba(255, 255, 252, 0.84)',
  navigatorTint: 'rgba(8, 127, 138, 0.12)',
  navigatorStroke: '#087f8a',
};

type CssColorSource = Pick<CSSStyleDeclaration, 'getPropertyValue'>;

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const FUNCTION_COLOR = /^(?:rgba?|hsla?)\(\s*[\d.%+-]+(?:[\s,/]+[\d.%+-]+){2,3}\s*\)$/i;
const NAMED_COLOR = /^(?:transparent|currentcolor)$/i;

function readColor(
  style: CssColorSource,
  property: string,
  fallback: string,
): string {
  const value = style.getPropertyValue(property).trim();
  return HEX_COLOR.test(value) || FUNCTION_COLOR.test(value) || NAMED_COLOR.test(value)
    ? value
    : fallback;
}

export function readShareCardPalette(style: CssColorSource): ShareCardPalette {
  return {
    photoPlaceholder: readColor(style, '--card-photo', NANDO_SHARE_CARD_PALETTE.photoPlaceholder),
    paper: readColor(style, '--card-paper', NANDO_SHARE_CARD_PALETTE.paper),
    primary: readColor(style, '--card-primary', NANDO_SHARE_CARD_PALETTE.primary),
    rating: readColor(style, '--card-rating', NANDO_SHARE_CARD_PALETTE.rating),
    category: readColor(style, '--card-category', NANDO_SHARE_CARD_PALETTE.category),
    hours: readColor(style, '--card-hours', NANDO_SHARE_CARD_PALETTE.hours),
    secondary: readColor(style, '--card-secondary', NANDO_SHARE_CARD_PALETTE.secondary),
    qr: readColor(style, '--card-qr', NANDO_SHARE_CARD_PALETTE.qr),
  };
}

export function readPreviewPalette(style: CssColorSource): PreviewPalette {
  return {
    navigatorSurface: readColor(style, '--surface-a84', NANDO_PREVIEW_PALETTE.navigatorSurface),
    navigatorTint: readColor(style, '--navigator-tint', NANDO_PREVIEW_PALETTE.navigatorTint),
    navigatorStroke: readColor(style, '--navigator-stroke', NANDO_PREVIEW_PALETTE.navigatorStroke),
  };
}

export function readPalettes(style: CssColorSource): {
  shareCard: ShareCardPalette;
  preview: PreviewPalette;
} {
  return {
    shareCard: readShareCardPalette(style),
    preview: readPreviewPalette(style),
  };
}
