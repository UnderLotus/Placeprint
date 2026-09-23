import { readJpegOrientation, type JpegOrientation } from './image-orientation';
import type { ShareCardImage } from './share-card';

const ORIENTATION_PROBE_BYTES = 128 * 1024;
const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);
const HEIC_EXTENSION = /\.(?:heic|heif)$/i;

export type ImageFileMetadata = Pick<File, 'name' | 'type'>;

function normalizedMimeType(type: string): string {
  return type.trim().toLowerCase();
}

function hasHeicExtension(name: string): boolean {
  return HEIC_EXTENSION.test(name.trim());
}

/** Identify HEIC/HEIF by the browser MIME or the local filename extension. */
export function isHeicImageCandidate(file: ImageFileMetadata): boolean {
  const mimeType = normalizedMimeType(file.type);
  return HEIC_MIME_TYPES.has(mimeType) || hasHeicExtension(file.name);
}

/** Accept browser image MIME types, plus HEIC/HEIF files whose MIME is blank. */
export function isSupportedImageFile(file: ImageFileMetadata): boolean {
  const mimeType = normalizedMimeType(file.type);
  if (mimeType) {
    return mimeType.startsWith('image/');
  }
  return hasHeicExtension(file.name);
}

async function readOrientation(file: File): Promise<JpegOrientation> {
  if (normalizedMimeType(file.type) !== 'image/jpeg') {
    return 1;
  }
  try {
    const bytes = await file.slice(0, ORIENTATION_PROBE_BYTES).arrayBuffer();
    return readJpegOrientation(bytes);
  } catch {
    return 1;
  }
}

function imageElementSource(
  objectUrl: string,
  orientation: JpegOrientation,
): Promise<ShareCardImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      // Current browsers expose orientation-applied decoded dimensions for
      // <img>; drawImage consumes the same decoded source without another turn.
      resolve({
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        width: image.width,
        height: image.height,
        source: image,
        orientation,
      });
    };
    image.onerror = () => reject(new Error('The local image could not be decoded.'));
    image.src = objectUrl;
  });
}

function imageBitmapSource(
  bitmap: ImageBitmap,
  orientation: JpegOrientation,
): ShareCardImage {
  return {
    naturalWidth: bitmap.width,
    naturalHeight: bitmap.height,
    width: bitmap.width,
    height: bitmap.height,
    source: bitmap,
    orientation,
    release: () => bitmap.close(),
  };
}

async function decodeHeicImage(file: File): Promise<ShareCardImage> {
  const { heicTo } = await import('heic-to/csp');
  const bitmap = await heicTo({
    blob: file,
    type: 'bitmap',
  });
  // libheif/heic-to has already produced the orientation-applied bitmap; do
  // not let the JPEG metadata path rotate it a second time downstream.
  return imageBitmapSource(bitmap, 1);
}

/**
 * Decode a local file once with browser-applied EXIF orientation. Chromium and
 * supporting Safari builds use ImageBitmap's explicit from-image option; the
 * fallback <img> path relies on the browser's own orientation handling. No
 * rotation matrix or intermediate full-size canvas is introduced.
 */
export async function decodeShareCardImage(
  file: File,
  objectUrl: string,
): Promise<ShareCardImage> {
  const orientation = await readOrientation(file);
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      });
      return imageBitmapSource(bitmap, orientation);
    } catch {
      // Some Safari versions expose ImageBitmap partially; use the proven
      // browser-decoded <img> path rather than applying EXIF ourselves.
    }
  }

  try {
    return await imageElementSource(objectUrl, orientation);
  } catch (error) {
    if (!isHeicImageCandidate(file)) {
      throw error;
    }
    return decodeHeicImage(file);
  }
}
