export interface ThemePickerOption {
  readonly id: string;
  readonly label: string;
  readonly swatch: string;
}

export interface ThemePickerOptions {
  readonly window: Window;
  readonly wrapper?: HTMLElement;
  readonly trigger: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly options: readonly ThemePickerOption[];
  readonly selectedId: () => string;
  readonly onSelect: (id: string) => void;
}

export interface ThemePicker {
  open(): void;
  close(): void;
  destroy(): void;
}

const VIEWPORT_GUTTER = 12;
const ANCHOR_GAP = 8;

export function mountThemePicker(options: ThemePickerOptions): ThemePicker {
  const { window, wrapper, trigger, panel, options: themeOptions, selectedId, onSelect } = options;
  const { document } = window;
  let isOpen = false;
  let destroyed = false;

  trigger.type = 'button';
  trigger.hidden = themeOptions.length < 2;
  if (wrapper) wrapper.hidden = themeOptions.length < 2;
  panel.hidden = true;
  panel.replaceChildren();

  for (const option of themeOptions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-picker-option';
    button.dataset.themeId = option.id;
    button.dataset.selected = String(option.id === selectedId());

    const swatch = document.createElement('span');
    swatch.className = 'theme-picker-swatch';
    swatch.style.backgroundColor = option.swatch;

    const label = document.createElement('span');
    label.className = 'theme-picker-label';
    label.textContent = option.label;
    button.append(swatch, label);
    panel.append(button);
  }

  const optionButtons = (): HTMLButtonElement[] =>
    [...panel.querySelectorAll<HTMLButtonElement>('.theme-picker-option')];

  function updateSelected(): void {
    const selected = selectedId();
    for (const button of optionButtons()) {
      button.dataset.selected = String(button.dataset.themeId === selected);
    }
  }

  function updatePlacement(): void {
    const triggerRect = trigger.getBoundingClientRect();
    const parentRect = (wrapper ?? trigger.parentElement)?.getBoundingClientRect() ?? { left: 0, top: 0 };
    panel.style.position = 'absolute';
    panel.style.maxWidth = String(Math.max(0, window.innerWidth - VIEWPORT_GUTTER * 2)) + 'px';
    panel.style.maxHeight = '';
    panel.style.overflowY = 'auto';

    const rect = panel.getBoundingClientRect();
    const panelWidth = Math.min(
      rect.width || panel.offsetWidth || 220,
      Math.max(0, window.innerWidth - VIEWPORT_GUTTER * 2),
    );
    const panelHeight = rect.height || panel.offsetHeight || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const spaceAbove = Math.max(0, triggerRect.top - ANCHOR_GAP - VIEWPORT_GUTTER);
    const spaceBelow = Math.max(
      0,
      viewportHeight - triggerRect.bottom - ANCHOR_GAP - VIEWPORT_GUTTER,
    );
    const fitsAbove = panelHeight <= spaceAbove;
    const fitsBelow = panelHeight <= spaceBelow;
    const placement = fitsAbove
      ? 'top'
      : fitsBelow
        ? 'bottom'
        : spaceAbove >= spaceBelow
          ? 'top'
          : 'bottom';
    const availableHeight = placement === 'top' ? spaceAbove : spaceBelow;
    const needsScroll = !fitsAbove && !fitsBelow;
    const height = needsScroll ? availableHeight : panelHeight;

    panel.dataset.placement = placement;
    panel.style.maxHeight = needsScroll ? String(availableHeight) + 'px' : '';
    const left = Math.max(
      VIEWPORT_GUTTER,
      Math.min(triggerRect.left, window.innerWidth - VIEWPORT_GUTTER - panelWidth),
    );
    const top = placement === 'top'
      ? Math.max(VIEWPORT_GUTTER, triggerRect.top - ANCHOR_GAP - height)
      : Math.min(viewportHeight - VIEWPORT_GUTTER - height, triggerRect.bottom + ANCHOR_GAP);
    panel.style.left = String(left - parentRect.left) + 'px';
    panel.style.top = String(top - parentRect.top) + 'px';
  }

  function onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (target && (trigger.contains(target) || panel.contains(target))) return;
    close();
  }

  function onDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  }

  function onViewportChange(): void {
    if (isOpen) updatePlacement();
  }

  function removeOpenListeners(): void {
    document.removeEventListener('pointerdown', onDocumentPointerDown);
    document.removeEventListener('keydown', onDocumentKeyDown);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    removeOpenListeners();
  }

  function open(): void {
    if (destroyed || themeOptions.length < 2 || isOpen) return;
    updateSelected();
    isOpen = true;
    panel.hidden = false;
    updatePlacement();
    document.addEventListener('pointerdown', onDocumentPointerDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
  }

  function onTriggerClick(): void {
    if (isOpen) close();
    else open();
  }

  function onPanelClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('.theme-picker-option');
    if (!button || !panel.contains(button)) return;
    const id = button.dataset.themeId;
    if (!id) return;
    try {
      onSelect(id);
    } finally {
      updateSelected();
      close();
    }
  }

  trigger.addEventListener('click', onTriggerClick);
  panel.addEventListener('click', onPanelClick);

  return {
    open,
    close,
    destroy(): void {
      if (destroyed) return;
      close();
      destroyed = true;
      trigger.removeEventListener('click', onTriggerClick);
      panel.removeEventListener('click', onPanelClick);
      panel.replaceChildren();
    },
  };
}
