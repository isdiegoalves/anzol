import { Page } from '@playwright/test';
import { expectSemViolacoes } from './support/a11y';
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
    nome: 'desbloqueio com o segredo cobrado',
    async abrir(page, tokens) {
      const tokenId = await tokens.create({ read_secret: SEGREDO });
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}`);
      await page.getByRole('button', { name: 'Unlock' }).click();
      await expect(page.getByText('Enter the secret.')).toBeVisible();
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
          await expectSemViolacoes(page, `${tela.nome}, ${colorScheme}, ${viewport.width} px`);
        });
      }
    });
  }
}

test.describe('Dado a conferência do axe que acompanha todo teste', () => {
  test('deve reprovar a violação de qualquer impacto', async ({ page, tokens }) => {
    await page.goto(`/#/${await tokens.create()}/checks`);
    await expect(destino(page, 'Checks')).toHaveAttribute('aria-current', 'page');
    // `role="directory"` é um papel aposentado do ARIA: violação `minor` de WCAG 4.1.2.
    await page.evaluate(() => {
      const aposentado = document.createElement('div');
      aposentado.id = 'papel-aposentado';
      aposentado.setAttribute('role', 'directory');
      aposentado.textContent = 'x';
      document.querySelector('main')?.append(aposentado);
    });

    await expect(expectSemViolacoes(page, 'papel aposentado')).rejects.toThrow(
      /minor aria-deprecated-role/,
    );

    await page.evaluate(() => document.getElementById('papel-aposentado')?.remove());
  });

  test('deve reprovar o conteúdo fora de marco, e não o que o Material abre por cima', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedidos' });
    await seedStorage(page, { hideTutorial: 'true' });
    await page.goto(`/#/${tokenId}`);
    await expect(destino(page, 'Inbox')).toHaveAttribute('aria-current', 'page');

    await page.evaluate(() => {
      const solto = document.createElement('p');
      solto.id = 'fora-de-marco';
      solto.textContent = 'texto fora de marco';
      document.body.append(solto);
    });
    await expect(expectSemViolacoes(page, 'texto fora de marco')).rejects.toThrow(
      /moderate region/,
    );
    await page.evaluate(() => document.getElementById('fora-de-marco')?.remove());

    // O menu do Material abre no `.cdk-overlay-container`, que não está em marco nenhum. Ele abre depois de o texto
    // solto sair: a medida que acompanha o que abre por cima roda sozinha e pegaria os dois juntos.
    await page.getByRole('button', { name: 'More list actions' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expectSemViolacoes(page, 'com um menu aberto');
  });

  test('deve medir o diálogo que abre e fecha no meio do teste', async ({
    page,
    tokens,
    axePorCima,
  }) => {
    await page.goto(`/#/${await tokens.create()}/checks`);
    await expect(destino(page, 'Checks')).toHaveAttribute('aria-current', 'page');
    // Um contraste ruim que só existe dentro de um diálogo: com ele fechado, o axe do fim do teste não vê.
    await page.addStyleTag({
      content: '[role="dialog"] h2 { color: #bbb !important; background: #fff !important; }',
    });

    await page.getByRole('button', { name: 'Settings' }).click();
    const vistas: string[] = [];
    await expect
      .poll(async () => {
        vistas.push(...((await axePorCima?.colher()) ?? []));
        return vistas.join('\n');
      })
      .toContain('color-contrast');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('deve medir na colheita o diálogo que acabou de abrir, sem deixar a medida para depois', async ({
    page,
    tokens,
    axePorCima,
  }) => {
    await page.goto(`/#/${await tokens.create()}/checks`);
    await expect(destino(page, 'Checks')).toHaveAttribute('aria-current', 'page');

    await page.evaluate(() => {
      const dialogo = document.createElement('div');
      dialogo.id = 'dialogo-de-teste';
      dialogo.setAttribute('role', 'dialog');
      dialogo.setAttribute('aria-label', 'Diálogo de teste');
      const texto = document.createElement('p');
      texto.style.cssText = 'color: #bbb; background: #fff';
      texto.textContent = 'texto de contraste ruim';
      dialogo.append(texto);
      document.querySelector('main')?.append(dialogo);
    });

    expect((await axePorCima?.colher())?.join('\n')).toContain('color-contrast');

    await page.evaluate(() => document.getElementById('dialogo-de-teste')?.remove());
  });
});

// Em série, no mesmo worker: o primeiro teste falha de propósito (`test.fail`) e o segundo confere o que a guarda
// deixou para trás na desmontagem dele.
test.describe('Dado um teste que falha com a medida do que abriu por cima no ar', () => {
  test.describe.configure({ mode: 'serial' });
  let medindo = 0;
  let sobrou: { erros: number; medindo: number } | undefined;

  const falho = test.extend({
    // A página desmonta depois do vigia: é o último ponto antes de o contexto fechar.
    page: async ({ page }, use, testInfo) => {
      const esperar = page.waitForFunction.bind(page);
      page.waitForFunction = ((...args: Parameters<typeof esperar>) => {
        medindo++;
        return esperar(...args).finally(() => medindo--);
      }) as typeof page.waitForFunction;
      await use(page);
      sobrou = { erros: testInfo.errors.length, medindo };
    },
  });

  falho.fail('falha de propósito logo depois de abrir um diálogo', async ({ page, tokens }) => {
    await page.goto(`/#/${await tokens.create()}/checks`);
    await expect(destino(page, 'Checks')).toHaveAttribute('aria-current', 'page');
    await page.evaluate(() => {
      const dialogo = document.createElement('div');
      dialogo.setAttribute('role', 'dialog');
      dialogo.setAttribute('aria-label', 'Diálogo de teste');
      dialogo.textContent = 'diálogo de teste';
      document.querySelector('main')?.append(dialogo);
      // A medida espera as animações acabarem: esta a segura no começo, e é o que está no ar na hora da falha.
      dialogo.animate([{ opacity: 0.99 }, { opacity: 1 }], 1000);
    });
    await expect.poll(() => medindo).toBe(1);

    throw new Error('falha de propósito');
  });

  test('deve terminar só com a falha dele, e com a medida acabada antes de o contexto fechar', () => {
    expect(sobrou).toEqual({ erros: 1, medindo: 0 });
  });
});
