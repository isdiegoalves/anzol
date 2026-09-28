import { APIRequestContext, Locator, Page } from '@playwright/test';
import { abrirChecks, pendenteAlerta, salvar, botaoSalvar } from './support/checks';
import { Webhook, expect, test } from './support/fixtures';
import { abrirMensagem, acoes, marcasDeSchema, porque, verificacoes } from './support/inbox';
import { abrirRegras, condicao, novaRegra, parte, salvarRegra } from './support/regras';
import { seedStorage } from './support/storage';

// Patamar, B3 (guia-combinacao §3.3 e §7; CA-6): os quatro botões Save dos cartões somem; salvar é o `button "Save
// changes"` da `region "Unsaved changes"`, que só aparece com alteração pendente e grava tudo num PUT só.

// Validação de schema por URL (CA-5, o que é da tela): configurar pela tela, selo na
// mensagem com os erros, gerar o schema de uma mensagem e condição "Schema" no editor de regras.
// Precisa do backend com `schema` no token, na mensagem e em `match.schema`.
// Item 14, E4: o selo vira o cartão "Schema valid|invalid" no `group "Checks on this request"` (o primeiro erro na
// segunda linha) e os erros aparecem na linha do JSON que falhou, no corpo (C §2.2). SUPOSIÇÃO: cada marca começa
// pelo JSON Pointer do erro ("(root)" para a raiz), como a segunda linha do cartão.

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

/**
 * Item 14, E5: a seção sai do diálogo "Edit URL" e vira o cartão `region "Schema validation"` de Checks, com
 * "Save schema" e "Clear schema"; "Create schema from this request" leva a `#/{token}/checks?schema-from={id}`
 * com o schema inferido no campo, sem salvar. SUPOSIÇÕES em `support/checks.ts`.
 */
async function openEditUrl(page: Page, tokenId: string): Promise<Locator> {
  return abrirChecks(page, tokenId, 'Schema validation');
}

/** Clica em "Save schema" e devolve o corpo do `PUT /token/{id}`. */
async function submitEdit(page: Page, dialog: Locator, tokenId: string) {
  return salvar(page, tokenId);
}

async function openRequest(page: Page, tokenId: string, requestId: string) {
  // Pretty ligado: os erros caem na linha do valor do JSON Pointer (com Raw, na primeira linha).
  await seedStorage(page, { formatJsonEnable: 'true' });
  await abrirMensagem(page, tokenId, requestId);
}

/** As marcas de erro de schema no corpo (cada uma começa pelo caminho). */
function errorPaths(page: Page) {
  return marcasDeSchema(page);
}

async function getRules(api: APIRequestContext, tokenId: string) {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as Record<string, unknown>[];
}

test.describe('Dado o cartão "Schema validation" de Checks', () => {
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
    await botaoSalvar(page).click();
    await expect(pendenteAlerta(dialog)).toHaveText('1 field needs attention: JSON Schema');
    await expect(field).toBeFocused();
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
    await expect(verificacoes(page)).toContainText('Schema valid');
    await expect(errorPaths(page)).toHaveCount(0);
    await screenshot(page, '02-selo-valido');

    await openRequest(page, tokenId, invalida);
    await expect(verificacoes(page)).toContainText('Schema invalid');
    await expect(errorPaths(page).filter({ hasText: /^\/id\b/ })).toHaveCount(1);
    await expect(errorPaths(page).filter({ hasText: /^\/itens\/0/ })).not.toHaveCount(0);
    // O erro de /id cai na linha do "id" do JSON formatado.
    await expect(
      page.getByLabel('Request body', { exact: true }).locator('.line.marked', { hasText: '"id"' }),
    ).toHaveCount(1);
    await screenshot(page, '03-selo-invalido-com-erros');

    await openRequest(page, tokenId, semJson);
    await expect(verificacoes(page)).toContainText(/Schema invalid\s*\(root\) body is not JSON/);
    await expect(errorPaths(page)).toHaveText(['(root) body is not JSON']);
  });

  test('deve mostrar no campo o erro do servidor, manter o que foi digitado e desligar pelo "Clear schema"', async ({
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
    await botaoSalvar(page).click();
    await recusa;

    await expect(dialog.getByText(/^The schema is invalid: /)).toBeVisible();
    await expect(field).toHaveValue('{"$ref": "https://exemplo.com/pedido.json"}');
    await botaoSalvar(page).click();
    await expect(pendenteAlerta(dialog)).toHaveText('1 field needs attention: JSON Schema');
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
    await expect(verificacoes(page)).not.toContainText(/Schema (valid|invalid)/);
    await expect(errorPaths(page)).toHaveCount(0);
  });
});

test.describe('Dado "Create schema from this request"', () => {
  test('deve abrir Checks com o schema inferido do corpo e, salvo, validar as mensagens seguintes', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const exemplo = await tokens.send(tokenId, json(VALIDO));
    const formulario = await tokens.send(tokenId, { data: 'nome=Ana' });

    await openRequest(page, tokenId, formulario);
    await expect(acoes(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create schema from this request' })).toHaveCount(
      0,
    );
    await expect(verificacoes(page)).not.toContainText(/Schema (valid|invalid)/);

    await openRequest(page, tokenId, exemplo);
    await page.getByRole('button', { name: 'Create schema from this request' }).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/checks\\?schema-from=${exemplo}$`));
    const dialog = page.getByRole('region', { name: 'Schema validation', exact: true });
    await expect(dialog).toBeVisible();
    expect(await tokens.read(tokenId)).toMatchObject({ schema: null });
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
    await expect(verificacoes(page)).toContainText('Schema valid');
    await openRequest(page, tokenId, diferente);
    await expect(verificacoes(page)).toContainText('Schema invalid');
    await expect(errorPaths(page).filter({ hasText: /^\/id\b/ })).toHaveCount(1);
  });
});

test.describe('Dado a condição "Schema" no editor de regras', () => {
  test('deve responder 400 ao corpo fora do schema com a regra criada pela tela e explicar o near miss do válido', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ schema: PEDIDO });
    // Item 14, E6: o editor é a `region "New rule"` com as abas (`support/regras.ts`). SUPOSIÇÃO: a dica da
    // condição Schema aponta para Checks ("Set up schema validation in Checks"): o "Edit URL" saiu na E5.
    await abrirRegras(page, tokenId);

    const dialog = await novaRegra(page);
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Recusa fora do schema');
    await parte(dialog, 'Match');
    // Fidelidade ao C (item 14.1, RULES-17): Schema vira segmentado (`radiogroup "Schema"`), com o link para Checks.
    await expect(
      dialog.getByRole('radiogroup', { name: 'Schema' }).getByRole('radio', { name: 'Any' }),
    ).toBeChecked();
    await condicao(dialog, 'Schema', 'Invalid');
    await dialog.getByRole('radiogroup', { name: 'Schema' }).scrollIntoViewIfNeeded();
    await screenshot(page, '06-editor-condicao-schema');
    await parte(dialog, 'Response');
    await dialog.getByRole('spinbutton', { name: 'Status' }).fill('400');
    await dialog.getByRole('textbox', { name: 'Response body' }).fill('{"error":"bad payload"}');

    await dialog.getByRole('radio', { name: 'JSON' }).click();
    const regra = JSON.parse(
      await dialog.getByRole('textbox', { name: 'Rule JSON' }).inputValue(),
    ) as { match: Record<string, unknown> };
    expect(regra.match['schema']).toBe('invalid');
    await dialog.getByRole('radio', { name: 'Form' }).click();

    await salvarRegra(page, dialog, tokenId);

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
    await expect(verificacoes(page)).toContainText('Schema invalid');
    // Fidelidade ao C, fase 2 (INBOX-18): o cartão da regra diz o status.
    await expect(verificacoes(page)).toContainText(
      /Answered by rule · 400\s*Recusa fora do schema/,
    );
    await screenshot(page, '07-selo-invalido-com-regra-400');

    await openRequest(page, tokenId, valida.headers()['x-request-id']);
    await expect(verificacoes(page)).toContainText('Schema valid');
    // INBOX-18: com uma condição só, a frase fica no cartão e o "Why? (n)" não aparece.
    await expect(verificacoes(page)).toContainText(
      /Closest: Recusa fora do schema · schema: expected invalid, got valid/,
    );
    await expect(porque(page)).toHaveCount(0);
    await screenshot(page, '08-selo-valido-near-miss');
  });
});
