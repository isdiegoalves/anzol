import { Locator, Page } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import { expect, test } from './support/fixtures';
import { busca } from './support/inbox';

const barra = (page: Page) => page.getByRole('toolbar', { name: 'Filters' });
const botaoFiltros = (page: Page) => busca(page).getByRole('button', { name: /^Filters/ });
const dentro = (onde: Locator) => onde.evaluate((no) => no.contains(document.activeElement));

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
