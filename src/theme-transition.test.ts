import { Window as HappyWindow } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThemeTransition, THEME_TRANSITION_DURATION_MS } from './theme-transition';

let dom: HappyWindow;
interface MockAnimation {
  onfinish: (() => void) | null;
  cancel: ReturnType<typeof vi.fn>;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
}

function fixture(reducedMotion = false) {
  dom = new HappyWindow({ url: 'https://placeprint.test/' });
  const root = dom.document.documentElement as unknown as HTMLElement;
  root.dataset.theme = 'nando';
  const parentDom = dom.document.createElement('div');
  const canvasDom = dom.document.createElement('canvas');
  const parent = parentDom as unknown as HTMLElement;
  const canvas = canvasDom as unknown as HTMLCanvasElement;
  canvas.width = 1536;
  canvas.height = 1919;
  parentDom.append(canvasDom);
  dom.document.body.append(parentDom);
  const draws: unknown[][] = [];
  const paletteAnimations: MockAnimation[] = [];
  const overlayAnimations: MockAnimation[] = [];
  const colors: Record<string, Record<string, string>> = {
    nando: { '--theme-page': '#eef6f4', '--theme-action': '#087f8a', '--theme-kofi': '#087f8a' },
    fixture: { '--theme-page': '#e4d3ea', '--theme-action': '#b23c78', '--theme-kofi': '#b23c78' },
    first: { '--theme-page': '#d5e2ef', '--theme-action': '#315d92', '--theme-kofi': '#315d92' },
    second: { '--theme-page': '#f2dfc7', '--theme-action': '#9b6624', '--theme-kofi': '#9b6624' },
  };
  const transitionProperties = Object.keys(colors.nando).join(', ');
  Object.defineProperty(dom, 'getComputedStyle', {
    configurable: true,
    value: () => ({
      transitionProperty: transitionProperties,
      getPropertyValue: (property: string) => colors[root.dataset.theme ?? 'nando']?.[property] ?? '',
    }),
  });
  Object.defineProperty(root, 'animate', {
    configurable: true,
    value: (frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation: MockAnimation = { onfinish: null, cancel: vi.fn(), frames, options };
      paletteAnimations.push(animation);
      return animation as unknown as Animation;
    },
  });
  const canvasConstructor = (dom as unknown as { HTMLCanvasElement: { prototype: object } }).HTMLCanvasElement;
  Object.defineProperty(canvasConstructor.prototype, 'getContext', {
    configurable: true,
    value: () => ({ drawImage: (...args: unknown[]) => draws.push(args) }),
  });
  Object.defineProperty(canvasConstructor.prototype, 'animate', {
    configurable: true,
    value: (frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation: MockAnimation = { onfinish: null, cancel: vi.fn(), frames, options };
      overlayAnimations.push(animation);
      return animation as unknown as Animation;
    },
  });
  const cancelAnimations = vi.fn();
  const cancelSchedule = vi.fn();
  const transition = createThemeTransition({
    root,
    canvas,
    window: dom as unknown as typeof globalThis.window,
    reducedMotion: () => reducedMotion,
    cancelAnimations,
    schedule: () => 1,
    cancelSchedule,
  });
  return { dom, root, parent, canvas, draws, paletteAnimations, overlayAnimations, cancelAnimations, cancelSchedule, transition };
}

afterEach(() => { dom?.close(); vi.restoreAllMocks(); });

function applyTarget(root: HTMLElement, id: string, applied: string[]) {
  return () => { root.dataset.theme = id; applied.push(id); };
}

function token(frame: Keyframe, property: string): string {
  return (frame as Keyframe & Record<string, string>)[property];
}

describe('theme transition', () => {
  it('animates the captured root palette and old Canvas overlay together for 420ms', () => {
    const { root, parent, canvas, draws, paletteAnimations, overlayAnimations, cancelAnimations, cancelSchedule, transition } = fixture();
    const applied: string[] = [];
    const rendered: string[] = [];
    root.style.setProperty('transition', 'color 2s', 'important');
    transition.start({
      applyTarget: () => {
        expect(root.style.getPropertyValue('transition')).toBe('none');
        applyTarget(root, 'fixture', applied)();
      },
      renderTarget: () => rendered.push(root.dataset.theme ?? ''),
    });
    const overlay = parent.querySelector('.theme-transition-overlay') as unknown as HTMLCanvasElement;
    expect(draws).toHaveLength(1);
    expect(draws[0][0]).toBe(canvas);
    expect(overlay.style.pointerEvents).toBe('none');
    expect([overlay.width, overlay.height]).toEqual([1536, 1919]);
    expect(root.classList.contains('theme-transitioning')).toBe(true);
    expect(applied).toEqual(['fixture']);
    expect(rendered).toEqual(['fixture']);
    expect(cancelAnimations).toHaveBeenCalledOnce();
    expect(paletteAnimations).toHaveLength(1);
    expect(overlayAnimations).toHaveLength(1);

    const palette = paletteAnimations[0];
    expect(token(palette.frames[0], '--theme-page')).toBe('#eef6f4');
    expect(token(palette.frames[1], '--theme-page')).toBe('#e4d3ea');
    expect(token(palette.frames[0], '--theme-action')).toBe('#087f8a');
    expect(token(palette.frames[1], '--theme-action')).toBe('#b23c78');
    expect(token(palette.frames[0], '--theme-kofi')).toBe('#087f8a');
    expect(token(palette.frames[1], '--theme-kofi')).toBe('#b23c78');
    expect(palette.options.duration).toBe(THEME_TRANSITION_DURATION_MS);
    expect(palette.options.easing).toBe('ease-out');

    const overlayFade = overlayAnimations[0];
    expect(overlayFade.frames.map((frame) => frame.opacity)).toEqual([1, 0]);
    expect(overlayFade.options.duration).toBe(THEME_TRANSITION_DURATION_MS);
    expect(overlayFade.options.easing).toBe('ease-out');

    palette.onfinish?.();
    expect(parent.querySelector('.theme-transition-overlay')).toBeNull();
    expect(root.classList.contains('theme-transitioning')).toBe(false);
    expect(root.style.getPropertyValue('transition')).toBe('color 2s');
    expect(root.style.getPropertyPriority('transition')).toBe('important');
    expect(palette.cancel).toHaveBeenCalledOnce();
    expect(overlayFade.cancel).toHaveBeenCalledOnce();
    expect(cancelSchedule).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(1536);
  });

  it('interrupts by snapping to the previous target before taking a fresh Canvas snapshot', () => {
    const { root, parent, draws, paletteAnimations, overlayAnimations, cancelSchedule, transition } = fixture();
    transition.start({ applyTarget: applyTarget(root, 'first', []), renderTarget: () => undefined });
    const oldOverlay = parent.querySelector('.theme-transition-overlay');
    transition.start({ applyTarget: applyTarget(root, 'second', []), renderTarget: () => undefined });
    expect(oldOverlay?.isConnected).toBe(false);
    expect(paletteAnimations).toHaveLength(2);
    expect(token(paletteAnimations[0].frames[1], '--theme-page')).toBe('#d5e2ef');
    expect(token(paletteAnimations[1].frames[0], '--theme-page')).toBe('#d5e2ef');
    expect(token(paletteAnimations[1].frames[1], '--theme-page')).toBe('#f2dfc7');
    expect(paletteAnimations[0].cancel).toHaveBeenCalledOnce();
    expect(overlayAnimations[0].cancel).toHaveBeenCalledOnce();
    expect(draws).toHaveLength(2);
    expect(parent.querySelectorAll('.theme-transition-overlay')).toHaveLength(1);
    expect(root.dataset.theme).toBe('second');
    transition.cancel();
    expect(parent.querySelector('.theme-transition-overlay')).toBeNull();
    expect(root.classList.contains('theme-transitioning')).toBe(false);
    expect(root.style.getPropertyValue('transition')).toBe('');
    expect(paletteAnimations[1].cancel).toHaveBeenCalledOnce();
    expect(overlayAnimations[1].cancel).toHaveBeenCalledOnce();
    expect(cancelSchedule).toHaveBeenCalledTimes(2);
  });

  it('skips computed style reads, overlays, and both animations for reduced motion', () => {
    const { dom, root, parent, draws, paletteAnimations, overlayAnimations, cancelAnimations, transition } = fixture(true);
    const computedStyle = vi.spyOn(dom, 'getComputedStyle');
    transition.start({ applyTarget: applyTarget(root, 'fixture', []), renderTarget: () => undefined });
    expect(parent.querySelector('.theme-transition-overlay')).toBeNull();
    expect(draws).toHaveLength(0);
    expect(paletteAnimations).toHaveLength(0);
    expect(overlayAnimations).toHaveLength(0);
    expect(root.classList.contains('theme-transitioning')).toBe(false);
    expect(cancelAnimations).toHaveBeenCalledOnce();
    expect(computedStyle).not.toHaveBeenCalled();
  });

  it('keeps the Canvas cleanup fade if the root Web Animation API is unavailable', () => {
    const { root, parent, paletteAnimations, overlayAnimations, transition } = fixture();
    Object.defineProperty(root, 'animate', { configurable: true, value: () => { throw new Error('WAAPI unavailable'); } });
    transition.start({ applyTarget: applyTarget(root, 'fixture', []), renderTarget: () => undefined });
    expect(root.dataset.theme).toBe('fixture');
    expect(paletteAnimations).toHaveLength(0);
    expect(overlayAnimations).toHaveLength(1);
    expect(parent.querySelector('.theme-transition-overlay')).not.toBeNull();
    expect(root.style.getPropertyValue('transition')).toBe('none');
    overlayAnimations[0].onfinish?.();
    expect(parent.querySelector('.theme-transition-overlay')).toBeNull();
    expect(root.classList.contains('theme-transitioning')).toBe(false);
    expect(root.style.getPropertyValue('transition')).toBe('');
  });
});
