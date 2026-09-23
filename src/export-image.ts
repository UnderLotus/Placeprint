export interface ExportEnvironment {
  document: Document;
  window: Window;
  navigator: Navigator;
  url: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  schedule: (callback: () => void, delay: number) => number;
  previewWindow?: Window | null;
}

export type PngExportResult =
  | { mode: 'download' }
  | { mode: 'preview'; url: string; cleanup: () => void }
  | { mode: 'manual'; url: string; cleanup: () => void };

export function beginExportGeneration(currentGeneration: number): number {
  return currentGeneration + 1;
}

export function invalidateExportGeneration(currentGeneration: number): number {
  return currentGeneration + 1;
}

export function isCurrentExportGeneration(
  currentGeneration: number,
  token: number,
): boolean {
  return currentGeneration === token;
}

export function createBrowserExportEnvironment(
  previewWindow: Window | null = null,
): ExportEnvironment {
  return {
    document,
    window,
    navigator,
    url: URL,
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    previewWindow,
  };
}

export function isIosSafari(
  navigator: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>,
): boolean {
  const userAgent = navigator.userAgent;
  const iosDevice = /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const alternateIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
  return iosDevice && !alternateIosBrowser && /Safari/i.test(userAgent);
}

export function choosePngExportMode(options: {
  downloadAttributeSupported: boolean;
  iosSafari: boolean;
}): 'download' | 'preview' {
  // iOS Safari can expose HTMLAnchorElement.download while still refusing a
  // programmatic blob download, so use the long-press-friendly preview there.
  return options.iosSafari || !options.downloadAttributeSupported
    ? 'preview'
    : 'download';
}

export function supportsDownloadAttribute(document: Document): boolean {
  return 'download' in document.createElement('a');
}

function createManagedObjectUrl(
  blob: Blob,
  environment: ExportEnvironment,
): { url: string; cleanup: () => void } {
  const url = environment.url.createObjectURL(blob);
  let cleaned = false;
  return {
    url,
    cleanup: () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      environment.url.revokeObjectURL(url);
    },
  };
}

/**
 * Use a direct download where reliable. Preview mode trusts only the window
 * returned by preparePngPreview; otherwise the caller gets a visible manual
 * fallback URL whose cleanup is owned by the current export state.
 */
export function openPngBlob(
  blob: Blob,
  filename: string,
  environment: ExportEnvironment = createBrowserExportEnvironment(),
): PngExportResult {
  const managed = createManagedObjectUrl(blob, environment);
  const mode = choosePngExportMode({
    downloadAttributeSupported: supportsDownloadAttribute(environment.document),
    iosSafari: isIosSafari(environment.navigator),
  });

  if (mode === 'download') {
    const link = environment.document.createElement('a');
    link.href = managed.url;
    link.download = filename;
    link.click();
    environment.schedule(managed.cleanup, 0);
    return { mode: 'download' };
  }

  if (environment.previewWindow && !environment.previewWindow.closed) {
    try {
      environment.previewWindow.location.href = managed.url;
      return { mode: 'preview', ...managed };
    } catch {
      // A tab closed during encoding is equivalent to a blocked preview.
    }
  }

  return { mode: 'manual', ...managed };
}

/** Open a user-gesture-owned blank tab before an asynchronous PNG encode. */
export function preparePngPreview(
  environment: ExportEnvironment = createBrowserExportEnvironment(),
): Window | null {
  const mode = choosePngExportMode({
    downloadAttributeSupported: supportsDownloadAttribute(environment.document),
    iosSafari: isIosSafari(environment.navigator),
  });
  if (mode !== 'preview') {
    return null;
  }
  try {
    return environment.window.open('', '_blank');
  } catch {
    return null;
  }
}
