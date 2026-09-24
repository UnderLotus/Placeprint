import { Window as HappyWindow } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ACTIVE_THEME_OPTIONS } from './theme';
import { mountThemePicker, type ThemePickerOption } from './theme-picker';

const options: readonly ThemePickerOption[] = [
  { id: 'nando', label: '納戸', swatch: '#087f8a' },
  { id: 'fixture', label: '測試配色', swatch: '#e16b8c' },
];

let dom: HappyWindow;
function fixture(
  rectangles = { trigger: [40, 180, 120, 44], panel: [0, 0, 220, 180] },
  activeOptions: readonly ThemePickerOption[] = options,
  getSelected: () => string = () => 'nando',
) {
  dom = new HappyWindow({ url: 'https://placeprint.test/' });
  Object.defineProperty(dom, 'innerWidth', { value: 320, configurable: true });
  Object.defineProperty(dom, 'innerHeight', { value: 320, configurable: true });
  dom.document.body.innerHTML = `
    <div id="wrapper">
      <button id="trigger" type="button">更換配色</button>
      <div id="panel" hidden></div>
    </div>
    <button id="outside">外部</button>`;
  const trigger = dom.document.querySelector('#trigger') as unknown as HTMLButtonElement;
  const panel = dom.document.querySelector('#panel') as unknown as HTMLDivElement;
  const outside = dom.document.querySelector('#outside') as unknown as HTMLButtonElement;
  const bounds = (which: 'trigger' | 'panel') => {
    const [left, top, width, height] = rectangles[which];
    return { x:left, y:top, left, top, width, height, right:left + width, bottom:top + height, toJSON:()=>({}) } as DOMRect;
  };
  trigger.getBoundingClientRect = () => bounds('trigger');
  panel.getBoundingClientRect = () => bounds('panel');
  const selected: string[] = [];
  let activeId = getSelected();
  const picker = mountThemePicker({
    window: dom as unknown as typeof globalThis.window,
    trigger,
    panel,
    options: activeOptions,
    selectedId: () => activeId,
    onSelect: (id) => { selected.push(id); activeId = id; },
  });
  return { dom, trigger, panel, outside, picker, selected };
}

afterEach(() => { dom?.close(); });

describe('theme picker', () => {
  it('renders and opens production theme choices with the selected theme marked', () => {
    const { trigger, panel } = fixture(undefined, ACTIVE_THEME_OPTIONS);
    expect(trigger.hidden).toBe(false);
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.theme-picker-option')];
    expect(buttons.map((button) => button.dataset.themeId)).toEqual(['nando', 'koubai', 'konjou', 'kincha']);
    expect(buttons.map((button) => button.querySelector('.theme-picker-label')?.textContent)).toEqual(['納戸', '紅梅', '紺青', '金茶']);
    expect(buttons.map((button) => button.querySelector<HTMLElement>('.theme-picker-swatch')?.style.backgroundColor)).toEqual([
      '#087f8a', '#e16b8c', '#113285', '#c7802d',
    ]);

    trigger.click();
    const optionButtons = [...panel.querySelectorAll('button')] as unknown as HTMLButtonElement[];
    expect(optionButtons.map((button) => button.textContent)).toEqual(['納戸', '紅梅', '紺青', '金茶']);
    expect(optionButtons.map((button) => button.dataset.selected)).toEqual(['true', 'false', 'false', 'false']);
  });

  it('closes on Escape', () => {
    const { dom, trigger, panel } = fixture();
    trigger.click();
    dom.document.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
  });

  it('closes on outside pointerdown', () => {
    const { trigger, panel, outside } = fixture();
    trigger.click();
    outside.dispatchEvent(new dom.Event('pointerdown', { bubbles: true }) as unknown as Event);
    expect(panel.hidden).toBe(true);
  });

  it('lets a trigger click close an open picker', () => {
    const { trigger, panel } = fixture();
    trigger.click();
    trigger.click();
    expect(panel.hidden).toBe(true);
  });

  it('ignores pointerdown on an option until its click selects and closes', () => {
    const { dom, trigger, panel, selected } = fixture();
    trigger.click();
    const option = panel.querySelector('[data-theme-id="fixture"]') as unknown as HTMLButtonElement;
    option.dispatchEvent(new dom.Event('pointerdown', { bubbles: true }) as unknown as Event);
    expect(panel.hidden).toBe(false);
    option.click();
    expect(selected).toEqual(['fixture']);
    expect(panel.hidden).toBe(true);
    expect([...panel.querySelectorAll<HTMLButtonElement>('.theme-picker-option')].map((button) => button.dataset.selected)).toEqual(['false', 'true']);
    trigger.click();
    expect([...panel.querySelectorAll<HTMLButtonElement>('.theme-picker-option')].map((button) => button.dataset.selected)).toEqual(['false', 'true']);
  });

  it('prefers top placement when it fits and clamps both viewport gutters', () => {
    const { trigger, panel } = fixture({
      trigger: [290, 250, 20, 40],
      panel: [0, 0, 220, 180],
    });
    trigger.click();
    expect(panel.dataset.placement).toBe('top');
    expect(panel.style.left).toBe('88px');
    expect(panel.style.top).toBe('62px');
  });

  it('uses bottom placement when the trigger is too close to the top', () => {
    const { trigger, panel } = fixture({
      trigger: [24, 18, 100, 40],
      panel: [0, 0, 220, 180],
    });
    trigger.click();
    expect(panel.dataset.placement).toBe('bottom');
    expect(panel.style.top).toBe('66px');
  });

  it('uses the larger side with an internally scrollable max height when neither fits', () => {
    const { trigger, panel } = fixture({
      trigger: [60, 130, 120, 40],
      panel: [0, 0, 220, 260],
    });
    trigger.click();
    expect(panel.dataset.placement).toBe('bottom');
    expect(panel.style.maxHeight).toBe('130px');
    expect(panel.style.overflowY).toBe('auto');
  });

  it('hides the trigger for one active option and removes listeners on destroy', () => {
    const single = fixture(undefined, [options[0]]);
    expect(single.trigger.hidden).toBe(true);
    single.picker.destroy();
    single.dom.close();
    const { trigger, panel, picker } = fixture();
    trigger.click();
    picker.destroy();
    expect(panel.hidden).toBe(true);
    trigger.click();
    expect(panel.hidden).toBe(true);
  });
});
