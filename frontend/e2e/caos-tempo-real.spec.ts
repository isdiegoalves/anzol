import { Page } from '@playwright/test';
import { escutarAnuncios, expectSemAnuncio, expectUmAnuncio } from './support/anuncios';
import { expect, test } from './support/caos';
import { item, lista } from './support/inbox';
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
    await expectSemAnuncio(page, /new requests? arrived/);
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
