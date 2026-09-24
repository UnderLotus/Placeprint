export const THEME_TRANSITION_DURATION_MS = 420;
export const THEME_TRANSITION_CLASS = 'theme-transitioning';

export interface ThemeTransitionRequest {
  readonly applyTarget: () => void;
  readonly renderTarget: () => void;
}

export interface ThemeTransitionOptions {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly window: Window;
  readonly reducedMotion: () => boolean;
  readonly cancelAnimations: () => void;
  readonly schedule?: (callback: () => void, delay: number) => number;
  readonly cancelSchedule?: (handle: number) => void;
}

export interface ThemeTransition {
  start(request: ThemeTransitionRequest): void;
  cancel(): void;
  destroy(): void;
}

interface InlineTransitionValue {
  readonly value: string;
  readonly priority: string;
}

interface ActiveTransition {
  readonly overlay: HTMLCanvasElement;
  readonly inlineTransition: InlineTransitionValue;
  paletteAnimation: Animation | null;
  overlayAnimation: Animation | null;
  timer: number | null;
  fallbackFrame: number | null;
}

function restoreInlineTransition(root: HTMLElement, previous: InlineTransitionValue): void {
  if (previous.value) root.style.setProperty('transition', previous.value, previous.priority);
  else root.style.removeProperty('transition');
}

export function createThemeTransition(options: ThemeTransitionOptions): ThemeTransition {
  const {
    root,
    canvas,
    window,
    reducedMotion,
    cancelAnimations,
    schedule = (callback, delay) => window.setTimeout(callback, delay),
    cancelSchedule = (handle) => window.clearTimeout(handle),
  } = options;
  let active: ActiveTransition | null = null;

  function removeActive(transition: ActiveTransition): void {
    if (active !== transition) return;
    active = null;
    if (transition.timer !== null) {
      cancelSchedule(transition.timer);
      transition.timer = null;
    }
    if (transition.fallbackFrame !== null) {
      window.cancelAnimationFrame(transition.fallbackFrame);
      transition.fallbackFrame = null;
    }
    if (transition.paletteAnimation) {
      transition.paletteAnimation.onfinish = null;
      transition.paletteAnimation.cancel();
      transition.paletteAnimation = null;
    }
    if (transition.overlayAnimation) {
      transition.overlayAnimation.onfinish = null;
      transition.overlayAnimation.cancel();
      transition.overlayAnimation = null;
    }
    root.classList.remove(THEME_TRANSITION_CLASS);
    restoreInlineTransition(root, transition.inlineTransition);
    transition.overlay.remove();
  }

  function cancel(): void {
    if (active) removeActive(active);
    else root.classList.remove(THEME_TRANSITION_CLASS);
  }

  function start(request: ThemeTransitionRequest): void {
    cancel();
    const animate = !reducedMotion();
    let transition: ActiveTransition | null = null;
    let fromTokens: Record<string, string> = {};
    let tokenNames: string[] = [];

    if (animate && canvas.parentElement) {
      const overlay = canvas.ownerDocument.createElement('canvas');
      overlay.className = 'theme-transition-overlay';
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.pointerEvents = 'none';
      overlay.style.opacity = '1';
      const context = overlay.getContext('2d');
      if (context) {
        context.drawImage(canvas, 0, 0);
        canvas.parentElement.insertBefore(overlay, canvas.nextSibling);
        root.classList.add(THEME_TRANSITION_CLASS);

        const oldStyle = window.getComputedStyle(root);
        tokenNames = oldStyle.transitionProperty
          .split(',')
          .map((property) => property.trim())
          .filter((property) => property.startsWith('--'));
        if (!tokenNames.includes('--theme-page')) tokenNames.push('--theme-page');
        fromTokens = Object.fromEntries(
          tokenNames.map((property) => [property, oldStyle.getPropertyValue(property).trim()]),
        );

        const inlineTransition = {
          value: root.style.getPropertyValue('transition'),
          priority: root.style.getPropertyPriority('transition'),
        };
        root.style.setProperty('transition', 'none');
        transition = {
          overlay,
          inlineTransition,
          paletteAnimation: null,
          overlayAnimation: null,
          timer: null,
          fallbackFrame: null,
        };
        active = transition;
      }
    }

    try {
      cancelAnimations();
      request.applyTarget();
      request.renderTarget();
    } catch (error) {
      if (transition) removeActive(transition);
      throw error;
    }

    if (!transition) return;

    const finish = (): void => removeActive(transition!);
    try {
      const targetStyle = window.getComputedStyle(root);
      const targetTokens = Object.fromEntries(
        tokenNames.map((property) => [property, targetStyle.getPropertyValue(property).trim()]),
      );
      transition.paletteAnimation = root.animate(
        [fromTokens, targetTokens] as Keyframe[],
        { duration: THEME_TRANSITION_DURATION_MS, easing: 'ease-out' },
      );
      transition.paletteAnimation.onfinish = finish;
    } catch {
      // If root animation is unavailable, keep the target palette and clean up the Canvas fade.
      transition.paletteAnimation = null;
    }

    try {
      transition.overlayAnimation = transition.overlay.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: THEME_TRANSITION_DURATION_MS, easing: 'ease-out', fill: 'forwards' },
      );
      transition.overlayAnimation.onfinish = finish;
    } catch {
      transition.overlay.style.transition = 'opacity 420ms ease-out';
      transition.fallbackFrame = window.requestAnimationFrame(() => {
        transition!.fallbackFrame = null;
        if (active === transition) transition!.overlay.style.opacity = '0';
      });
    }
    transition.timer = schedule(finish, THEME_TRANSITION_DURATION_MS);
  }

  return { start, cancel, destroy: cancel };
}
