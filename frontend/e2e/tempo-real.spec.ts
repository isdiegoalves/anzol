import { Page } from '@playwright/test';
import { anunciados, escutarAnuncios, expectSoEstaFala, limparAnuncios } from './support/anuncios';
import { expect, test } from './support/fixtures';
import {
  aba,
  abrirAba,
  anuncios,
  corpo as corpoDoDetalhe,
  detalhes,
  expectCorpo,
  item,
  linhas,
  textoDoCorpo,
} from './support/inbox';
import { seedStorage } from './support/storage';

// Checklist 7 e 13, e o auto-navegar do 9. Precisam do SSE (`GET /token/{id}/stream`, item 02).
// Item 14, E4 — mudança de CENÁRIO (§3 item 4): o snackbar "Request received" de 1 s sai. A chegada entra na lista
// com destaque, é anunciada pelo `LiveAnnouncer` (agregado, no máximo a cada 5 s) e, com uma mensagem aberta e
// "Follow new" desligado, a tela não pula: aparece a pílula "↑ N new request(s)" (C §2.8). "Auto Navigate" vira o
// `switch "Follow new"` (mesma chave `autoNavEnable`, S13/S14).
// SUPOSIÇÕES: o anúncio contém "1 new request" (ou "N new requests"); a pílula é um `button` com
// "N new request(s)" no nome.

/** Abre a URL e espera o `EventSource` receber os cabeçalhos (assinatura pronta no servidor). */
async function openListening(page: Page, tokenId: string): Promise<void> {
  const stream = page.waitForResponse((response) =>
    response.url().endsWith(`/token/${tokenId}/stream`),
  );
  await page.goto(`/#/${tokenId}`);
  expect((await stream).status()).toBe(200);
}

/** Os pedidos de lista e de busca da URL que terminam daqui em diante, com os bytes da resposta de cada um. */
function medirPedidosDaLista(
  page: Page,
  tokenId: string,
): { caminho: string; corpo: unknown; bytes: number }[] {
  const pedidos: { caminho: string; corpo: unknown; bytes: number }[] = [];
  page.on('requestfinished', async (sent) => {
    const url = new URL(sent.url());
    if (!url.pathname.startsWith(`/token/${tokenId}/requests`)) {
      return;
    }
    const tamanho = await sent.sizes();
    pedidos.push({
      caminho: `${sent.method()} ${url.pathname.replace(tokenId, '{id}')}${url.search}`,
      corpo: sent.postDataJSON(),
      bytes: tamanho.responseHeadersSize + tamanho.responseBodySize,
    });
  });
  return pedidos;
}

test.describe('Dado a tela aberta recebendo em tempo real (checklist 7)', () => {
  let tokenId: string;

  test.beforeEach(async ({ page, tokens }) => {
    tokenId = await tokens.create();
    await seedStorage(page, {});
  });

  test('deve dizer só a chegada, e acertar a contagem do filtro sem falar por ela, Quando chega uma que casa com o filtro ligado', async ({
    page,
    tokens,
  }) => {
    await tokens.send(tokenId, { path: '/fora' });
    await tokens.send(tokenId, { path: '/base-1' });
    await tokens.send(tokenId, { path: '/base-2' });
    await escutarAnuncios(page);
    const stream = page.waitForResponse((response) =>
      response.url().endsWith(`/token/${tokenId}/stream`),
    );
    await page.goto(`/#/${tokenId}?q=base`);
    expect((await stream).status()).toBe(200);
    const resultado = page.getByRole('search').locator('app-live-region.count');
    await expect(resultado).toContainText('2 requests match');
    await limparAnuncios(page);

    await tokens.send(tokenId, { path: '/base-3' });

    await expect(resultado).toContainText(
      '3 requests match · search runs on the server over all 4',
    );
    await expectSoEstaFala(
      page,
      /^New request: POST \/base-3; answered 200 by the default response\.$/,
    );
  });

  test('não deve falar nada, e acertar o total da linha do filtro, Quando chega uma que não casa com o filtro ligado', async ({
    page,
    tokens,
  }) => {
    await tokens.send(tokenId, { path: '/base-1' });
    await escutarAnuncios(page);
    const stream = page.waitForResponse((response) =>
      response.url().endsWith(`/token/${tokenId}/stream`),
    );
    await page.goto(`/#/${tokenId}?q=base`);
    expect((await stream).status()).toBe(200);
    const resultado = page.getByRole('search').locator('app-live-region.count');
    await expect(resultado).toContainText('1 request matches');
    await limparAnuncios(page);

    await tokens.send(tokenId, { path: '/outra' });

    await expect(resultado).toContainText(
      '1 request matches · search runs on the server over all 2',
    );
    await page.waitForTimeout(1_500);
    expect((await anunciados(page)).filter((anuncio) => !anuncio.nasceuComTexto)).toEqual([]);
  });

  test('deve pôr na lista a que casa sem pedido de lista nem de busca Quando o filtro é só de método e status', async ({
    page,
    tokens,
  }) => {
    await tokens.send(tokenId, { path: '/base-1' });
    await tokens.send(tokenId, { method: 'GET', path: '/base-2' });
    const stream = page.waitForResponse((response) =>
      response.url().endsWith(`/token/${tokenId}/stream`),
    );
    await page.goto(`/#/${tokenId}?methods=POST&answered=2xx`);
    expect((await stream).status()).toBe(200);
    const resultado = page.getByRole('search').locator('app-live-region.count');
    await expect(resultado).toContainText('1 request matches');
    const pedidos = medirPedidosDaLista(page, tokenId);

    const casa = await tokens.send(tokenId, { path: '/base-3' });
    const naoCasa = await tokens.send(tokenId, { method: 'GET', path: '/base-4' });

    await expect(resultado).toContainText(
      '2 requests match · search runs on the server over all 4',
    );
    await expect(item(page, casa)).toBeVisible();
    await expect(item(page, naoCasa)).toHaveCount(0);
    await page.waitForTimeout(1_000);
    expect(pedidos.map((pedido) => pedido.caminho)).toEqual([]);
    expect(pedidos.reduce((soma, pedido) => soma + pedido.bytes, 0)).toBeLessThanOrEqual(20_000);
  });

  test('deve pedir uma busca só por requisição que chega Quando o filtro tem texto, mesmo com duas páginas carregadas', async ({
    page,
    tokens,
  }) => {
    await tokens.sendMany(tokenId, 60);
    const stream = page.waitForResponse((response) =>
      response.url().endsWith(`/token/${tokenId}/stream`),
    );
    await page.goto(`/#/${tokenId}?q=POST`);
    expect((await stream).status()).toBe(200);
    const resultado = page.getByRole('search').locator('app-live-region.count');
    await expect(resultado).toContainText('60 requests match');
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.locator('.range')).toContainText('1–60 of 60');
    const pedidos = medirPedidosDaLista(page, tokenId);

    const nova = await tokens.send(tokenId, { path: '/nova' });

    await expect(resultado).toContainText(
      '61 requests match · search runs on the server over all 61',
    );
    await expect(page.locator('.range')).toContainText('1–61 of 61');
    await page.waitForTimeout(1_000);
    expect(pedidos.map((pedido) => pedido.caminho)).toEqual(['POST /token/{id}/requests/search']);
    expect(pedidos[0].corpo).toMatchObject({ text: 'POST', sorting: 'newest', page: 1 });
    await expect(item(page, nova)).toHaveCount(1);
  });

  test('deve conferir no servidor a contagem do filtro Quando a limpeza corta requisições que casavam e não estavam carregadas', async ({
    page,
    tokens,
  }) => {
    test.setTimeout(120_000);
    const noTeto = await tokens.create({ auto_cleanup: 500 });
    await tokens.sendMany(noTeto, 500);
    const stream = page.waitForResponse((response) =>
      response.url().endsWith(`/token/${noTeto}/stream`),
    );
    await page.goto(`/#/${noTeto}?methods=POST`);
    expect((await stream).status()).toBe(200);
    const resultado = page.getByRole('search').locator('app-live-region.count');
    await expect(resultado).toContainText(
      '500 requests match · search runs on the server over all 500',
    );
    const pedidos = medirPedidosDaLista(page, noTeto);

    for (let i = 0; i < 3; i++) {
      await tokens.send(noTeto, { method: 'GET', path: `/fora-${i}` });
    }

    await expect(resultado).toContainText(
      '497 requests match · search runs on the server over all 500',
      { timeout: 15_000 },
    );
    // A frase muda com a resposta; o pedido só entra na medida depois, quando o tamanho dele chega.
    await expect.poll(() => pedidos.length).toBeGreaterThanOrEqual(1);
    expect(pedidos.length).toBeLessThanOrEqual(2);
    for (const pedido of pedidos) {
      expect(pedido.caminho).toBe('POST /token/{id}/requests/search');
      expect(pedido.corpo).toMatchObject({ match: { method: ['POST'] }, per_page: 1 });
      expect(pedido.bytes).toBeLessThanOrEqual(20_000);
    }
  });

  test('deve mostrar a mensagem nova, anunciar e contar não lida no título Quando um webhook chega', async ({
    page,
    tokens,
  }) => {
    await openListening(page, tokenId);
    await expect(page.getByText('Waiting for first request...')).toBeVisible();

    const requestId = await tokens.send(tokenId, { data: 'ao vivo' });

    await expect(item(page, requestId)).toBeVisible();
    // A primeira de uma URL vazia é dita pela faixa "First request arrived", no lugar da fala comum.
    await expect(
      anuncios(page).filter({ hasText: /^First request arrived: POST \/, at \d{1,2}:\d{2}/ }),
    ).toHaveCount(1, { timeout: 15_000 });
    await expect(anuncios(page).filter({ hasText: /^New request: POST \// })).toHaveCount(0);
    await expect(page.getByText('Request received')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
    await expect(detalhes(page)).toContainText(requestId);
    await expectCorpo(page, 'ao vivo');
    const segunda = await tokens.send(tokenId, { data: 'segunda' });
    await expect(page).toHaveTitle(`(1) Inbox · URL ${tokenId.substring(0, 5)} · Anzol`);
    // Com a primeira aberta, a segunda não rouba o detalhe: entra na lista e na pílula.
    await expect(item(page, segunda)).toBeVisible();
    await expect(page.getByRole('button', { name: /\b1 new request\b/ })).toBeVisible();
    await expect(detalhes(page)).toContainText(requestId);
  });

  test('deve ir para a mensagem nova Quando "Follow new" está ligado', async ({ page, tokens }) => {
    await tokens.send(tokenId, { data: 'antiga' });
    await seedStorage(page, { autoNavEnable: 'true' });
    await openListening(page, tokenId);
    await expect(page.getByRole('switch', { name: 'Follow new' })).toBeChecked();
    await expectCorpo(page, 'antiga');

    const nova = await tokens.send(tokenId, { data: 'nova' });

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${nova}/1$`));
    await expectCorpo(page, 'nova');
  });

  test('deve seguir na aba Headers Quando "Follow new" abre a mensagem nova', async ({
    page,
    tokens,
  }) => {
    const tentativa = async () =>
      (await linhas(page, 'Headers')).find((linha) => /^x-tentativa /i.test(linha))?.toLowerCase();
    await tokens.send(tokenId, { headers: { 'X-Tentativa': '1' }, data: 'antiga' });
    await seedStorage(page, { autoNavEnable: 'true' });
    await openListening(page, tokenId);
    await expectCorpo(page, 'antiga');
    await abrirAba(page, 'Headers');
    await expect.poll(tentativa).toBe('x-tentativa 1');

    const nova = await tokens.send(tokenId, { headers: { 'X-Tentativa': '2' }, data: 'nova' });

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${nova}/1$`));
    await expect.poll(tentativa).toBe('x-tentativa 2');
    await expect(aba(page, 'Headers')).toHaveAttribute('aria-selected', 'true');
  });

  test('deve buscar a mensagem inteira pela API Quando o evento chega truncado (> 1 MB, checklist 13)', async ({
    page,
    tokens,
  }) => {
    await openListening(page, tokenId);
    // 600.000 barras viram 1.200.000 caracteres no JSON do evento (`/` → `\/`): o servidor corta.
    const corpo = '/'.repeat(600_000);
    const detalhe = page.waitForResponse((response) =>
      new RegExp(`/token/${tokenId}/request/[0-9a-f-]{36}$`).test(response.url()),
    );

    const requestId = await tokens.send(tokenId, {
      data: corpo,
      headers: { 'content-type': 'text/plain' },
    });

    expect((await detalhe).url()).toContain(requestId);
    await expect(detalhes(page)).toContainText(requestId);
    await expect(corpoDoDetalhe(page)).toBeVisible();
    expect((await textoDoCorpo(page)).length).toBe(corpo.length);
  });

  test('deve dizer uma vez, com rota e status, a que chega fora da vista, e mostrar o aviso sem falar por ele', async ({
    page,
    tokens,
  }) => {
    await tokens.sendMany(tokenId, 40);
    await escutarAnuncios(page);
    await openListening(page, tokenId);
    await expect(page.getByRole('heading', { name: 'Requests (40)' })).toBeVisible();
    await page
      .locator('cdk-virtual-scroll-viewport')
      .evaluate((lista) => lista.scrollTo({ top: lista.scrollHeight }));
    await limparAnuncios(page);

    await tokens.send(tokenId, { path: '/fora-da-vista' });

    await expect(page.getByText('Request received · POST /fora-da-vista')).toBeVisible();
    await expectSoEstaFala(
      page,
      /^New request: POST \/fora-da-vista; answered 200 by the default response\.$/,
    );
  });
});
