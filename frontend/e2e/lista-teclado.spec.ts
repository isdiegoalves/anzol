import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirItem, abrirMensagem, busca, itens, lista } from './support/inbox';

/** Tudo o que o Tab alcança dentro da lista desenhada, e não só os botões de linha. */
function tabulaveis(page: Page): Promise<string[]> {
  return lista(page)
    .locator('cdk-virtual-scroll-viewport')
    .evaluate((viewport) =>
      [
        ...viewport.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
        ),
      ]
        .filter(
          (each) =>
            each.tabIndex >= 0 &&
            !each.hasAttribute('disabled') &&
            each.getClientRects().length > 0,
        )
        .map((each) => each.getAttribute('aria-label') ?? each.textContent?.trim() ?? ''),
    );
}

const foraDaLista = (viewport: Locator) =>
  viewport.evaluate((element) => !element.contains(document.activeElement));

test.describe('Dado a lista pelo teclado', () => {
  test('deve parar duas vezes no Tab, na linha e na lixeira dela, com a lista cheia de selos', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    for (let i = 1; i <= 30; i++) {
      await tokens.send(tokenId, { path: `/${[200, 404, 500][i % 3]}/base-${i}` });
    }
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (30)' })).toBeVisible();
    await expect(itens(page).nth(10)).toBeVisible();

    const paradas = await tabulaveis(page);
    expect(paradas, 'a linha e a lixeira da linha, sem os selos').toHaveLength(2);

    const primeira = itens(page).first();
    await primeira.locator('button.select').focus();
    await page.keyboard.press('Tab');
    await expect(primeira.locator('button.delete')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await foraDaLista(lista(page).locator('cdk-virtual-scroll-viewport'))).toBe(true);
  });

  test('deve pousar numa linha à vista, sem a lista pular, Quando o Tab chega com a lista rolada para longe da parada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 45);
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (45)' })).toBeVisible();
    const viewport = lista(page).locator('cdk-virtual-scroll-viewport');
    await viewport.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));

    await expect.poll(() => tabulaveis(page), 'a linha e a lixeira dela').toHaveLength(2);
    const rolagem = await viewport.evaluate((element) => element.scrollTop);
    expect(rolagem).toBeGreaterThan(400);

    // O último tabulável antes da lista: o Tab dele entra nela.
    await viewport.evaluate((element) => {
      const antes = [
        ...document.querySelectorAll<HTMLElement>('a[href], button, input, [tabindex]'),
      ].filter(
        (each) =>
          each.tabIndex >= 0 &&
          each.getClientRects().length > 0 &&
          !!(each.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          !each.contains(element),
      );
      antes.at(-1)?.focus();
    });
    await page.keyboard.press('Tab');

    const pouso = await viewport.evaluate((element) => {
      const foco = document.activeElement as HTMLElement;
      const [caixa, janela] = [foco.getBoundingClientRect(), element.getBoundingClientRect()];
      return {
        naLista: element.contains(foco) && foco.classList.contains('select'),
        inteira: caixa.top >= janela.top - 1 && caixa.bottom <= janela.bottom + 1,
        rolagem: element.scrollTop,
      };
    });
    expect(pouso).toEqual({ naLista: true, inteira: true, rolagem });
  });

  test('deve filtrar pelo status respondido no detalhe só com o teclado, com o selo fora do Tab (CA-12)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/200/fica-fora' });
    const alvo = await tokens.send(tokenId, { path: '/404/base' });
    await abrirMensagem(page, tokenId, alvo);
    await expect(abrirItem(page, alvo)).toBeVisible();

    const resposta = page.getByRole('button', { name: /^Answer: 404\. Value actions$/ });
    await resposta.focus();
    await page.keyboard.press('Enter');
    const filtrar = page.getByRole('menuitem', { name: 'Filter by this value', exact: true });
    await expect(filtrar).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(busca(page).getByRole('list', { name: 'Active filters' })).toContainText('404');
    await expect(itens(page)).toHaveCount(1);
  });
});
