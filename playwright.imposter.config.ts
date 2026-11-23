import { defineConfig } from '@playwright/test';

/** Runs only against an explicitly started, isolated local Imposter server. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'imposter.spec.ts',
  timeout: 180_000,
  workers: 2,
  fullyParallel: true,
  use: { actionTimeout: 10_000, baseURL: process.env.IMPOSTER_TEST_URL ?? 'http://127.0.0.1:5174', screenshot: 'only-on-failure' },
  outputDir: 'output/almaidan-imposter-browser-acceptance',
});
