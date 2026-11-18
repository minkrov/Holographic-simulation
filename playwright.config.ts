import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const production = process.env.PLAYWRIGHT_PRODUCTION === '1';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${production ? 4173 : 5173}`;
const softwareGL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 35_000,
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath
      ? {
          executablePath,
          args: [...softwareGL, '--in-process-gpu'],
        }
      : { args: softwareGL },
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: production ? 'npm start' : 'npm run dev -- --port 5173 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
