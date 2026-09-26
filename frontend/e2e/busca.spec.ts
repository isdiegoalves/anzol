import { createHmac } from 'node:crypto';
import { Page, Request } from '@playwright/test';
import { Webhook, expect, test } from './support/fixtures';

// Busca e filtros rápidos (CA-5): o texto e os filtros Method, Signature e Schema reduzem a
// lista; com filtro ativo, a mensagem nova que casa aparece e a que não casa não; "Clear
// filters" volta à lista completa. Precisa do backend com `POST /token/{id}/requests/search`.

const SCREENS = process.env['SCREENS_DIR'];
const SECRET = 'segredo-da-busca';
const PEDIDO = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
};

async function screenshot(page: Page, name: string) {
  if (SCREENS) {
    await page.screenshot({ path: `${SCREENS}/${name}.png`, animations: 'disabled' });
  }
}

/** JSON assinado como o GitHub manda; `secret` errado dá assinatura inválida. */
function signed(body: string, secret: string): Webhook {
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    data: body,
  };
}

/** A próxima busca cujo corpo contém `fragment` (outra busca pode estar a caminho). */
function searchRequest(page: Page, fragment: string): Promise<Request> {
  return page.waitForRequest(
    (sent) =>
      sent.method() === 'POST' &&
      sent.url().endsWith('/requests/search') &&
      (sent.postData() ?? '').includes(fragment),
  );
}

/** Escolhe no `mat-select` e fecha o painel (o de Method é de múltipla escolha). */
async function choose(page: Page, label: string, option: string) {
  // Espera o painel abrir e fechar: reabrir o select durante a animação de fechamento desmonta o painel novo.
  await page.getByRole('combobox', { name: label }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: option, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

async function openListening(page: Page, path: string, tokenId: string): Promise<void> {
  const stream = page.waitForResponse((response) =>
    response.url().endsWith(`/token/${tokenId}/stream`),
  );
  await page.goto(path);
  expect((await stream).status()).toBe(200);
}

const items = (page: Page) => page.locator('.item');
const item = (page: Page, uuid: string) =>
  page.locator('.item').filter({ hasText: `#${uuid.substring(0, 5)}` });
const counter = (page: Page) => page.getByText(/^\d+ of \d+ requests$/);

test.describe('Dado a lista de uma URL com mensagens de vários tipos', () => {
  test('deve reduzir a lista pelo texto e pelo método e voltar à lista completa com "Clear filters"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const post = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"pedido":"PED-42","email":"ana@exemplo.com"}',
    });
    const get = await tokens.send(tokenId, { method: 'GET', path: '?pedido=ped-42' });
    await tokens.send(tokenId, { method: 'PUT', data: 'outra coisa' });
    await page.goto(`/#/${tokenId}`);
    await expect(items(page)).toHaveCount(3);
    await expect(counter(page)).toHaveCount(0);

    const busca = searchRequest(page, 'ped-42');
    await page.getByRole('searchbox', { name: 'Search' }).fill('ped-42');

    expect((await busca).postDataJSON()).toMatchObject({ text: 'ped-42', sorting: 'oldest' });
    await expect(items(page)).toHaveCount(2);
    await expect(item(page, post)).toBeVisible();
    await expect(item(page, get)).toBeVisible();
    await expect(counter(page)).toHaveText('2 of 3 requests');
    await screenshot(page, '01-busca-por-texto');

    const porMetodo = searchRequest(page, '"method"');
    await choose(page, 'Method', 'GET');

    expect((await porMetodo).postDataJSON()).toMatchObject({
      text: 'ped-42',
      match: { method: ['GET'] },
    });
    await expect(items(page)).toHaveCount(1);
    await expect(item(page, get)).toBeVisible();
    await expect(counter(page)).toHaveText('1 of 3 requests');

    await page.getByRole('button', { name: 'Clear filters' }).click();

    await expect(items(page)).toHaveCount(3);
    await expect(counter(page)).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'Requests (3)' })).toBeVisible();
  });

  test('deve filtrar por assinatura e por schema inválidos com o match das regras', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: SECRET },
      schema: PEDIDO,
    });
    const tudoValido = await tokens.send(tokenId, signed('{"id":1}', SECRET));
    const assinaturaInvalida = await tokens.send(tokenId, signed('{"id":2}', 'outro-segredo'));
    const schemaInvalido = await tokens.send(tokenId, signed('{"id":"3"}', SECRET));
    await page.goto(`/#/${tokenId}`);
    await expect(items(page)).toHaveCount(3);

    const porAssinatura = searchRequest(page, '"signature"');
    await choose(page, 'Signature', 'Invalid');

    expect((await porAssinatura).postDataJSON()).toMatchObject({ match: { signature: 'invalid' } });
    await expect(items(page)).toHaveCount(1);
    await expect(item(page, assinaturaInvalida)).toBeVisible();

    await choose(page, 'Signature', 'Any');
    const porSchema = searchRequest(page, '"schema"');
    await choose(page, 'Schema', 'Invalid');

    expect((await porSchema).postDataJSON()).toEqual(
      expect.objectContaining({ match: { schema: 'invalid' } }),
    );
    await expect(items(page)).toHaveCount(1);
    await expect(item(page, schemaInvalido)).toBeVisible();
    await expect(item(page, tudoValido)).toHaveCount(0);
    await screenshot(page, '02-filtro-schema-invalido');
  });
});

test.describe('Dado um filtro ativo com a tela recebendo em tempo real', () => {
  test('deve mostrar a mensagem nova que casa, não a que não casa, sem trocar a aberta', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const aberta = await tokens.send(tokenId, { data: 'casa amarela' });
    await tokens.send(tokenId, { data: 'casa azul' });
    await openListening(page, `/#/${tokenId}/${aberta}/1`, tokenId);
    await expect(page.locator('.req-id')).toHaveText(aberta);
    await page.getByRole('searchbox', { name: 'Search' }).fill('AMARELA');
    await expect(items(page)).toHaveCount(1);
    await expect(counter(page)).toHaveText('1 of 2 requests');

    const casa = await tokens.send(tokenId, { data: 'outra casa amarela' });

    await expect(item(page, casa)).toBeVisible();
    await expect(counter(page)).toHaveText('2 of 3 requests');

    const naoCasa = await tokens.send(tokenId, { data: 'casa verde' });

    await expect(counter(page)).toHaveText('2 of 4 requests');
    await expect(item(page, naoCasa)).toHaveCount(0);
    await expect(items(page)).toHaveCount(2);
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${aberta}/1$`));
    await expect(page.locator('.req-id')).toHaveText(aberta);
    await screenshot(page, '03-busca-ao-vivo');

    await page.getByRole('button', { name: 'Clear filters' }).click();

    await expect(items(page)).toHaveCount(4);
    await expect(item(page, naoCasa)).toBeVisible();
  });
});
