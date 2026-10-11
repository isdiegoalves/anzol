import { Locator, Page } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import { expect, test } from './support/fixtures';
import { busca } from './support/inbox';
import { gravarRegras } from './support/regras';

const barra = (page: Page) => page.getByRole('toolbar', { name: 'Filters' });
const botaoFiltros = (page: Page) => busca(page).getByRole('button', { name: /^Filters/ });
const dentro = (onde: Locator) => onde.evaluate((no) => no.contains(document.activeElement));

/** Espera a tela desenhar dois quadros: o que a resposta disparou já está no DOM. */
async function desenhar(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((pronto) =>
        requestAnimationFrame(() => requestAnimationFrame(() => pronto())),
      ),
  );
}

test.describe('Dado o painel de filtros na janela larga', () => {
  test('deve ser uma barra de ferramentas "Filters", com uma parada de Tab e as setas entre os chips', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);
    await expect(botaoFiltros(page)).toBeVisible();

    await botaoFiltros(page).focus();
    await page.keyboard.press('Enter');
    await expect(barra(page)).toBeVisible();
    await page.keyboard.press('Tab');

    const chips = barra(page).getByRole('button');
    await expect(chips.first()).toBeFocused();
    await expect(barra(page).getByRole('group', { name: 'Method' })).toBeVisible();
    expect(
      await barra(page).evaluate(
        (no) => [...no.querySelectorAll('button')].filter((botao) => botao.tabIndex >= 0).length,
      ),
      'uma parada de Tab na barra',
    ).toBe(1);

    await page.keyboard.press('ArrowRight');
    await expect(chips.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(chips.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(chips.first()).toBeFocused();
    await expect(chips.first()).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Tab');
    expect(await dentro(barra(page)), 'o Tab sai da barra').toBe(false);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('deve deixar as setas com o menu de regras Quando um chip o abre', async ({
    page,
    tokens,
    request,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Primeira', priority: 1, match: { method: ['POST'] }, response: { status: 201 } },
      { name: 'Segunda', priority: 2, match: { method: ['GET'] }, response: { status: 202 } },
    ]);
    await page.goto(`/#/${tokenId}`);
    await botaoFiltros(page).click();
    const chip = barra(page).getByRole('button', { name: /^Answered by rule/ });

    const lidas = page.waitForResponse((resposta) => resposta.url().endsWith('/rules'));
    await chip.focus();
    await lidas;
    await page.keyboard.press('Enter');
    const regras = page.getByRole('menu', { name: 'Rules' }).getByRole('menuitem');
    await expect(regras.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');

    await expect(regras.nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(chip).toBeFocused();
    await expect(barra(page)).toBeVisible();
  });

  test('deve levar o foco à primeira regra Quando elas chegam com o menu já aberto', async ({
    page,
    tokens,
    request,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Primeira', priority: 1, match: { method: ['POST'] }, response: { status: 201 } },
      { name: 'Segunda', priority: 2, match: { method: ['GET'] }, response: { status: 202 } },
    ]);
    let soltar!: () => void;
    const presa = new Promise<void>((ok) => (soltar = ok));
    await page.route(`**/token/${tokenId}/rules`, async (rota) => {
      await presa;
      await rota.continue();
    });
    await page.goto(`/#/${tokenId}`);
    await botaoFiltros(page).click();
    const chip = barra(page).getByRole('button', { name: /^Answered by rule/ });
    const menu = page.getByRole('menu', { name: 'Rules' });

    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitem', { name: 'Loading the rules…' })).toBeVisible();
    await expect(menu).toBeFocused();
    soltar();

    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await expect(menu.getByRole('menuitem')).toHaveText(['Primeira', 'Segunda']);
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
  });

  test('não deve puxar o foco para o menu de regras Quando ele já foi fechado antes de elas chegarem', async ({
    page,
    tokens,
    request,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Primeira', priority: 1, match: { method: ['POST'] }, response: { status: 201 } },
    ]);
    let soltar!: () => void;
    const presa = new Promise<void>((ok) => (soltar = ok));
    await page.route(`**/token/${tokenId}/rules`, async (rota) => {
      await presa;
      await rota.continue();
    });
    await page.goto(`/#/${tokenId}`);
    await botaoFiltros(page).click();
    const chip = barra(page).getByRole('button', { name: /^Answered by rule/ });

    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Rules' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(chip).toBeFocused();
    const lidas = page.waitForResponse((resposta) => resposta.url().endsWith('/rules'));
    soltar();
    await lidas;
    await desenhar(page);

    await expect(chip).toBeFocused();
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
});

test.describe('Dado o painel de filtros no celular', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('deve abrir como diálogo "Filters", prender o foco e devolvê-lo ao botão no Esc', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);
    await botaoFiltros(page).focus();
    await page.keyboard.press('Enter');

    const dialogo = page.getByRole('dialog', { name: 'Filters' });
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toHaveAttribute('aria-modal', 'true');
    await expect(barra(page)).toBeVisible();
    await expect.poll(() => dentro(dialogo), 'o foco entra ao abrir').toBe(true);
    for (const tecla of [
      ...Array<string>(10).fill('Tab'),
      ...Array<string>(10).fill('Shift+Tab'),
    ]) {
      await page.keyboard.press(tecla);
      expect(await dentro(dialogo), `o foco fica no diálogo depois de ${tecla}`).toBe(true);
    }

    await page.keyboard.press('Escape');

    await expect(dialogo).toHaveCount(0);
    await expect(botaoFiltros(page)).toBeFocused();
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`Dado os filtros abertos no tema ${colorScheme} a ${viewport.width}×${viewport.height}`, () => {
      test.use({ colorScheme, viewport });

      test('deve passar no axe sem violação grave', async ({ page, tokens }) => {
        const tokenId = await tokens.create();
        await page.goto(`/#/${tokenId}`);
        await botaoFiltros(page).click();
        await expect(barra(page)).toBeVisible();

        await expectSemViolacoesGraves(
          page,
          `filtros abertos, ${colorScheme}, ${viewport.width} px`,
        );
      });
    });
  }
}
