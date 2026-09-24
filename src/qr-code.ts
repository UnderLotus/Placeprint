import qrcode from 'qrcode-generator';
import { stringToBytes as utf8StringToBytes } from 'qrcode-generator/dist/qrcode_UTF8.mjs';

// qrcode-generator ships UTF-8 as an official optional conversion module.
qrcode.stringToBytes = utf8StringToBytes;

export interface QrCodeMatrix {
  value: string;
  moduleCount: number;
  modules: boolean[][];
}

export interface QrCodeResult {
  matrix?: QrCodeMatrix;
  error?: string;
}

export interface QrCodeBox {
  /** Transparent production slot; it is never painted as a QR background. */
  x: number;
  y: number;
  size: number;
  /** Visible dark/light module square used by alignment and animation. */
  visualX: number;
  visualY: number;
  visualSize: number;
  /** Logical encoder quiet-zone width retained for matrix semantics. */
  quietZone: number;
  moduleCount: number;
}

export interface QrCodeModuleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const QR_CODE_ERROR_MESSAGE = 'QR Code 內容過長，請縮短後再試';
export const QR_CODE_BOX_X = 1184;
export const QR_CODE_BOX_Y = 1617;
export const QR_CODE_BOX_SIZE = 288;
export const QR_CODE_VISUAL_X = 1226;
export const QR_CODE_VISUAL_Y = 1659;
export const QR_CODE_VISUAL_SIZE = 203;
export const QR_CODE_QUIET_ZONE = 4;
export const QR_CODE_QUIET_MARGIN_LEFT = QR_CODE_VISUAL_X - QR_CODE_BOX_X;
export const QR_CODE_QUIET_MARGIN_TOP = QR_CODE_VISUAL_Y - QR_CODE_BOX_Y;
export const QR_CODE_QUIET_MARGIN_RIGHT =
  QR_CODE_BOX_X + QR_CODE_BOX_SIZE - (QR_CODE_VISUAL_X + QR_CODE_VISUAL_SIZE);
export const QR_CODE_QUIET_MARGIN_BOTTOM =
  QR_CODE_BOX_Y + QR_CODE_BOX_SIZE - (QR_CODE_VISUAL_Y + QR_CODE_VISUAL_SIZE);

export function createQrCodeResult(value: string): QrCodeResult {
  if (!value.trim()) {
    return {};
  }

  try {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const moduleCount = code.getModuleCount();
    const modules = Array.from({ length: moduleCount }, (_, row) =>
      Array.from({ length: moduleCount }, (_, column) => code.isDark(row, column)),
    );
    return {
      matrix: { value, moduleCount, modules },
    };
  } catch {
    return { error: QR_CODE_ERROR_MESSAGE };
  }
}

export function createQrCodeMatrix(value: string): QrCodeMatrix | undefined {
  return createQrCodeResult(value).matrix;
}

export function createQrCodeBox(
  matrix: Pick<QrCodeMatrix, 'moduleCount'>,
): QrCodeBox {
  return {
    x: QR_CODE_BOX_X,
    y: QR_CODE_BOX_Y,
    size: QR_CODE_BOX_SIZE,
    visualX: QR_CODE_VISUAL_X,
    visualY: QR_CODE_VISUAL_Y,
    visualSize: QR_CODE_VISUAL_SIZE,
    quietZone: QR_CODE_QUIET_ZONE,
    moduleCount: matrix.moduleCount,
  };
}

/** The production integer partition boundary for one module axis. */
export function qrModuleBoundary(
  visualStart: number,
  visualSize: number,
  moduleIndex: number,
  moduleCount: number,
): number {
  if (!Number.isInteger(moduleIndex) || moduleIndex < 0 || moduleIndex > moduleCount) {
    throw new RangeError('QR module index is outside the partition.');
  }
  if (!Number.isInteger(moduleCount) || moduleCount <= 0) {
    throw new RangeError('QR module count must be a positive integer.');
  }
  return visualStart + Math.floor((moduleIndex * visualSize) / moduleCount);
}

export function createQrModuleBoundaries(
  visualStart: number,
  visualSize: number,
  moduleCount: number,
): number[] {
  return Array.from({ length: moduleCount + 1 }, (_, index) =>
    qrModuleBoundary(visualStart, visualSize, index, moduleCount),
  );
}

export function createQrCodeModuleRect(
  box: Pick<QrCodeBox, 'visualX' | 'visualY' | 'visualSize' | 'moduleCount'>,
  row: number,
  column: number,
  moduleCount = box.moduleCount,
): QrCodeModuleRect {
  const xBoundaries = createQrModuleBoundaries(box.visualX, box.visualSize, moduleCount);
  const yBoundaries = createQrModuleBoundaries(box.visualY, box.visualSize, moduleCount);
  if (!Number.isInteger(row) || row < 0 || row >= moduleCount ||
      !Number.isInteger(column) || column < 0 || column >= moduleCount) {
    throw new RangeError('QR module coordinate is outside the matrix.');
  }
  return {
    x: xBoundaries[column],
    y: yBoundaries[row],
    width: xBoundaries[column + 1] - xBoundaries[column],
    height: yBoundaries[row + 1] - yBoundaries[row],
  };
}

export function drawQrCode(
  context: CanvasRenderingContext2D,
  matrix: QrCodeMatrix,
  box: QrCodeBox,
  color: string,
  alpha = 1,
): void {
  const progress = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1));
  context.save();
  context.imageSmoothingEnabled = false;
  context.globalAlpha = progress;
  context.fillStyle = color;
  const xBoundaries = createQrModuleBoundaries(box.visualX, box.visualSize, matrix.moduleCount);
  const yBoundaries = createQrModuleBoundaries(box.visualY, box.visualSize, matrix.moduleCount);
  for (let row = 0; row < matrix.moduleCount; row += 1) {
    for (let column = 0; column < matrix.moduleCount; column += 1) {
      if (!matrix.modules[row][column]) {
        continue;
      }
      context.fillRect(
        xBoundaries[column],
        yBoundaries[row],
        xBoundaries[column + 1] - xBoundaries[column],
        yBoundaries[row + 1] - yBoundaries[row],
      );
    }
  }
  context.globalAlpha = 1;
  context.restore();
}
