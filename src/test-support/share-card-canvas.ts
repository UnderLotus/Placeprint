export interface RecordedClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordedFillText {
  text: string;
  x: number;
  y: number;
  globalAlpha: number;
  font: string;
  fillStyle: string;
  textBaseline: CanvasTextBaseline;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
  clip: RecordedClip | null;
}

export interface RecordedFillRect {
  x: number;
  y: number;
  width: number;
  height: number;
  globalAlpha: number;
  fillStyle: string;
}

export interface RecordedDrawImage {
  args: unknown[];
}

export interface ShareCardCanvasRecording {
  fillText: RecordedFillText[];
  fillRect: RecordedFillRect[];
  drawImage: RecordedDrawImage[];
  clearRect: RecordedFillRect[];
  clip: RecordedClip[];
}

export interface ShareCardCanvasFixture {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  recording: ShareCardCanvasRecording;
}

export interface ShareCardCanvasOptions {
  measureText?: (text: string, font: string) => Partial<TextMetrics>;
}

function fontSizeFrom(font: string): number {
  const match = /(?:^|\s)(\d+(?:\.\d+)?)px(?:\s|$)/.exec(font);
  const size = match ? Number(match[1]) : 16;
  return Number.isFinite(size) && size > 0 ? size : 16;
}

function isWideGlyph(character: string): boolean {
  return /[\u{2e80}-\u{9fff}\u{f900}-\u{faff}\u{3040}-\u{30ff}\u{ac00}-\u{d7af}\u{ff00}-\u{ffef}\u{1f000}-\u{1faff}]/u.test(character);
}

function relativeGlyphWidth(character: string): number {
  if (/\s/u.test(character)) {
    return 0.33;
  }
  if (isWideGlyph(character)) {
    return 1;
  }
  if (/[A-Za-z0-9]/u.test(character)) {
    return 0.58;
  }
  if (/[.,:;!?()[\]{}'"`\-_/]/u.test(character)) {
    return 0.42;
  }
  return 0.7;
}

function estimateTextWidth(text: string, font: string): number {
  const size = fontSizeFrom(font);
  return Array.from(text).reduce(
    (width, character) => width + size * relativeGlyphWidth(character),
    0,
  );
}

export function createShareCardCanvas(
  options: ShareCardCanvasOptions = {},
): ShareCardCanvasFixture {
  const recording: ShareCardCanvasRecording = {
    fillText: [],
    fillRect: [],
    drawImage: [],
    clearRect: [],
    clip: [],
  };
  let currentPath: RecordedClip | null = null;
  let currentClip: RecordedClip | null = null;
  const stateStack: Array<{
    clip: RecordedClip | null;
    fillStyle: string;
    globalAlpha: number;
  }> = [];

  const intersectClip = (first: RecordedClip, second: RecordedClip): RecordedClip => {
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.height, second.y + second.height);
    const x = Math.max(first.x, second.x);
    const y = Math.max(first.y, second.y);
    return {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
    };
  };

  const context = {
    save: () => {
      stateStack.push({
        clip: currentClip ? { ...currentClip } : null,
        fillStyle: String(context.fillStyle),
        globalAlpha: Number(context.globalAlpha),
      });
    },
    restore: () => {
      const state = stateStack.pop();
      if (!state) {
        return;
      }
      currentClip = state.clip;
      context.fillStyle = state.fillStyle;
      context.globalAlpha = state.globalAlpha;
    },
    beginPath: () => undefined,
    rect: (x: number, y: number, width: number, height: number) => {
      currentPath = { x, y, width, height };
    },
    clip: () => {
      if (currentPath) {
        currentClip = currentClip
          ? intersectClip(currentClip, currentPath)
          : { ...currentPath };
        recording.clip.push({ ...currentClip });
      }
    },
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    strokeRect: () => undefined,
    drawImage: (...args: unknown[]) => {
      recording.drawImage.push({ args });
    },
    fillRect: (x: number, y: number, width: number, height: number) => {
      recording.fillRect.push({
        x,
        y,
        width,
        height,
        globalAlpha: Number(context.globalAlpha),
        fillStyle: String(context.fillStyle),
      });
    },
    clearRect: (x: number, y: number, width: number, height: number) => {
      recording.clearRect.push({ x, y, width, height, globalAlpha: Number(context.globalAlpha), fillStyle: '' });
    },
    measureText: (text: string) => {
      const font = String(context.font);
      const fontSize = fontSizeFrom(font);
      const defaults: TextMetrics = {
        width: estimateTextWidth(text, font),
        actualBoundingBoxAscent: fontSize * 0.8,
        actualBoundingBoxDescent: fontSize * 0.2,
        fontBoundingBoxAscent: fontSize * 0.8,
        fontBoundingBoxDescent: fontSize * 0.2,
        emHeightAscent: fontSize * 0.8,
        emHeightDescent: fontSize * 0.2,
      } as TextMetrics;
      return {
        ...defaults,
        ...options.measureText?.(text, font),
      };
    },
    fillText: (text: string, x: number, y: number) => {
      const metrics = context.measureText(text);
      recording.fillText.push({
        text,
        x,
        y,
        globalAlpha: Number(context.globalAlpha),
        font: String(context.font),
        fillStyle: String(context.fillStyle),
        textBaseline: String(context.textBaseline) as CanvasTextBaseline,
        actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
        actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
        clip: currentClip ? { ...currentClip } : null,
      });
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '16px sans-serif',
    textAlign: 'left',
    textBaseline: 'top',
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => {
      if (kind !== '2d') {
        return null;
      }
      return context;
    },
  } as unknown as HTMLCanvasElement;

  return { canvas, context, recording };
}
