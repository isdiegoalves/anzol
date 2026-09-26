import { defineConfig, devices } from '@playwright/test';

/**
 * E2E da tela (checklist de paridade 1–14 do item 00).
 *
 *   BASE_URL=http://localhost:8084 npx playwright test  # app do docker compose (backend + tela)
 *   npx ng serve                                        # ou a tela em desenvolvimento (proxy → 8084)
 *   BASE_URL=http://localhost:4200 npx playwright test
 */
const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4200';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: { width: 1400, height: 900 },
    // Item 14 (CA-4): a tela passa a escolher o idioma pelo navegador; os specs rodam em inglês fixo, e o smoke
    // em pt-BR troca o idioma no próprio spec.
    locale: 'en-US',
  },
  projects: [
    { name: 'ui', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } },
  ],
});
