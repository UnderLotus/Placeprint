import qrcode from 'qrcode-generator';
import { stringToBytes as utf8StringToBytes } from 'qrcode-generator/dist/qrcode_UTF8.mjs';
import { describe, expect, it } from 'vitest';
import {
  createQrCodeBox,
  createQrCodeMatrix,
  createQrCodeModuleRect,
  createQrCodeResult,
  qrModuleBoundary,
  drawQrCode,
  QR_CODE_BOX_SIZE,
  QR_CODE_BOX_X,
  QR_CODE_BOX_Y,
  QR_CODE_ERROR_MESSAGE,
  QR_CODE_QUIET_MARGIN_BOTTOM,
  QR_CODE_QUIET_MARGIN_LEFT,
  QR_CODE_QUIET_MARGIN_RIGHT,
  QR_CODE_QUIET_MARGIN_TOP,
  QR_CODE_QUIET_ZONE,
  QR_CODE_VISUAL_SIZE,
  QR_CODE_VISUAL_X,
  QR_CODE_VISUAL_Y,
} from './qr-code';

function independentlyEncodedMatrix(value: string): {
  moduleCount: number;
  modules: boolean[][];
} {
  qrcode.stringToBytes = utf8StringToBytes;
  const code = qrcode(0, 'M');
  code.addData(value);
  code.make();
  const moduleCount = code.getModuleCount();
  return {
    moduleCount,
    modules: Array.from({ length: moduleCount }, (_, row) =>
      Array.from({ length: moduleCount }, (_, column) => code.isDark(row, column)),
    ),
  };
}

describe('QR Code Canvas seam', () => {
  it('preserves raw UTF-8 values and exact module encoding for CJK, Japanese, and emoji', () => {
    const values = [
      'https://www.google.com/maps/place/海風書店',
      'https://example.com/海風書店',
      'https://example.com/東京カフェ',
      'custom URL 😀',
    ];

    for (const value of values) {
      const matrix = createQrCodeMatrix(value);
      const expected = independentlyEncodedMatrix(value);
      expect(matrix).toMatchObject({ value, moduleCount: expected.moduleCount, modules: expected.modules });
      expect(matrix?.modules.flat().some(Boolean)).toBe(true);
    }

    const sea = createQrCodeMatrix('海');
    const seaExpected = independentlyEncodedMatrix('海');
    const w = independentlyEncodedMatrix('w');
    expect(sea).toMatchObject({ value: '海', moduleCount: seaExpected.moduleCount, modules: seaExpected.modules });
    expect(sea?.modules).not.toEqual(w.modules);
  });

  it('reports byte-capacity failures without throwing and encodes raw surrounding whitespace', () => {
    expect(createQrCodeResult('   ')).toEqual({});
    const padded = '  https://example.com/海風書店  ';
    const paddedResult = createQrCodeResult(padded);
    const paddedExpected = independentlyEncodedMatrix(padded);
    expect(paddedResult.matrix).toMatchObject({
      value: padded,
      moduleCount: paddedExpected.moduleCount,
      modules: paddedExpected.modules,
    });

    const overflow = createQrCodeResult('海'.repeat(1000));
    expect(overflow.matrix).toBeUndefined();
    expect(overflow.error).toBe(QR_CODE_ERROR_MESSAGE);
  });

  it.each([
    'a',
    'https://example.com/ticket23/ordinary-payload',
    'https://example.com/ticket23/較長的可編碼內容/'.repeat(5),
  ])('uses one fixed visible square for an encodable payload: %s', (value) => {
    const matrix = createQrCodeMatrix(value);
    expect(matrix).toBeDefined();
    const box = createQrCodeBox(matrix!);
    expect(box).toMatchObject({
      x: QR_CODE_BOX_X,
      y: QR_CODE_BOX_Y,
      size: QR_CODE_BOX_SIZE,
      visualX: QR_CODE_VISUAL_X,
      visualY: QR_CODE_VISUAL_Y,
      visualSize: QR_CODE_VISUAL_SIZE,
      quietZone: QR_CODE_QUIET_ZONE,
    });
    expect({
      left: box.visualX - box.x,
      top: box.visualY - box.y,
      right: box.x + box.size - (box.visualX + box.visualSize),
      bottom: box.y + box.size - (box.visualY + box.visualSize),
    }).toEqual({
      left: QR_CODE_QUIET_MARGIN_LEFT,
      top: QR_CODE_QUIET_MARGIN_TOP,
      right: QR_CODE_QUIET_MARGIN_RIGHT,
      bottom: QR_CODE_QUIET_MARGIN_BOTTOM,
    });
    expect({
      left: QR_CODE_QUIET_MARGIN_LEFT,
      top: QR_CODE_QUIET_MARGIN_TOP,
      right: QR_CODE_QUIET_MARGIN_RIGHT,
      bottom: QR_CODE_QUIET_MARGIN_BOTTOM,
    }).toEqual({ left: 42, top: 42, right: 43, bottom: 43 });
  });

  it('partitions every module with integer boundaries covering exactly 203px', () => {
    const values = [
      'a',
      'https://example.com/ticket23/ordinary-payload',
      'https://example.com/ticket23/較長的可編碼內容/'.repeat(5),
    ];
    for (const value of values) {
      const matrix = createQrCodeMatrix(value)!;
      const box = createQrCodeBox(matrix);
      const expectedX = Array.from({ length: matrix.moduleCount + 1 }, (_, index) =>
        box.visualX + Math.floor((index * box.visualSize) / matrix.moduleCount),
      );
      const expectedY = Array.from({ length: matrix.moduleCount + 1 }, (_, index) =>
        box.visualY + Math.floor((index * box.visualSize) / matrix.moduleCount),
      );
      for (const boundaries of [expectedX, expectedY]) {
        const widths = boundaries.slice(1).map((boundary, index) => boundary - boundaries[index]);
        expect(boundaries.every((boundary) => Number.isInteger(boundary))).toBe(true);
        expect(boundaries.slice(1).every((boundary, index) => boundary > boundaries[index])).toBe(true);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      }
      expect(expectedX[0]).toBe(box.visualX);
      expect(expectedX.at(-1)).toBe(box.visualX + box.visualSize);
      expect(expectedY[0]).toBe(box.visualY);
      expect(expectedY.at(-1)).toBe(box.visualY + box.visualSize);
      expect(expectedX).toEqual(expectedX.map((_, index) =>
        qrModuleBoundary(box.visualX, box.visualSize, index, matrix.moduleCount),
      ));
      expect(expectedY).toEqual(expectedY.map((_, index) =>
        qrModuleBoundary(box.visualY, box.visualSize, index, matrix.moduleCount),
      ));

      const sampleIndices = [...new Set([0, Math.floor(matrix.moduleCount / 2), matrix.moduleCount - 1])];
      for (const row of sampleIndices) {
        for (const column of sampleIndices) {
          expect(createQrCodeModuleRect(box, row, column)).toEqual({
            x: expectedX[column],
            y: expectedY[row],
            width: expectedX[column + 1] - expectedX[column],
            height: expectedY[row + 1] - expectedY[row],
          });
        }
      }
    }
  });

  it('draws only dark integer module rectangles in the visible square and never paints quiet margins', () => {
    const matrix = createQrCodeMatrix('custom QR payload')!;
    const box = createQrCodeBox(matrix);
    const calls: Array<[number, number, number, number]> = [];
    const fillStyles: string[] = [];
    let activeFillStyle = '';
    const context = {
      save: () => undefined,
      restore: () => undefined,
      fillRect: (x: number, y: number, width: number, height: number) => {
        calls.push([x, y, width, height]);
        fillStyles.push(activeFillStyle);
      },
      fillStyle: '',
      globalAlpha: 1,
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(context, 'fillStyle', {
      configurable: true,
      get: () => activeFillStyle,
      set: (value: string) => {
        activeFillStyle = value;
      },
    });

    drawQrCode(context, matrix, box);

    expect(calls).toHaveLength(matrix.modules.flat().filter(Boolean).length);
    expect(fillStyles.every((fillStyle) => fillStyle === '#12363c')).toBe(true);
    for (const [x, y, width, height] of calls) {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
      expect(Number.isInteger(width)).toBe(true);
      expect(Number.isInteger(height)).toBe(true);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(x).toBeGreaterThanOrEqual(box.visualX);
      expect(y).toBeGreaterThanOrEqual(box.visualY);
      expect(x + width).toBeLessThanOrEqual(box.visualX + box.visualSize);
      expect(y + height).toBeLessThanOrEqual(box.visualY + box.visualSize);
      expect(x < box.x + box.size).toBe(true);
      expect(y < box.y + box.size).toBe(true);
    }
  });

  it('does not create or draw a box for an empty value', () => {
    expect(createQrCodeMatrix('')).toBeUndefined();
  });
});
