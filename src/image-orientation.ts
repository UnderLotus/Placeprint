export type JpegOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

function readUint16(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint16(offset, littleEndian);
}

function readUint32(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint32(offset, littleEndian);
}

/**
 * Read only the JPEG EXIF orientation tag. The renderer never rotates based
 * on this value: decoded <img>/ImageBitmap sources are requested from-image,
 * so the tag is retained as a small verification seam rather than applied a
 * second time.
 */
export function readJpegOrientation(
  bytes: ArrayBuffer | ArrayLike<number>,
): JpegOrientation {
  const view = bytes instanceof ArrayBuffer
    ? new DataView(bytes)
    : new DataView(Uint8Array.from(bytes).buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return 1;
  }

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      return 1;
    }
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) {
      offset += 1;
    }
    if (offset >= view.byteLength) {
      return 1;
    }
    const marker = view.getUint8(offset);
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) {
      return 1;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      continue;
    }
    if (offset + 2 > view.byteLength) {
      return 1;
    }
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > view.byteLength) {
      return 1;
    }
    const segmentStart = offset + 2;
    if (
      marker === 0xe1 &&
      segmentLength >= 8 &&
      view.getUint8(segmentStart) === 0x45 &&
      view.getUint8(segmentStart + 1) === 0x78 &&
      view.getUint8(segmentStart + 2) === 0x69 &&
      view.getUint8(segmentStart + 3) === 0x66 &&
      view.getUint8(segmentStart + 4) === 0x00 &&
      view.getUint8(segmentStart + 5) === 0x00
    ) {
      const tiffStart = segmentStart + 6;
      if (tiffStart + 8 > view.byteLength) {
        return 1;
      }
      const littleEndian =
        view.getUint8(tiffStart) === 0x49 && view.getUint8(tiffStart + 1) === 0x49;
      const bigEndian =
        view.getUint8(tiffStart) === 0x4d && view.getUint8(tiffStart + 1) === 0x4d;
      if (!littleEndian && !bigEndian) {
        return 1;
      }
      const endian = littleEndian;
      if (readUint16(view, tiffStart + 2, endian) !== 42) {
        return 1;
      }
      const ifdOffset = readUint32(view, tiffStart + 4, endian);
      const ifdStart = tiffStart + ifdOffset;
      if (ifdStart + 2 > view.byteLength) {
        return 1;
      }
      const entryCount = readUint16(view, ifdStart, endian);
      for (let index = 0; index < entryCount; index += 1) {
        const entryStart = ifdStart + 2 + index * 12;
        if (entryStart + 12 > view.byteLength) {
          return 1;
        }
        const tag = readUint16(view, entryStart, endian);
        if (tag !== 0x0112) {
          continue;
        }
        const type = readUint16(view, entryStart + 2, endian);
        const count = readUint32(view, entryStart + 4, endian);
        if (type !== 3 || count < 1) {
          return 1;
        }
        const value = readUint16(view, entryStart + 8, endian);
        return value >= 1 && value <= 8 ? value as JpegOrientation : 1;
      }
      return 1;
    }
    offset += segmentLength;
  }
  return 1;
}

export function hasQuarterTurnOrientation(orientation: JpegOrientation): boolean {
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
}

export function orientedDimensions(
  width: number,
  height: number,
  orientation: JpegOrientation,
): { width: number; height: number } {
  return hasQuarterTurnOrientation(orientation)
    ? { width: height, height: width }
    : { width, height };
}
