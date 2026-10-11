import { Page } from '@playwright/test';
import { expect, test } from './support/caos';
import { campoDeBusca, itens } from './support/inbox';

interface Medida {
  /** A altura da faixa de agrupar, que fica acima da busca. */
  faixa: number;
  /** O alto do campo de busca: é onde o cursor de quem digita está. */
  campo: number;
  /** Da base do bloco da busca ao alto da primeira linha da lista. */
  primeiraLinha: number | null;
}

function medir(page: Page): Promise<Medida> {
  return page.evaluate(() => {
    const caixa = (seletor: string) => document.querySelector(seletor)?.getBoundingClientRect();
    const [faixa, campo, busca, linha] = [
      caixa('app-event-bar'),
      caixa('app-request-search input'),
      caixa('app-request-search'),
      caixa('app-request-list .item'),
    ];
    return {
      faixa: Math.round(faixa?.height ?? 0),
      campo: Math.round(campo?.top ?? 0),
      primeiraLinha: linha && busca ? Math.round(linha.top - busca.bottom) : null,
    };
  });
}

test.describe('Dado a oferta de agrupar por evento acima da busca', () => {
  test('deve guardar o lugar da oferta antes, durante e depois do filtro, sem mover a busca nem a lista', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    for (const [n, evento] of ['a', 'b', 'a', 'c', 'b', 'c'].entries()) {
      await tokens.send(tokenId, {
        path: `/pedidos-${n}`,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ event_id: `evt_${evento}`, n }),
      });
    }
    await page.goto(`/#/${tokenId}`);
    const oferta = page.getByRole('region', { name: 'Group by event' });
    await expect(oferta).toBeVisible();
    await expect(itens(page)).toHaveCount(6);
    const antes = await medir(page);
    expect(antes.faixa, 'a faixa ocupa lugar').toBeGreaterThan(0);
    const presa = caos.segurar(new RegExp(`^/token/${tokenId}/requests/search`), 'POST');

    await campoDeBusca(page).fill('pedidos');
    await presa.respondida;
    const durante = await medir(page);
    presa.soltar();
    await expect(page.getByRole('heading', { name: 'Requests (6 of 6)' })).toBeVisible();
    const depois = await medir(page);

    expect({ faixa: durante.faixa, campo: durante.campo }, 'durante a busca').toEqual({
      faixa: antes.faixa,
      campo: antes.campo,
    });
    expect(depois, 'com o resultado do filtro').toEqual(antes);
    await expect(oferta, 'a oferta guardada fica fora do alcance').toHaveCount(0);
    await expect(page.locator('app-event-bar .offer')).toHaveCSS('opacity', '0');

    await campoDeBusca(page).fill('');
    await expect(oferta).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Requests (6)' })).toBeVisible();
    expect(await medir(page), 'sem o filtro de novo').toEqual(antes);
  });
});
