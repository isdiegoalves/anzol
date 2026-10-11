import { createHmac } from 'node:crypto';
import { Page } from '@playwright/test';
import { anunciados, escutarAnuncios } from './support/anuncios';
import { expect, test } from './support/caos';
import { abrirChecks, escolherProvedor } from './support/checks';
import { acoes, itens } from './support/inbox';
import { seedStorage } from './support/storage';

const SEGREDO = 'whsec_regioes_vivas';

/**
 * A região viva que diz `texto` existia vazia antes dele: criada já com o texto, o leitor de tela não a
 * anuncia.
 */
async function expectNasceuVazia(page: Page, texto: RegExp): Promise<void> {
  const falas = async () => (await anunciados(page)).filter((anuncio) => texto.test(anuncio.texto));
  await expect
    .poll(async () => (await falas()).length, `a região de ${String(texto)}`)
    .toBeGreaterThan(0);
  expect(
    (await falas()).map((anuncio) => anuncio.nasceuComTexto),
    `a região de ${String(texto)} existe vazia antes do texto`,
  ).not.toContain(true);
}

test.describe('Dado uma região viva que só aparece quando tem o que dizer', () => {
  test.beforeEach(async ({ page }) => {
    await escutarAnuncios(page);
    await seedStorage(page, {});
  });

  test('deve nascer vazia a de "Loading this URL…", em Checks', async ({ page, tokens, caos }) => {
    const tokenId = await tokens.create();
    caos.atrasar(new RegExp(`^/token/${tokenId}$`), 1500, 'GET');

    await page.goto(`/#/${tokenId}/checks`);

    await expectNasceuVazia(page, /^Loading this URL…$/);
  });

  test('deve nascer vazia a de "Counting the requests…", em Insights', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId);
    caos.atrasar(new RegExp(`^/token/${tokenId}/`), 1500, 'GET');

    await page.goto(`/#/${tokenId}/insights`);

    await expectNasceuVazia(page, /^Counting the requests…$/);
  });

  test('deve nascer vazia a do aviso de troca de idioma, em Settings', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();

    await page.getByRole('radio', { name: 'Português (Brasil)' }).click();

    await expectNasceuVazia(page, /^The language changes when the page reloads\./);
  });

  test('deve nascer vazia a faixa de quem escolhe a B do Compare, na lista', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/b' });
    const a = await tokens.send(tokenId, { path: '/a' });
    await page.goto(`/#/${tokenId}/${a}/1`);
    await expect(itens(page)).toHaveCount(2);

    await acoes(page)
      .getByRole('button', { name: /^Compare with/ })
      .click();

    await expectNasceuVazia(page, /^Choose a request to compare with #/);
  });

  test('deve nascer vazia a faixa do modo Compare, na página dele', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const b = await tokens.send(tokenId, { path: '/b' });
    const a = await tokens.send(tokenId, { path: '/a' });

    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);

    await expectNasceuVazia(page, /^Compare mode\. Click a request to make it B\./);
  });

  test('deve nascer vazia a faixa da página do link só-leitura', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: 'x' });
    const link = await page.request.post(`/token/${tokenId}/request/${requestId}/share`, {
      data: {},
    });
    const { id } = (await link.json()) as { id: string };

    await page.goto(`/#/share/${id}`);

    await expectNasceuVazia(page, /^Shared read-only link · expires /);
  });

  test('deve nascer vazia cada aviso de troca de provedor, na assinatura de Checks', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SEGREDO } });
    const cartao = await abrirChecks(page, tokenId, 'Signature verification');

    await escolherProvedor(cartao, 'Shopify');
    await expectNasceuVazia(page, /Unsaved: switching from GitHub \(saved\) to Shopify\./);

    await escolherProvedor(cartao, 'None');
    await expectNasceuVazia(page, /^Saving turns signature verification off\./);
  });

  test('deve nascer vazia a do aviso de assinatura velha, no Replay', async ({ page, tokens }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'stripe', secret: SEGREDO, toleranceSeconds: 300 },
    });
    const velho = Math.floor(Date.now() / 1000) - 3600;
    const corpo = '{"id":"evt_1"}';
    const v1 = createHmac('sha256', SEGREDO).update(`${velho}.${corpo}`).digest('hex');
    const requestId = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${velho},v1=${v1}` },
      data: corpo,
    });

    await page.goto(`/#/${tokenId}/outbound?replay=${requestId}`);

    await expectNasceuVazia(page, /signature in this request is older than the tolerance/);
  });

  test('deve dizer só a contagem do teste contra o histórico, e não o painel inteiro, em Regras', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { path: '/pedidos' });
    await page.goto(`/#/${tokenId}/rules/new?from=${requestId}`);

    await page.getByRole('button', { name: 'Test against history' }).click();

    await expect(page.getByRole('group', { name: 'History test' })).toBeVisible();
    await expectNasceuVazia(page, /would match/);
    expect(
      (await anunciados(page))
        .filter((anuncio) => anuncio.texto.includes('would match'))
        .map((anuncio) => anuncio.texto),
    ).toEqual(['1 of the 1 most recent requests would match']);
  });

  test('deve dizer só a linha do resultado, e não o detalhe inteiro, no Outbound', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { path: '/pedidos', data: 'x' });
    await page.request.post(`/token/${tokenId}/request/${requestId}/replay`, {
      data: { url: 'http://localhost:9/sem-ninguem' },
    });

    await page.goto(`/#/${tokenId}/outbound`);

    const detalhe = page.getByRole('region', { name: 'Outbound detail' });
    await expect(detalhe.getByRole('button', { name: 'Copy as curl' })).toBeVisible();
    await expectNasceuVazia(page, / ms Replay · #/);
    const falas = (await anunciados(page)).filter((anuncio) =>
      / ms Replay · #/.test(anuncio.texto),
    );
    expect(falas.map((anuncio) => anuncio.texto)).toEqual([
      expect.stringMatching(/^\S.* \d+ ms Replay · #[0-9a-f]{5} · [^·]+$/),
    ]);
    expect(falas[0].texto).not.toContain('Copy as curl');
  });
});
