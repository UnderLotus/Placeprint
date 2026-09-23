import { describe, expect, it } from 'vitest';
import { resolveQrCodeUtf8Module } from '../vite.config';

describe('Vite QR UTF-8 alias path', () => {
  it('decodes escaped checkout path segments before creating the alias', () => {
    const resolved = resolveQrCodeUtf8Module(
      'file:///tmp/share%20card/vite.config.ts',
    );

    expect(resolved).toBe(
      '/tmp/share card/node_modules/qrcode-generator/dist/qrcode_UTF8.mjs',
    );
  });
});
