import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(
  fileURLToPath(new URL('../index.html', import.meta.url)),
  'utf8',
);
const styles = readFileSync(
  fileURLToPath(new URL('./styles.css', import.meta.url)),
  'utf8',
);

function cssRule(selector: string): string {
  const start = styles.indexOf(selector + ' {');
  if (start < 0) {
    throw new Error('Missing CSS rule: ' + selector);
  }
  const end = styles.indexOf('}', start);
  if (end < 0) {
    throw new Error('Unclosed CSS rule: ' + selector);
  }
  return styles.slice(start, end + 1);
}

describe('Ticket18 empty information ghost contract', () => {
  it('declares one fixed Canvas-coordinate class for every ghost row', () => {
    for (const classAttribute of [
      'ghost-name',
      'ghost-line ghost-rating',
      'ghost-line ghost-category',
      'ghost-line ghost-hours',
      'ghost-line ghost-address',
    ]) {
      expect(indexHtml).toContain('class="' + classAttribute);
    }

    const ghost = cssRule('.info-ghost');
    expect(ghost).toContain('inset: 0;');
    expect(ghost).not.toMatch(/padding-top|gap:/);

    const shared = cssRule('.info-ghost span');
    expect(shared).toContain('left: 8.333333cqw;');
    expect(shared).toContain('width: 67.1875cqw;');

    const rows: Record<string, string[]> = {
      '.info-ghost .ghost-name': [
        'top: 7.291667cqw;',
        'width: 83.333333cqw;',
        'font-size: 6.510417cqw;',
        'line-height: 7.8125cqw;',
      ],
      '.info-ghost .ghost-rating': [
        'top: 16.666667cqw;',
        'font-size: 3.255208cqw;',
        'line-height: 4.036458cqw;',
      ],
      '.info-ghost .ghost-category': [
        'top: 22.265625cqw;',
        'font-size: 2.734375cqw;',
        'line-height: 3.515625cqw;',
      ],
      '.info-ghost .ghost-hours': [
        'top: 27.34375cqw;',
        'font-size: 2.604167cqw;',
        'line-height: 3.385417cqw;',
      ],
      '.info-ghost .ghost-address': [
        'top: 32.291667cqw;',
        'font-size: 2.473958cqw;',
        'line-height: 3.385417cqw;',
      ],
    };

    for (const [selector, declarations] of Object.entries(rows)) {
      const rule = cssRule(selector);
      for (const declaration of declarations) {
        expect(rule).toContain(declaration);
      }
    }
  });
});

describe('Initial preview paint contract', () => {
  it('matches the empty Canvas photo and information colors before JavaScript renders', () => {
    const preview = cssRule('#card-preview');
    expect(preview).toContain('#dcebe8 0 var(--photo-seam)');
    expect(preview).toContain('var(--paper) var(--photo-seam) 100%');
  });
});

describe('Ticket19 transparent QR reveal contract', () => {
  it('declares one clickable paper overlay with ordered ghost and overlay fades', () => {
    expect(indexHtml).toContain('id="info-reveal-overlay"');
    expect(indexHtml).toContain('class="info-reveal-overlay"');
    expect(indexHtml).toContain('aria-hidden="true"');

    const overlay = cssRule('.info-reveal-overlay');
    expect(overlay).toContain('inset: 0;');
    expect(overlay).toContain('background: #fbfbf6;');
    expect(overlay).toContain('pointer-events: none;');

    const lookup = cssRule(".info-hotspot[data-reveal-phase='lookup'] .info-reveal-overlay");
    expect(lookup).toContain('opacity: 1;');
    const successOverlay = cssRule(".info-hotspot[data-reveal-phase='success'] .info-reveal-overlay");
    expect(successOverlay).toContain('animation: info-reveal-overlay-fade 320ms ease-out 180ms forwards;');
    const successGhost = cssRule(".info-hotspot[data-reveal-phase='success'] .info-ghost");
    expect(successGhost).toContain('animation: info-reveal-ghost-fade 180ms ease-out forwards;');
    expect(styles).toContain('@keyframes info-reveal-ghost-fade');
    expect(styles).toContain('@keyframes info-reveal-overlay-fade');
  });
});
