import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const indexHtml = readFileSync(root + '/index.html', 'utf8');
const styles = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');
const main = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8');

function canvasMarkup(): string {
  const start = indexHtml.indexOf('<canvas\n                id="card-preview"');
  const end = indexHtml.indexOf('</canvas>', start);
  return indexHtml.slice(start, end);
}

describe('Ticket23 fixed card geometry contract', () => {
  it('declares one 1919px intrinsic canvas and one shared CSS photo seam', () => {
    const canvas = canvasMarkup();
    expect(canvas).toContain('width="1536"');
    expect(canvas).toContain('height="1919"');
    expect(canvas).not.toContain('height="2048"');
    expect(canvas).not.toContain('height="1961"');
    expect(styles).toContain('--photo-seam: 64.0437727983%;');
    expect(styles).toContain('aspect-ratio: 1536 / 1919;');
    expect(styles.match(/calc\(100% - var\(--photo-seam\)\)/g)).toHaveLength(2);
    expect(styles).toContain('inset: var(--photo-seam) 0 0;');
    expect(styles).not.toContain('aspect-ratio: 3 / 4;');
    expect(styles).not.toContain('inset: 0 0 40%;');
    expect(styles).not.toContain('60.009765625%');
    expect(styles).not.toContain('62.6721060683%');
    expect(main).not.toContain('2048');
    expect(main).not.toContain('1961');
  });
});
