import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8084';

export default defineConfig({
  testDir: './specs',
  // LLM falso OpenAI-compatível da IA local (porta 18099), compartilhado pelos workers.
  globalSetup: './support/llm-falso-global.ts',
  // O app atual roda PHP-FPM com poucos processos; mais workers só enfileiram no servidor
  // e deixam as medições de tempo (timeout do token) ruidosas.
  workers: 4,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { baseURL: BASE_URL },
  projects: [
    { name: 'api', testMatch: /api\/.*\.spec\.ts/ },
    { name: 'event', testMatch: /event\/.*\.spec\.ts/ },
  ],
});
