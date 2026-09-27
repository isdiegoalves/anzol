import { Page } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import { TokenTracker, expect, test } from './support/fixtures';
import { acaoDoShell, compacto, destino } from './support/shell';
import { seedStorage } from './support/storage';

// Item 14, CA-2 no shell (E3): axe com WCAG 2.2 A/AA e zero violações `serious`/`critical` nas telas que o shell
// entrega sozinho (Checks e Insights, ainda stubs na E3, com o rail e o cabeçalho), no desbloqueio e na página do
// link só-leitura, no claro e no escuro, a 1400×900 e a 390×844. As telas das fatias seguintes (Inbox, detalhe,
// Checks com Generic pendente, Rules, Outbound, Compare, Insights com dados, onboarding) entram nas specs delas.

const SEGREDO = 'segredo-do-axe';

interface Tela {
  nome: string;
  abrir(page: Page, tokens: TokenTracker): Promise<void>;
}

const TELAS: Tela[] = [
  {
    nome: 'Checks (shell)',
    async abrir(page, tokens) {
      await page.goto(`/#/${await tokens.create()}/checks`);
      await expect(destino(page, 'Checks')).toHaveAttribute('aria-current', 'page');
    },
  },
  {
    nome: 'Insights (shell)',
    async abrir(page, tokens) {
      await page.goto(`/#/${await tokens.create()}/insights`);
      await expect(destino(page, 'Insights')).toHaveAttribute('aria-current', 'page');
    },
  },
  {
    nome: 'desbloqueio',
    async abrir(page, tokens) {
      const tokenId = await tokens.create({ read_secret: SEGREDO });
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}`);
      await expect(page.getByRole('heading', { name: 'This URL is protected' })).toBeVisible();
      // Fidelidade ao C (F1, INBOX-29, trava 11): no compacto, "New URL" fica no menu "More actions".
      await expect(await acaoDoShell(page, 'New URL')).toBeVisible();
      if (compacto(page)) {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menuitem', { name: 'New URL' })).toHaveCount(0);
      }
    },
  },
  {
    nome: 'link só-leitura',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      const requestId = await tokens.send(tokenId, {
        headers: { 'content-type': 'application/json' },
        data: '{"ok":true}',
      });
      const link = await page.request.post(`/token/${tokenId}/request/${requestId}/share`, {
        data: {},
      });
      expect([200, 201]).toContain(link.status());
      const { id } = (await link.json()) as { id: string };
      await seedStorage(page, {});
      await page.goto(`/#/share/${id}`);
      await expect(page.getByText(/Shared read-only link · expires/)).toBeVisible();
    },
  },
];

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`Dado o shell no tema ${colorScheme} a ${viewport.width}×${viewport.height}`, () => {
      test.use({ colorScheme, viewport });

      for (const tela of TELAS) {
        test(`deve passar no axe sem violação grave: ${tela.nome}`, async ({ page, tokens }) => {
          await tela.abrir(page, tokens);
          await expectSemViolacoesGraves(
            page,
            `${tela.nome}, ${colorScheme}, ${viewport.width} px`,
          );
        });
      }
    });
  }
}
