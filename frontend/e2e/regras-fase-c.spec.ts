import { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { detalhes } from './support/inbox';
import { parte } from './support/regras';

// Regras de resposta, fase C (CA-10 no que é da tela, Anexo C): "Create rule from this request"
// no detalhe da mensagem e "Test against history" no editor. Precisa do backend com
// `POST /token/{id}/rules/test`.
// Item 14, E6: "Create rule from this request" leva a `#/{token}/rules/new?from={id}`, com o editor (`region "New
// rule"`) preenchido; "Test against history" fica no rodapé e abre a aba Test; salvar volta à lista (o aviso "View
// rules" deixa de existir). SUPOSIÇÕES em `support/regras.ts`.

const SCREENS = process.env['SCREENS_DIR'];

async function screenshot(page: Page, name: string) {
  if (SCREENS) {
    await page.screenshot({ path: `${SCREENS}/${name}.png`, animations: 'disabled' });
  }
}

async function getRules(api: APIRequestContext, tokenId: string) {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as Record<string, unknown>[];
}

/** Abre a mensagem no detalhe e clica em "Create rule from this request"; devolve o editor. */
async function createRuleFrom(
  page: Page,
  tokenId: string,
  requestId: string,
  shot?: string,
): Promise<Locator> {
  await page.goto(`/#/${tokenId}/${requestId}/1`);
  await expect(detalhes(page)).toContainText(requestId);
  if (shot) {
    await screenshot(page, shot);
  }
  await page.getByRole('button', { name: 'Create rule from this request' }).click();
  await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules/new\\?from=${requestId}$`));
  const dialog = page.getByRole('region', { name: 'New rule', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

const textbox = (dialog: Locator, name: string) =>
  dialog.getByRole('textbox', { name, exact: true });

/** Salva e espera o aviso; o editor fecha e a página volta à lista de regras. */
async function saveRule(page: Page, dialog: Locator) {
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/rules$/);
  await expect(page.getByText('Rule saved')).toBeVisible();
}

test.describe('Dado uma mensagem gravada e o botão "Create rule from this request"', () => {
  test('deve criar a regra da mensagem JSON no fim da lista e responder com ela Quando o mesmo webhook chega de novo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const existente = { name: 'Já existia', match: { path: { equals: '/outra' } } };
    expect((await request.put(`/token/${tokenId}/rules`, { data: [existente] })).status()).toBe(
      200,
    );
    const webhook = {
      path: '/pedidos?tipo=pix',
      headers: { 'Content-Type': 'application/json' },
      data: '{"id": 42, "itens": [1, 2]}',
    };
    const requestId = await tokens.send(tokenId, webhook);

    const dialog = await createRuleFrom(page, tokenId, requestId);
    await expect(textbox(dialog, 'Name')).toHaveValue('POST /pedidos');
    await expect(dialog.getByRole('combobox', { name: 'Methods' })).toHaveText('POST');
    await expect(dialog.getByRole('combobox', { name: 'Path match' })).toHaveText('Equals');
    await expect(textbox(dialog, 'Path')).toHaveValue('/pedidos');
    await expect(textbox(dialog, 'Query 1 name')).toHaveValue('tipo');
    await expect(textbox(dialog, 'Query 1 value')).toHaveValue('pix');
    await expect(dialog.getByRole('combobox', { name: 'Body 1 type' })).toHaveText('Equal to JSON');
    await expect(textbox(dialog, 'Body 1 value')).toHaveValue('{"id":42,"itens":[1,2]}');
    await expect(textbox(dialog, 'Header 1 name')).toHaveCount(0);
    await parte(dialog, 'Response');
    await expect(dialog.getByRole('spinbutton', { name: 'Status' })).toHaveValue('200');
    await expect(textbox(dialog, 'Response body')).toHaveValue('');
    await screenshot(page, '02-editor-preenchido-json');
    await dialog.getByRole('spinbutton', { name: 'Status' }).fill('201');
    await textbox(dialog, 'Response body').fill('{"pedido":"aceito"}');
    await saveRule(page, dialog);

    const regras = await getRules(request, tokenId);
    expect(regras.map((regra) => regra['name'])).toEqual(['Já existia', 'POST /pedidos']);
    expect(regras[1]).toMatchObject({
      priority: 5,
      match: {
        method: ['POST'],
        path: { equals: '/pedidos' },
        query: { tipo: { equals: 'pix' } },
        headers: {},
        body: [{ equalToJson: { id: 42, itens: [1, 2] } }],
      },
    });
    const denovo = await request.post(`/${tokenId}${webhook.path}`, {
      headers: webhook.headers,
      data: webhook.data,
    });
    expect(denovo.status()).toBe(201);
    expect(await denovo.text()).toBe('{"pedido":"aceito"}');
    // Chave em outra ordem continua casando (equalToJson); outro corpo, não.
    const reordenado = await request.post(`/${tokenId}${webhook.path}`, {
      headers: webhook.headers,
      data: '{"itens": [1, 2], "id": 42}',
    });
    expect(reordenado.status()).toBe(201);
    const outro = await request.post(`/${tokenId}${webhook.path}`, {
      headers: webhook.headers,
      data: '{"id": 43, "itens": [1, 2]}',
    });
    expect(outro.status()).toBe(200);
  });

  test('deve casar o corpo de formulário com "Equals" e responder com a regra Quando o mesmo formulário chega de novo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const webhook = {
      path: '/form',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'nome=Ana&idade=30',
    };
    const requestId = await tokens.send(tokenId, webhook);

    const dialog = await createRuleFrom(page, tokenId, requestId);
    await expect(textbox(dialog, 'Name')).toHaveValue('POST /form');
    await expect(dialog.getByRole('combobox', { name: 'Body 1 type' })).toHaveText('Equals');
    await expect(textbox(dialog, 'Body 1 value')).toHaveValue('nome=Ana&idade=30');
    await expect(textbox(dialog, 'Query 1 name')).toHaveCount(0);
    await screenshot(page, '03-editor-preenchido-formulario');
    await parte(dialog, 'Response');
    await textbox(dialog, 'Response body').fill('form-ok');
    await saveRule(page, dialog);

    const denovo = await request.post(`/${tokenId}${webhook.path}`, {
      headers: webhook.headers,
      data: webhook.data,
    });
    expect(denovo.status()).toBe(200);
    expect(await denovo.text()).toBe('form-ok');
    const lista = (await (
      await request.get(`/token/${tokenId}/requests`, { params: { sorting: 'newest' } })
    ).json()) as { data: { rule: { name: string } | null }[] };
    expect(lista.data[0].rule?.name).toBe('POST /form');
  });

  // Item 14, E6 — cenário trocado: o editor já está na página de regras; salvar volta à lista (sem "View rules").
  test('deve voltar à lista de regras com a regra nova Quando o editor aberto pela mensagem salva', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { method: 'PUT', path: '/itens/7' });

    const dialog = await createRuleFrom(page, tokenId, requestId);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'View rules' })).toHaveCount(0);

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules$`));
    await expect(
      page.getByRole('table', { name: 'Rules' }).locator('td.name', { hasText: 'PUT /itens/7' }),
    ).toBeVisible();
  });
});

test.describe('Dado o botão "Test against history" no editor', () => {
  test('deve dizer quantas mensagens casariam e por que as outras não, com o link da mensagem', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const casa = await tokens.send(tokenId, {
      path: '/pedidos',
      headers: { 'Content-Type': 'application/json' },
      data: '{"id": 1}',
    });
    const naoCasa = await tokens.send(tokenId, { method: 'GET', path: '/outra' });

    const dialog = await createRuleFrom(page, tokenId, casa, '01-detalhe-com-botao');
    await dialog.getByRole('button', { name: 'Test against history' }).click();

    await expect(dialog.getByRole('tab', { name: 'Test', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const result = dialog.getByRole('status', { name: 'History test' });
    await expect(result.locator('.summary')).toHaveText('1 of 2 recorded requests would match.');
    await expect(result.getByRole('heading', { name: 'Would not match (1)' })).toBeVisible();
    const falhas = result.locator('.failed li');
    await expect(falhas).toContainText([
      'method: expected POST, got GET',
      'path: expected "/pedidos", got "/outra"',
    ]);
    await screenshot(page, '04-teste-contra-historico');

    const link = result.getByRole('link', { name: `Open request ${naoCasa}` });
    await expect(link).toHaveText(`#${naoCasa.substring(0, 5)}`);
    const [aba] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    await expect(detalhes(aba)).toContainText(naoCasa);
    await expect(dialog).toBeVisible();
  });

  test('deve testar a regra como está no editor, sem salvar, e apagar o resultado Quando a regra muda', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const primeira = await tokens.send(tokenId, { method: 'GET', path: '/a' });
    await tokens.send(tokenId, { method: 'GET', path: '/b' });

    const dialog = await createRuleFrom(page, tokenId, primeira);
    await choosePathMode(page, dialog, 'Starts with');
    await textbox(dialog, 'Path').fill('/');
    await dialog.getByRole('button', { name: 'Remove body 1' }).click();
    await dialog.getByRole('button', { name: 'Test against history' }).click();

    const result = dialog.getByRole('status', { name: 'History test' });
    await expect(result.locator('.summary')).toHaveText('2 of 2 recorded requests would match.');
    await expect(result.locator('.misses')).toHaveCount(0);
    expect(await getRules(request, tokenId)).toEqual([]);

    await parte(dialog, 'Match');
    await textbox(dialog, 'Path').fill('/zzz');
    await expect(result).toHaveCount(0);
  });
});

async function choosePathMode(page: Page, dialog: Locator, option: string) {
  await dialog.getByRole('combobox', { name: 'Path match' }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
