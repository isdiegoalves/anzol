import { defineConfig, devices } from '@playwright/test';

/**
 * E2E da tela (checklist de paridade 1–14 do item 00).
 *
 *   npx ng serve                                        # proxy para o app atual (8084)
 *   BASE_URL=http://localhost:4200 npx playwright test  # BASE_URL = onde a tela nova está
 *
 * Contra o backend Kotlin: `BACKEND_URL=http://localhost:8086 npx ng serve` e o mesmo comando;
 * com o SSE disponível, o `tempo-real.spec.ts` deixa de ser pulado.
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
  },
  projects: [
    { name: 'ui', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } },
  ],
});
