// Playwright configuration of the Studio flow checks. `tests/integration/run` runs it with
// `studio/node_modules/.bin/playwright test --config tests/integration/studio/playwright.config.ts` and
// `NODE_PATH=<checkout>/studio/node_modules`, so the checks use Studio's own pinned `@playwright/test` and there is
// no second package. Checks run one at a time, headless Chromium, against the built app served by `bun run serve`.

import { defineConfig } from '@playwright/test';
import path from 'node:path';

const verdicts = process.env.EMUFORGE_IT_VERDICTS;
const studioPort = process.env.EMUFORGE_STUDIO_PORT;
const out = verdicts ? path.dirname(path.resolve(verdicts)) : path.resolve(__dirname, '..', '..', '..', 'output');

export default defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // Starting Studio, an engine and an emulator of the check's own, then observing several 10-second bounds.
  timeout: 180_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(out, 'playwright'),
  reporter: [[path.join(__dirname, 'support', 'reporter.ts')]],
  use: {
    browserName: 'chromium',
    headless: true,
    baseURL: studioPort ? `http://127.0.0.1:${studioPort}` : undefined,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
});
