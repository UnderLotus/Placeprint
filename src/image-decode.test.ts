import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heicTo } from 'heic-to/csp';
import {
  decodeShareCardImage,
  isHeicImageCandidate,
  isSupportedImageFile,
} from './image-decode';

vi.mock('heic-to/csp', () => ({
  heicTo: vi.fn(),
}));

const heicToBitmap = heicTo as unknown as (args: { blob: Blob; type: 'bitmap' }) => Promise<ImageBitmap>;
const mockedHeicTo = vi.mocked(heicToBitmap);
let imageLoadResult: 'success' | 'failure' = 'failure';

class FakeImage {
  decoding = '';
  naturalWidth = 640;
  naturalHeight = 480;
  width = 640;
  height = 480;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => {
      if (imageLoadResult === 'success') {
        this.onload?.();
      } else {
        this.onerror?.();
      }
    });
  }
}

function file(name: string, type: string): File {
  return new File(['fixture'], name, { type });
}

function bitmap(width = 1536, height = 2048): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

beforeEach(() => {
  imageLoadResult = 'failure';
  mockedHeicTo.mockReset();
  vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('image file classification', () => {
  it('recognizes HEIC/HEIF MIME types and extensions as decoder candidates', () => {
    expect(isHeicImageCandidate({ name: 'photo.bin', type: 'IMAGE/HEIC' })).toBe(true);
    expect(isHeicImageCandidate({ name: 'photo.bin', type: 'image/heif-sequence' })).toBe(true);
    expect(isHeicImageCandidate({ name: 'photo.HEIF', type: '' })).toBe(true);
    expect(isHeicImageCandidate({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(false);
  });

  it('allows image MIME files and blank-MIME HEIC/HEIF extensions only', () => {
    expect(isSupportedImageFile({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(true);
    expect(isSupportedImageFile({ name: 'photo.heic', type: 'image/heic' })).toBe(true);
    expect(isSupportedImageFile({ name: 'photo.heif', type: '' })).toBe(true);
    expect(isSupportedImageFile({ name: 'photo.jpg', type: '' })).toBe(false);
    expect(isSupportedImageFile({ name: 'photo.heic', type: 'application/octet-stream' })).toBe(false);
    expect(isSupportedImageFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
  });
});

describe('decodeShareCardImage', () => {
  it('uses a successful native bitmap without importing the HEIC decoder', async () => {
    const decoded = bitmap();
    const nativeDecode = vi.fn().mockResolvedValue(decoded);
    vi.stubGlobal('createImageBitmap', nativeDecode);

    const result = await decodeShareCardImage(
      file('photo.jpg', 'image/jpeg'),
      'blob:photo',
    );

    expect(nativeDecode).toHaveBeenCalledWith(expect.any(File), {
      imageOrientation: 'from-image',
    });
    expect(result.source).toBe(decoded);
    expect(result.width).toBe(1536);
    expect(result.naturalHeight).toBe(2048);
    expect(result.orientation).toBe(1);
    expect(mockedHeicTo).not.toHaveBeenCalled();
  });

  it('tries the browser image element after native bitmap failure without importing HEIC', async () => {
    const nativeDecode = vi.fn().mockRejectedValue(new Error('bitmap unavailable'));
    vi.stubGlobal('createImageBitmap', nativeDecode);
    imageLoadResult = 'success';

    const result = await decodeShareCardImage(
      file('photo.jpg', 'image/jpeg'),
      'blob:photo',
    );

    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
    expect(result.orientation).toBe(1);
    expect(mockedHeicTo).not.toHaveBeenCalled();
  });

  it('does not import HEIC for a non-HEIC file when both native paths fail', async () => {
    const nativeDecode = vi.fn().mockRejectedValue(new Error('bitmap unavailable'));
    vi.stubGlobal('createImageBitmap', nativeDecode);

    await expect(
      decodeShareCardImage(file('photo.png', 'image/png'), 'blob:photo'),
    ).rejects.toThrow('The local image could not be decoded.');
    expect(mockedHeicTo).not.toHaveBeenCalled();
  });

  it('falls back to heic-to only after both native paths fail', async () => {
    const nativeDecode = vi.fn().mockRejectedValue(new Error('bitmap unavailable'));
    const decoded = bitmap(1536, 2048);
    vi.stubGlobal('createImageBitmap', nativeDecode);
    mockedHeicTo.mockResolvedValue(decoded);

    const input = file('photo.heic', '');
    const result = await decodeShareCardImage(input, 'blob:photo');

    expect(mockedHeicTo).toHaveBeenCalledWith({
      blob: input,
      type: 'bitmap',
    });
    expect(result.source).toBe(decoded);
    expect(result.naturalWidth).toBe(1536);
    expect(result.naturalHeight).toBe(2048);
    expect(result.orientation).toBe(1);
    result.release?.();
    expect(decoded.close).toHaveBeenCalledOnce();
  });

  it('propagates HEIC decoder failure after native paths fail', async () => {
    const nativeDecode = vi.fn().mockRejectedValue(new Error('bitmap unavailable'));
    vi.stubGlobal('createImageBitmap', nativeDecode);
    mockedHeicTo.mockRejectedValue(new Error('worker failed'));

    await expect(
      decodeShareCardImage(file('photo.heif', 'image/heif'), 'blob:photo'),
    ).rejects.toThrow('worker failed');
    expect(mockedHeicTo).toHaveBeenCalledOnce();
  });
});
