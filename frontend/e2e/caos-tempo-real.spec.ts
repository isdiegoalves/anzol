import { Page } from '@playwright/test';
import { escutarAnuncios, expectSemAnuncio, expectUmAnuncio } from './support/anuncios';
import { expect, test } from './support/caos';
import { campoDeBusca, item, lista } from './support/inbox';
import { estadoAoVivo } from './support/shell';

const rodape = (page: Page) => lista(page).locator('.range');
const tentarAgora = (page: Page) => page.getByRole('button', { name: 'Try again now' });
const pilula = (page: Page) => page.getByRole('button', { name: /\bnew requests?\b/ });

/** Espera o navegador tentar religar o `/stream` da URL e o proxy derrubar a tentativa. */
async function religacaoRecusada(page: Page, tokenId: string): Promise<void> {
  const tentativa = await page.waitForRequest((pedido) =>
    pedido.url().endsWith(`/token/${tokenId}/stream`),
  );
  expect(await tentativa.response()).toBeNull();
}

async function abrir(page: Page, caminho: string): Promise<void> {
  await page.goto(`/#/${caminho}`);
  await expect(page.getByRole('heading', { name: /^Requests \(\d+\)$/ })).toBeVisible();
  await expect(estadoAoVivo(page)).toContainText('Live');
}

test.describe('Dado o /stream de uma URL que cai e volta', () => {
  test('deve trazer todas as que chegaram durante uma queda longa, mesmo mais de uma página', async ({
    page,
    tokens,
    caos,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/antes' });
    await abrir(page, tokenId);

    caos.cortar(tokenId);
    await expect(tentarAgora(page)).toBeVisible({ timeout: 20_000 });
    await tokens.sendMany(tokenId, 60, 20);
    caos.soltar(tokenId);
    await tentarAgora(page).click();

    await expect(page.getByRole('heading', { name: 'Requests (61)' })).toBeVisible();
    await expect(rodape(page)).toHaveText('1–61 of 61');
  });

  test('não deve trazer como novas as que já existiam Quando a volta pega a URL aberta na página 3', async ({
    page,
    tokens,
    caos,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 120);
    const [antiga] = await tokens.listed(tokenId, 3);
    await abrir(page, `${tokenId}/${antiga.uuid}/3`);
    await expect(rodape(page)).toHaveText('101–120 of 120');

    caos.cortar(tokenId);
    await expect(tentarAgora(page)).toBeVisible({ timeout: 20_000 });
    caos.soltar(tokenId);
    const retomada = page.waitForResponse((resposta) =>
      resposta.url().includes('/requests?after='),
    );
    await tentarAgora(page).click();
    await retomada;

    await expect(estadoAoVivo(page)).toContainText('Live');
    await expect(rodape(page)).toHaveText('101–120 of 120');
    await expect(pilula(page)).toHaveCount(0);
  });

  test('deve pôr na lista as 3 que chegaram numa queda curta e dizer isso numa fala só', async ({
    page,
    tokens,
    caos,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 20);
    await escutarAnuncios(page);
    await abrir(page, tokenId);

    caos.cortar(tokenId);
    for (const n of [1, 2, 3]) {
      await tokens.send(tokenId, { path: `/na-queda-${n}` });
    }
    caos.soltar(tokenId);

    await expectUmAnuncio(
      page,
      /^3 requests arrived during a brief connection drop\.$/,
      /^Connection$/,
    );
    await expectSemAnuncio(page, /^New request: |^\d+ new requests?;/);
    await expect(estadoAoVivo(page)).toContainText('Live');
    await tokens.send(tokenId, { path: '/depois' });
    await expect(page.getByRole('heading', { name: 'Requests (24)' })).toBeVisible();
    await expect(rodape(page)).toHaveText('1–24 of 24');
  });

  test('não deve alternar "Connected again" e a queda Quando só o /stream fica fora e a API responde', async ({
    page,
    tokens,
    caos,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/antes' });
    await escutarAnuncios(page);
    await abrir(page, tokenId);

    caos.cortar(tokenId);
    await expect(tentarAgora(page)).toBeVisible({ timeout: 20_000 });
    await expectUmAnuncio(page, /^Live updates dropped; reconnecting\.$/, /^Connection$/);
    for (let vez = 0; vez < 3; vez++) {
      await religacaoRecusada(page, tokenId);
    }
    await expectSemAnuncio(page, /^Connected again/);
    await expect(tentarAgora(page)).toBeVisible();
    caos.soltar(tokenId);

    await expectUmAnuncio(page, /^Connected again\.$/, /^Connection$/);
    await expect(estadoAoVivo(page)).toContainText('Live');
  });
});

test.describe('Dado a Entrada que lê a lista e depois assina o tempo real', () => {
  test('deve mostrar a que chega entre a leitura da lista e a assinatura', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/antes' });
    const listagem = caos.segurar(new RegExp(`^/token/${tokenId}/requests\\?`));

    await page.goto(`/#/${tokenId}`);
    await listagem.respondida;
    const noMeio = await tokens.send(tokenId, { path: '/no-meio' });
    listagem.soltar();

    await expect(estadoAoVivo(page)).toContainText('Live');
    await expect(item(page, noMeio)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Requests (2)' })).toBeVisible();
  });
});

test.describe('Dado o /stream recusado por um proxy na frente do app', () => {
  test('deve reabrir sozinha o /stream recusado com 503 e receber a que chega depois', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/antes' });
    const pararDeRecusar = caos.recusar(new RegExp(`^/token/${tokenId}/stream`));
    const recusado = page.waitForResponse((resposta) =>
      resposta.url().endsWith(`/token/${tokenId}/stream`),
    );

    await page.goto(`/#/${tokenId}`);
    expect((await recusado).status()).toBe(503);
    await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
    pararDeRecusar();

    await expect(estadoAoVivo(page)).toContainText('Live', { timeout: 10_000 });
    const depois = await tokens.send(tokenId, { path: '/depois-do-503' });
    await expect(item(page, depois)).toBeVisible();
  });
});

test.describe('Dado o /stream que para de receber sem fechar', () => {
  test('deve dizer "No signal" em até dois heartbeats e a folga, e mostrar o que chegou quando ele volta', async ({
    page,
    tokens,
    caos,
  }) => {
    test.setTimeout(120_000);
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/antes' });
    await escutarAnuncios(page);
    await abrir(page, tokenId);

    expect(caos.congelar(tokenId)).toBe(1);
    const muda = await tokens.send(tokenId, { path: '/no-silencio' });
    await expect.poll(() => caos.engolidos(tokenId)).toBeGreaterThan(0);
    await expect(estadoAoVivo(page)).toContainText('No signal', { timeout: 40_000 });
    await expectUmAnuncio(
      page,
      /^No signal from the server since \d{1,2}:\d{2}.*\. The list may be incomplete\.$/,
      /^Connection$/,
    );
    caos.soltar(tokenId);

    await expect(item(page, muda)).toBeVisible({ timeout: 15_000 });
    await expectUmAnuncio(
      page,
      /^Connected again\. 1 request arrived meanwhile\.$/,
      /^Connection$/,
    );
    await expect(estadoAoVivo(page)).toContainText('Live');
  });
});

test.describe('Dado a rede que some sem avisar: a API cai sem resposta e o /stream segue aberto, mudo', () => {
  test('deve tirar o chip de "Live" junto com a faixa e, na volta, dizer uma vez "Connected again." com a que chegou', async ({
    page,
    tokens,
    caos,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedidos/antes' });
    await escutarAnuncios(page);
    await abrir(page, tokenId);

    expect(caos.congelar(tokenId)).toBe(1);
    const voltar = caos.derrubar(new RegExp(`^/token/${tokenId}/(?!stream)`));
    await campoDeBusca(page).fill('pedidos');
    await expect(tentarAgora(page)).toBeVisible();
    await expect(estadoAoVivo(page)).toContainText('Reconnecting…', { timeout: 4_000 });
    await expectUmAnuncio(
      page,
      /^No connection to the server since \d{1,2}:\d{2}.*\. What you typed is kept\.$/,
      /^Connection$/,
    );
    const naQueda = await tokens.send(tokenId, { path: '/pedidos/na-queda' });
    voltar();
    caos.soltar(tokenId);

    await expect(estadoAoVivo(page)).toContainText('Live', { timeout: 20_000 });
    await expectUmAnuncio(
      page,
      /^Connected again\. 1 request arrived meanwhile\.$/,
      /^Connection$/,
    );
    await expectSemAnuncio(page, /brief connection drop|Live updates dropped|No signal/);
    await expect(item(page, naQueda)).toBeVisible();
  });
});

test.describe('Dado um pedido só que cai sem resposta, com o /stream vivo', () => {
  test('deve dizer "Connected again." uma vez e refazer a busca sozinha, sem "Could not search"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedidos/antes' });
    await escutarAnuncios(page);
    await abrir(page, tokenId);

    await page.route(/\/requests\/search$/, (rota) => rota.abort('connectionreset'), {
      times: 1,
    });
    await campoDeBusca(page).fill('pedidos');

    await expectUmAnuncio(page, /^Connected again\.$/, /^Connection$/);
    await expect(
      page.getByText('1 request matches · search runs on the server over all 1'),
    ).toBeVisible();
    await expect(estadoAoVivo(page)).toContainText('Live');
    await expectSemAnuncio(page, /Could not search/);
    await expect(page.getByText(/Could not search/)).toHaveCount(0);
  });
});
