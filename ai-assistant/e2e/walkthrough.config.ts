import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig from './playwright.config';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  ...baseConfig,
  metadata: {
    ...baseConfig.metadata,
    walkthrough: true,
  },
  outputDir: path.join(e2eDir, 'walkthrough-results'),
  use: {
    ...baseConfig.use,
    colorScheme: 'dark',
    launchOptions: {
      ...baseConfig.use?.launchOptions,
      slowMo: 200,
    },
    screenshot: 'off',
    trace: 'off',
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
    viewport: { width: 1920, height: 1080 },
  },
});
