import { APIRequestContext, Locator, Page } from '@playwright/test';
import { Webhook, expect, test } from './support/fixtures';

// Validação de schema por URL (CA-5, o que é da tela): configurar pelo Edit URL, selo na
// mensagem com os erros, gerar o schema de uma mensagem e condição "Schema" no editor de regras.
// Precisa do backend com `schema` no token, na mensagem e em `match.schema`.

const SCREENS = process.env['SCREENS_DIR'];
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
/** Pedido: `id` inteiro e `itens` com `sku` texto, os dois obrigatórios. */
const PEDIDO = {
  $schema: DRAFT,
  type: 'object',
  properties: {
    id: { type: 'integer' },
    itens: {
      type: 'array',
      items: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
    },
  },
  required: ['id', 'itens'],
};
const VALIDO = '{"id": 42, "itens": [{"sku": "A1"}]}';
const INVALIDO = '{"id": "42", "itens": [{"qtd": 1}]}';

async function screenshot(page: Page, name: string) {
  if (SCREENS) {
    await page.screenshot({ path: `${SCREENS}/${name}.png`, animations: 'disabled' });
  }
}

function json(body: string): Webhook {
  return { headers: { 'Content-Type': 'application/json' }, data: body };
}

async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function openEditUrl(page: Page, tokenId: string): Promise<Locator> {
  await page.goto(`/#/${tokenId}`);
  // O diálogo abre com o token carregado do servidor (antes disso, o do localStorage).
  await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
    new RegExp(`/${tokenId}$`),
  );
  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit URL' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Clica em "Edit" no diálogo e devolve o corpo do `PUT /token/{id}`. */
async function submitEdit(page: Page, dialog: Locator, tokenId: string) {
  const put = page.waitForRequest(
    (sent) => sent.method() === 'PUT' && sent.url().endsWith(`/token/${tokenId}`),
  );
  await dialog.getByRole('button', { name: 'Edit' }).click();
  const body = (await put).postDataJSON() as Record<string, unknown>;
  await expect(page.getByText('URL updated!')).toBeVisible();
  return body;
}

async function openRequest(page: Page, tokenId: string, requestId: string) {
  await page.goto(`/#/${tokenId}/${requestId}/1`);
  await expect(page.locator('.req-id')).toHaveText(requestId);
}

/** Caminhos (JSON Pointer) dos erros listados no selo. */
function errorPaths(page: Page) {
  return page.locator('app-schema-badge li code');
}

async function getRules(api: APIRequestContext, tokenId: string) {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as Record<string, unknown>[];
}

test.describe('Dado a seção "Schema validation" do Edit URL', () => {
  test('deve validar com o schema colado pela tela e marcar as mensagens válida, inválida e sem JSON', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await openEditUrl(page, tokenId);
    const field = dialog.getByRole('textbox', { name: 'JSON Schema' });

    await expect(field).toHaveValue('');
    await field.fill('{"type": ');
    await field.blur();
    await expect(dialog.getByText(/^Invalid JSON: /)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Edit' })).toBeDisabled();
    await field.fill(JSON.stringify(PEDIDO, null, 2));
    await field.scrollIntoViewIfNeeded();
    await screenshot(page, '01-edit-url-schema');
    const put = await submitEdit(page, dialog, tokenId);

    expect(put['schema']).toEqual(PEDIDO);
    expect(await tokens.read(tokenId)).toMatchObject({ schema: PEDIDO });

    const valida = await tokens.send(tokenId, json(VALIDO));
    const invalida = await tokens.send(tokenId, json(INVALIDO));
    const semJson = await tokens.send(tokenId, { data: 'nome=Ana' });

    await openRequest(page, tokenId, valida);
    await expect(page.locator('app-schema-badge')).toHaveText('Schema valid');
    await expect(page.locator('app-schema-badge .valid')).toBeVisible();
    await screenshot(page, '02-selo-valido');

    await openRequest(page, tokenId, invalida);
    await expect(page.locator('app-schema-badge .invalid p')).toHaveText('Schema invalid');
    await expect(errorPaths(page)).toContainText(['/id']);
    await expect(errorPaths(page).filter({ hasText: /^\/itens\/0/ })).not.toHaveCount(0);
    await screenshot(page, '03-selo-invalido-com-erros');

    await openRequest(page, tokenId, semJson);
    await expect(page.locator('app-schema-badge li')).toHaveText(['(root) body is not JSON']);
  });

  test('deve mostrar no campo o erro do servidor, manter o diálogo aberto e desligar pelo "Clear schema"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ schema: PEDIDO });
    const dialog = await openEditUrl(page, tokenId);
    const field = dialog.getByRole('textbox', { name: 'JSON Schema' });

    await expect(field).toHaveValue(JSON.stringify(PEDIDO, null, 2));
    await field.fill('{"$ref": "https://exemplo.com/pedido.json"}');
    const recusa = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.status() === 422,
    );
    await dialog.getByRole('button', { name: 'Edit' }).click();
    await recusa;

    await expect(dialog.getByText(/^The schema is invalid: /)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Edit' })).toBeDisabled();
    await field.scrollIntoViewIfNeeded();
    await screenshot(page, '04-edit-url-erro-do-servidor');
    expect(await tokens.read(tokenId)).toMatchObject({ schema: PEDIDO });

    await dialog.getByRole('button', { name: 'Clear schema' }).click();
    await expect(field).toHaveValue('');
    const put = await submitEdit(page, dialog, tokenId);

    expect(put['schema']).toBeNull();
    expect(await tokens.read(tokenId)).toMatchObject({ schema: null });
    const requestId = await tokens.send(tokenId, json(INVALIDO));
    await openRequest(page, tokenId, requestId);
    await expect(page.locator('app-schema-badge')).toHaveText('');
  });
});

test.describe('Dado "Create schema from this request"', () => {
  test('deve abrir o Edit URL com o schema inferido do corpo e, salvo, validar as mensagens seguintes', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const exemplo = await tokens.send(tokenId, json(VALIDO));
    const formulario = await tokens.send(tokenId, { data: 'nome=Ana' });

    await openRequest(page, tokenId, formulario);
    await expect(page.getByRole('button', { name: 'Create schema from this request' })).toHaveCount(
      0,
    );
    await expect(page.locator('app-schema-badge')).toHaveText('');

    await openRequest(page, tokenId, exemplo);
    await page.getByRole('button', { name: 'Create schema from this request' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit URL' });
    await expect(dialog).toBeVisible();
    const inferido = {
      $schema: DRAFT,
      type: 'object',
      properties: {
        id: { type: 'integer' },
        itens: {
          type: 'array',
          items: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
        },
      },
      required: ['id', 'itens'],
    };
    const field = dialog.getByRole('textbox', { name: 'JSON Schema' });
    await expect(field).toHaveValue(JSON.stringify(inferido, null, 2));
    await field.scrollIntoViewIfNeeded();
    await screenshot(page, '05-schema-inferido');
    const put = await submitEdit(page, dialog, tokenId);

    expect(put['schema']).toEqual(inferido);
    const igual = await tokens.send(tokenId, json('{"id": 7, "itens": []}'));
    const diferente = await tokens.send(tokenId, json('{"id": 7.5}'));
    await openRequest(page, tokenId, igual);
    await expect(page.locator('app-schema-badge')).toHaveText('Schema valid');
    await openRequest(page, tokenId, diferente);
    await expect(page.locator('app-schema-badge .invalid p')).toHaveText('Schema invalid');
    await expect(errorPaths(page)).toContainText(['/id']);
  });
});

test.describe('Dado a condição "Schema" no editor de regras', () => {
  test('deve responder 400 ao corpo fora do schema com a regra criada pela tela e explicar o near miss do válido', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ schema: PEDIDO });
    await page.goto(`/#/${tokenId}/rules`);
    await expect(page.getByRole('table', { name: 'Rules' })).toBeVisible();

    await page.getByRole('button', { name: 'New rule' }).click();
    const dialog = page.getByRole('dialog', { name: 'New rule' });
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Recusa fora do schema');
    await expect(dialog.getByRole('combobox', { name: 'Schema' })).toHaveText('Any');
    await choose(page, dialog.getByRole('combobox', { name: 'Schema' }), 'Invalid');
    await dialog.getByRole('spinbutton', { name: 'Status' }).fill('400');
    await dialog.getByRole('textbox', { name: 'Response body' }).fill('{"error":"bad payload"}');
    await dialog.getByText('Set up schema validation in Edit URL').scrollIntoViewIfNeeded();
    await screenshot(page, '06-editor-condicao-schema');

    await dialog.getByRole('radio', { name: 'JSON' }).click();
    const regra = JSON.parse(
      await dialog.getByRole('textbox', { name: 'Rule JSON' }).inputValue(),
    ) as { match: Record<string, unknown> };
    expect(regra.match['schema']).toBe('invalid');
    await dialog.getByRole('radio', { name: 'Form' }).click();

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Rule saved')).toBeVisible();

    expect(await getRules(request, tokenId)).toEqual([
      expect.objectContaining({
        name: 'Recusa fora do schema',
        match: expect.objectContaining({ schema: 'invalid' }),
      }),
    ]);

    const invalida = await request.post(`/${tokenId}`, json(INVALIDO));
    expect(invalida.status()).toBe(400);
    const valida = await request.post(`/${tokenId}`, json(VALIDO));
    expect(valida.status()).toBe(200);

    await openRequest(page, tokenId, invalida.headers()['x-request-id']);
    await expect(page.locator('app-schema-badge .invalid p')).toHaveText('Schema invalid');
    await expect(page.locator('app-rule-badge')).toHaveText(
      'Answered by rule Recusa fora do schema',
    );
    await screenshot(page, '07-selo-invalido-com-regra-400');

    await openRequest(page, tokenId, valida.headers()['x-request-id']);
    await expect(page.locator('app-schema-badge')).toHaveText('Schema valid');
    await page.getByRole('button', { name: /^Why\? \(\d+\)$/ }).click();
    await expect(
      page.locator('app-rule-badge li').filter({ hasText: /^schema: expected invalid, got valid/ }),
    ).toHaveCount(1);
    await screenshot(page, '08-selo-valido-near-miss');
  });
});
