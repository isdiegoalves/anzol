import { defineConfig, devices } from '@playwright/test';

/**
 * E2E da tela (checklist de paridade 1–14 do item 00).
 *
 *   BASE_URL=http://localhost:8084 npx playwright test  # app do docker compose (backend + tela)
 *   npx ng serve                                        # ou a tela em desenvolvimento (proxy → 8084)
 *   BASE_URL=http://localhost:4200 npx playwright test
 */
const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4200';

/**
 * Item 14, E11. `VISUAL=1` roda só a regressão visual (`visual.spec.ts`), que existe para rodar na imagem Docker do
 * Playwright (./e2e-visual.sh): os pixels só batem com a mesma fonte e o mesmo rasterizador. Sem ele, rodam o
 * projeto `ui` (desktop, 1400×900) e o `mobile` (390×844, toque), este só com as specs que fazem sentido no celular.
 */
const visual = process.env['VISUAL'] === '1';

/**
 * Specs que também rodam no celular: shell (barra inferior, desbloqueio e link só-leitura), URL e link, tema,
 * onboarding, detalhe, apagar e copiar, Checks e Insights, e as de Regras (UX de Regras, F8/CA-11: `regras*` e
 * `fidelidade-rules*`, com o que é só de desktop marcado no próprio teste) e as do patamar (`patamar*`). Ficam de fora as que supõem lista e detalhe lado a lado
 * (lista, i18n, privacidade): abaixo de 840 px a Inbox mostra um painel por vez, e o shell.spec já cobre o
 * desbloqueio e o link só-leitura a 390 px.
 */
const MOBILE = [
  'shell',
  'url-e-link',
  'tema',
  'onboarding',
  'detalhe',
  'apagar-todas',
  'copiar-como',
  'checks',
  'insights',
  'regras[^/]*',
  'fidelidade-rules[^/]*',
  'patamar[^/]*',
].map((nome) => new RegExp(`/${nome}\\.spec\\.ts$`));

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
  projects: visual
    ? [
        {
          name: 'visual',
          testMatch: /visual\.spec\.ts$/,
          use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } },
        },
      ]
    : [
        {
          name: 'ui',
          testIgnore: /visual\.spec\.ts$/,
          use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } },
        },
        {
          name: 'mobile',
          testMatch: MOBILE,
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 2,
          },
        },
      ],
});
