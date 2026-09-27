import { createHmac } from 'node:crypto';
import { APIRequestContext, Request } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import {
  abrirChecks,
  escolherProvedor,
  pendente,
  pendenteAlerta,
  salvar,
  secao,
} from './support/checks';
import { Webhook, expect, test } from './support/fixtures';

// Item 14, E5: a página Checks (`#/{token}/checks`). CA-11 (o Save de um cartão manda o token salvo mais só aquele
// cartão: os outros campos não voltam ao padrão nem levam o que foi digitado e não salvo), Health por
// `GET /token/{id}/stats`, "Generate from a message", "Send a signed test", o "Edit" do cabeçalho levando a Checks,
// `?section=` e o axe no Generic pendente (CA-2). SUPOSIÇÕES em `support/checks.ts` e mais:
// - Health: `radiogroup "Window"` com os radios "50", "200" (padrão) e "500" (S20), que vão no `?window=` do
//   `stats`; a assinatura aparece como "{válidas} of {verificadas} valid" (verificadas = valid + invalid + absent)
//   e os motivos (`signature.reasons`) como itens de lista "{motivo} … {quantidade}";
// - Schema: `combobox "Generate from a message"` com as mensagens JSON recentes (opção com `#` e os 5 primeiros
//   caracteres do UUID) e o `button "Generate schema"`, que preenche o "JSON Schema" sem salvar;
// - Signature: "Send a signed test" (link ou botão) leva a `#/{token}/outbound?send=signed`;
// - o "Edit" do cabeçalho da URL é um `link` (decisão do main) que leva a `#/{token}/checks` (sem diálogo "Edit
//   URL");
// - `?section=schema` rola até o cartão "Schema validation".

const SECRET = 'segredo-dos-checks';
const MASKED = '••••ecks';
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const SCHEMA_A = { type: 'object', required: ['a'] };
const SCHEMA_B = { type: 'object', required: ['b'] };

function github(secret: string | null, body = '{"b":1}'): Webhook {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) {
    headers['X-Hub-Signature-256'] =
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }
  return { headers, data: body };
}

async function ultima(api: APIRequestContext, tokenId: string) {
  const response = await api.get(`/token/${tokenId}/requests`);
  return ((await response.json()) as { data: Record<string, unknown>[] }).data[0];
}

test.describe('Dado uma URL com assinatura, schema e resposta salvos (CA-11)', () => {
  test('deve salvar só o schema, sem resetar a assinatura, o segredo e a resposta nem levar o que não foi salvo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      default_status: '202',
      default_content: 'padrão',
      retry_after: '30',
      auto_cleanup: 500,
      signature: { provider: 'github', secret: SECRET },
      schema: SCHEMA_A,
    });
    const schema = await abrirChecks(page, tokenId, 'Schema validation');
    const resposta = secao(page, 'Response');
    await expect(resposta.getByLabel('Default status code')).toHaveValue('202');
    // Digitado e não salvo no cartão Response: não pode ir no PUT do Schema.
    await resposta.getByLabel('Default status code').fill('418');

    await schema.getByRole('textbox', { name: 'JSON Schema' }).fill(JSON.stringify(SCHEMA_B));
    const put = await salvar(page, schema, 'Save schema', tokenId);

    expect(put['schema']).toEqual(SCHEMA_B);
    expect(String(put['default_status'])).toBe('202');
    expect(put['default_content']).toBe('padrão');
    expect(String(put['retry_after'])).toBe('30');
    expect(put['auto_cleanup']).toBe(500);
    expect(put['signature']).toEqual({ provider: 'github', secret: MASKED });
    expect(await tokens.read(tokenId)).toMatchObject({
      default_status: 202,
      default_content: 'padrão',
      auto_cleanup: 500,
      signature: { provider: 'github', secret: MASKED },
      schema: SCHEMA_B,
    });
    expect(String((await tokens.read(tokenId))['retry_after'])).toBe('30');
    await expect(resposta.getByLabel('Default status code')).toHaveValue('418');
    // O segredo continua o mesmo no servidor: a assinatura certa segue válida.
    await tokens.send(tokenId, github(SECRET));
    expect(await ultima(request, tokenId)).toMatchObject({
      signature: { valid: true },
      schema: { valid: true },
    });
  });

  test('deve salvar só a resposta, mantendo o schema e o segredo', async ({ page, tokens }) => {
    const tokenId = await tokens.create({
      default_status: '202',
      signature: { provider: 'github', secret: SECRET },
      schema: SCHEMA_A,
    });
    const resposta = await abrirChecks(page, tokenId, 'Response');

    await resposta.getByLabel('Response body').fill('novo corpo');
    const put = await salvar(page, resposta, 'Save response', tokenId);

    expect(put['default_content']).toBe('novo corpo');
    expect(put['schema']).toEqual(SCHEMA_A);
    expect(put['signature']).toEqual({ provider: 'github', secret: MASKED });
    expect(await tokens.read(tokenId)).toMatchObject({
      default_status: 202,
      default_content: 'novo corpo',
      schema: SCHEMA_A,
      signature: { provider: 'github', secret: MASKED },
    });
  });
});

test.describe('Dado o cartão Health de uma URL com mensagens verificadas', () => {
  test('deve mostrar a taxa de assinaturas válidas e os motivos, pela janela escolhida', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    await tokens.send(tokenId, github(SECRET));
    await tokens.send(tokenId, github(SECRET));
    await tokens.send(tokenId, github('outro-segredo'));
    await tokens.send(tokenId, github(null));
    const pedido = (janela: string) =>
      page.waitForRequest(
        (sent: Request) =>
          sent.method() === 'GET' &&
          sent.url().includes(`/token/${tokenId}/stats`) &&
          new URL(sent.url()).searchParams.get('window') === janela,
      );

    const padrao = pedido('200');
    const health = await abrirChecks(page, tokenId, 'Health');
    await padrao;

    const janela = health.getByRole('radiogroup', { name: 'Window' });
    await expect(janela.getByRole('radio', { name: '200', exact: true })).toBeChecked();
    await expect(health).toContainText('2 of 4 valid');
    await expect(
      health.getByRole('listitem').filter({ hasText: 'signature mismatch' }),
    ).toContainText('1');
    await expect(
      health.getByRole('listitem').filter({ hasText: 'header X-Hub-Signature-256 absent' }),
    ).toContainText('1');

    const cinquenta = pedido('50');
    await janela.getByRole('radio', { name: '50', exact: true }).click();
    await cinquenta;
    await expect(janela.getByRole('radio', { name: '50', exact: true })).toBeChecked();
  });
});

test.describe('Dado o cartão Schema validation', () => {
  test('deve gerar o schema de uma mensagem JSON recente sem salvar, e salvar no "Save schema"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const exemplo = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"id": 42, "itens": [{"sku": "A1"}]}',
    });
    const schema = await abrirChecks(page, tokenId, 'Schema validation');

    await schema.getByRole('combobox', { name: 'Generate from a message' }).click();
    await page.getByRole('option', { name: new RegExp(`#${exemplo.substring(0, 5)}`) }).click();
    await schema.getByRole('button', { name: 'Generate schema' }).click();

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
    await expect(schema.getByRole('textbox', { name: 'JSON Schema' })).toHaveValue(
      JSON.stringify(inferido, null, 2),
    );
    expect(await tokens.read(tokenId)).toMatchObject({ schema: null });
    const put = await salvar(page, schema, 'Save schema', tokenId);
    expect(put['schema']).toEqual(inferido);
  });

  test('deve rolar até o cartão Quando a rota traz ?section=schema', async ({ page, tokens }) => {
    const tokenId = await tokens.create();

    await page.goto(`/#/${tokenId}/checks?section=schema`);

    await expect(secao(page, 'Schema validation')).toBeInViewport();
  });
});

test.describe('Dado o cartão Signature verification', () => {
  test('deve levar ao Send de Outbound assinado Quando "Send a signed test" é usado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');

    await assinatura
      .getByRole('link', { name: 'Send a signed test' })
      .or(assinatura.getByRole('button', { name: 'Send a signed test' }))
      .click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/outbound\\?send=signed$`));
  });

  test('deve manter o Save habilitado e dizer o que falta desde o início no Generic (S12)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');

    await escolherProvedor(assinatura, 'Generic');

    const save = assinatura.getByRole('button', { name: 'Save signature', exact: true });
    await expect(save).toBeEnabled();
    await expect(pendente(assinatura)).toHaveText('To save, fill in: Signature header, Secret');
    await expect(save).toHaveAccessibleDescription('To save, fill in: Signature header, Secret');
    await save.click();
    await expect(pendenteAlerta(assinatura)).toHaveText(
      'To save, fill in: Signature header, Secret',
    );
    await expect(assinatura.getByRole('textbox', { name: 'Signature header' })).toBeFocused();
  });
});

test.describe('Dado o "Edit" do cabeçalho da URL', () => {
  test('deve abrir Checks, e não o diálogo "Edit URL"', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
      new RegExp(`/${tokenId}$`),
    );

    await page.getByRole('link', { name: 'Edit', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/checks$`));
    await expect(secao(page, 'Signature verification')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Edit URL' })).toHaveCount(0);
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`Dado Checks no tema ${colorScheme} a ${viewport.width}×${viewport.height} (axe, CA-2)`, () => {
      test.use({ colorScheme, viewport });

      test('deve passar no axe sem violação grave com o Generic pendente, antes e depois do Save', async ({
        page,
        tokens,
      }) => {
        const tokenId = await tokens.create();
        const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
        await escolherProvedor(assinatura, 'Generic');
        await expect(pendente(assinatura)).toBeVisible();
        await expectSemViolacoesGraves(
          page,
          `Checks Generic, ${colorScheme}, ${viewport.width} px`,
        );

        await assinatura.getByRole('button', { name: 'Save signature', exact: true }).click();
        await expect(pendenteAlerta(assinatura)).toBeVisible();
        await expectSemViolacoesGraves(
          page,
          `Checks Generic após o Save, ${colorScheme}, ${viewport.width} px`,
        );
      });
    });
  }
}
