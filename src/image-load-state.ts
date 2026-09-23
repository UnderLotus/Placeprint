import type { ShareCardImage } from './share-card';

export interface ImageLoadState {
  image: ShareCardImage | null;
  objectUrl: string | null;
  loading: boolean;
}

export function beginImageLoad(objectUrl: string): ImageLoadState {
  return {
    image: null,
    objectUrl,
    loading: true,
  };
}

export function completeImageLoad(
  state: ImageLoadState,
  objectUrl: string,
  image: ShareCardImage,
): ImageLoadState | null {
  if (state.objectUrl !== objectUrl) {
    return null;
  }
  return {
    image,
    objectUrl,
    loading: false,
  };
}

export function failImageLoad(
  state: ImageLoadState,
  objectUrl: string,
): ImageLoadState | null {
  if (state.objectUrl !== objectUrl) {
    return null;
  }
  return {
    image: null,
    objectUrl: null,
    loading: false,
  };
}

export function canDownload(state: ImageLoadState): boolean {
  return !state.loading;
}

/** Release decoded ImageBitmap resources without assuming every source is one. */
export function releaseImage(image: ShareCardImage | null): void {
  image?.release?.();
}
