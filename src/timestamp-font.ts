export const TIMESTAMP_FONT_STYLESHEET_URL =
  'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap';

export type TimestampFontLoader = (text: string) => void;

export function createTimestampFontLoader(
  documentRef: Document,
  fonts: FontFaceSet,
  onReady: () => void,
): TimestampFontLoader {
  let stylesheetLoad: Promise<void> | null = null;

  const ensureStylesheet = (): Promise<void> => {
    if (!stylesheetLoad) {
      stylesheetLoad = new Promise<void>((resolve, reject) => {
        const link = documentRef.createElement('link');
        link.rel = 'stylesheet';
        link.href = TIMESTAMP_FONT_STYLESHEET_URL;
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => reject(new Error('Share Tech Mono stylesheet failed to load.')), { once: true });
        documentRef.head.append(link);
      });
    }
    return stylesheetLoad;
  };

  return (text: string): void => {
    const currentText = text.trim();
    if (!currentText) {
      return;
    }
    void ensureStylesheet()
      .then(() => fonts.load('400 60px "Share Tech Mono"', currentText))
      .then(() => onReady())
      .catch(() => undefined);
  };
}
