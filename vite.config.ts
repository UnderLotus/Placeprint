import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const QR_CODE_UTF8_MODULE_URL = './node_modules/qrcode-generator/dist/qrcode_UTF8.mjs';

export function resolveQrCodeUtf8Module(configUrl: string | URL): string {
  return fileURLToPath(new URL(QR_CODE_UTF8_MODULE_URL, configUrl));
}

const qrcodeUtf8Module = resolveQrCodeUtf8Module(import.meta.url);

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      'qrcode-generator/dist/qrcode_UTF8.mjs': qrcodeUtf8Module,
    },
  },
  build: {
    modulePreload: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
