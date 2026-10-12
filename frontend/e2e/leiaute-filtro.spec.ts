import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/caos';
import { abrirFiltros, busca, campoDeBusca, filtro, itens } from './support/inbox';
import { botaoDeFiltros, verResultado } from './support/patamar';

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

/** A caixa e a letra do botão: o que não muda quando um filtro liga. O fundo é o destaque, e muda. */
function aparencia(botao: Locator) {
  return botao.evaluate((el) => {
    const estilo = getComputedStyle(el);
    return {
      altura: Math.round(el.getBoundingClientRect().height),
      letra: estilo.fontSize,
      canto: estilo.borderRadius,
      recuo: estilo.paddingLeft,
      fundo: estilo.backgroundColor,
    };
  });
}

test.describe('Dado o botão "Filters" ao lado do campo de busca', () => {
  test('deve manter a altura do campo, a letra e o canto Quando um filtro é ligado, mudando só o destaque', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedidos' });
    await page.goto(`/#/${tokenId}`);
    const botao = botaoDeFiltros(page);
    await expect(botao).toHaveAccessibleName('Filters');
    const campo = await busca(page).locator('label').boundingBox();
    const { fundo: semDestaque, ...antes } = await aparencia(botao);
    expect(antes.altura, 'a altura do campo de busca').toBe(Math.round(campo?.height ?? 0));

    await abrirFiltros(page);
    await filtro(page, 'POST').click();
    await verResultado(page);
    await expect(botao).toHaveAccessibleName('Filters, 1 active');
    // Fora do botão: o realce de quem passa o mouse não é o destaque do filtro ligado.
    await campoDeBusca(page).hover();

    const { fundo: comDestaque, ...depois } = await aparencia(botao);
    expect(depois).toEqual(antes);
    expect(comDestaque, 'o destaque').not.toBe(semDestaque);
  });
});
