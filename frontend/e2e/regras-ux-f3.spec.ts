import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import {
  abrirRegras,
  gravarRegras,
  lerRegras,
  linhaDaRegra,
  novaRegra,
  parte,
  salvarRegra,
} from './support/regras';

// UX de Regras, fatia F3 — editor de condições e resposta (WM-14, WM-43, E-12, WM-16, WM-42, WM-46, E-10, WM-04;
// guia-ux §3.3). A sugestão da IA como proposta (E-13) fica no `ia.spec.ts`, que sobe o LLM falso da porta 18099
// (um só por execução). SUPOSIÇÕES (o guia não fixa):
// - SUPOSIÇÃO: o operador regex de query/cabeçalho continua em minúsculas como os demais ("matches regex (whole
//   value)"); os testes aceitam as duas caixas.
// - SUPOSIÇÃO: no painel "From this request", o {path} do cabeçalho é o nome como a mensagem gravou (minúsculas) e o
//   {value} do corpo vem como literal JSON (`"pago"`, `10`); os testes aceitam o nome em qualquer caixa e o texto com
//   ou sem aspas.
// - SUPOSIÇÃO: o {helper} de `button "Insert {helper}"` é o nome do helper como se escreve no template (`jsonPath`,
//   `hmac`); a cola continua dentro de "Template helpers" (aberta aqui se vier recolhida).
// - SUPOSIÇÃO: a visão Form | JSON continua um segmentado; "Form" pode ser `radio` (o `mat-button-toggle` de hoje) ou
//   `button` (o guia diz `button "Form"`).
// - SUPOSIÇÃO: o testador de regex/JSONPath usa a última mensagem recebida quando o editor não veio de `?from=`.

async function escolher(page: Page, campo: Locator, opcao: string | RegExp): Promise<void> {
  await campo.click();
  await page.getByRole('option', { name: opcao, exact: typeof opcao === 'string' }).click();
}

const REGEX_INTEIRO = /^matches regex \(whole value\)$/i;

function caixa(regiao: Locator, nome: string): Locator {
  return regiao.getByRole('textbox', { name: nome, exact: true });
}

/** Abre o `details` "Template helpers" se a largura o deixar recolhido. */
async function abrirAjudaDoTemplate(regiao: Locator): Promise<void> {
  const inserir = regiao.getByRole('button', { name: 'Insert jsonPath' });
  if (!(await inserir.isVisible())) {
    await regiao.getByText('Template helpers').click();
  }
  await expect(inserir).toBeVisible();
}

test.describe('Dado o caminho da regra (WM-14)', () => {
  test('deve ter o Path sempre à vista e, ao digitar, escolher "Equals" sozinho', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await caixa(regra, 'Name').fill('Pix');
    await parte(regra, 'Match');

    const caminho = caixa(regra, 'Path');
    await expect(caminho).toBeEnabled();
    await expect(regra.getByText("Empty: any path. After the URL's token.")).toBeVisible();
    await caminho.fill('/pagamentos');
    const modo = regra.getByRole('combobox', { name: 'Path match' });
    await expect(modo).toHaveText('Equals');

    await modo.click();
    for (const opcao of ['Equals', 'Starts with', 'Matches regex (whole value)']) {
      await expect(page.getByRole('option', { name: opcao, exact: true })).toBeVisible();
    }
    await page.getByRole('option', { name: 'Equals', exact: true }).click();
    await salvarRegra(page, regra, tokenId);

    const [salva] = await lerRegras(request, tokenId);
    expect(salva['match']).toMatchObject({ path: { equals: '/pagamentos' } });
  });

  test('deve responder a qualquer caminho Quando o Path fica vazio', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await caixa(regra, 'Name').fill('Tudo');
    await parte(regra, 'Match');
    await expect(caixa(regra, 'Path')).toHaveValue('');
    await expect(caixa(regra, 'Path')).toBeEnabled();
    await salvarRegra(page, regra, tokenId);

    const [salva] = await lerRegras(request, tokenId);
    expect((salva['match'] as { path?: unknown } | undefined)?.path ?? null).toBeNull();
    expect((await request.post(`/${tokenId}/qualquer/coisa`)).status()).toBe(200);
  });
});

test.describe('Dado os chips de adicionar condição (WM-14, WM-43)', () => {
  test('deve abrir cada condição com o operador mais comum', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await parte(regra, 'Match');

    await regra.getByRole('button', { name: 'Add body field (JSONPath)' }).click();
    await expect(regra.getByRole('combobox', { name: 'Body 1 type' })).toHaveText('JSONPath');
    await expect(caixa(regra, 'Body 1 path')).toBeVisible();
    await expect(caixa(regra, 'Body 1 equals')).toBeVisible();

    await regra.getByRole('button', { name: 'Add header condition' }).click();
    await expect(regra.getByRole('combobox', { name: 'Header 1 operator' })).toHaveText(
      /^equals$/i,
    );
    await regra.getByRole('button', { name: 'Add query condition' }).click();
    await expect(regra.getByRole('combobox', { name: 'Query 1 operator' })).toHaveText(/^equals$/i);

    await regra.getByRole('button', { name: 'Require invalid signature' }).click();
    await expect(
      regra.getByRole('radiogroup', { name: 'Signature' }).getByRole('radio', { name: 'Invalid' }),
    ).toBeChecked();
  });

  test('deve dizer que a regex casa o valor inteiro nos operadores', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await parte(regra, 'Match');
    await regra.getByRole('button', { name: 'Add header condition' }).click();

    await regra.getByRole('combobox', { name: 'Header 1 operator' }).click();
    await expect(page.getByRole('option', { name: REGEX_INTEIRO })).toBeVisible();
    await page.getByRole('option', { name: REGEX_INTEIRO }).click();
    await regra.getByRole('combobox', { name: 'Path match' }).click();
    await expect(
      page.getByRole('option', { name: 'Matches regex (whole value)', exact: true }),
    ).toBeVisible();
  });
});

test.describe('Dado uma mensagem de exemplo e o testador de regex/JSONPath (E-12, WM-43)', () => {
  test('deve dizer que a regex não cobre o valor inteiro e trocar por "contém" com um clique', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pagamentos', headers: { 'X-Status': 'pix pago' } });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await parte(regra, 'Match');
    await regra.getByRole('button', { name: 'Add header condition' }).click();
    await caixa(regra, 'Header 1 name').fill('X-Status');
    const operador = regra.getByRole('combobox', { name: 'Header 1 operator' });
    await escolher(page, operador, REGEX_INTEIRO);
    const valor = caixa(regra, 'Header 1 value');

    await valor.fill('pago');
    await expect(
      regra.getByText(`Doesn't match "pix pago" — a regex must cover the whole value.`),
    ).toBeVisible();
    await regra.getByRole('button', { name: 'Use contains' }).click();
    await expect(operador).toHaveText(/^contains$/i);
    await expect(valor).toHaveValue('pago');

    await escolher(page, operador, REGEX_INTEIRO);
    await valor.fill('.*pago');
    await expect(regra.getByText(/Matches "pix pago" · approx\./)).toBeVisible();

    await valor.fill('(?=pix).*');
    await expect(regra.getByText("Can't check here — test against history.")).toBeVisible();
  });

  test('deve dizer como o "Equals (JSON)" leu o valor', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await parte(regra, 'Match');
    await regra.getByRole('button', { name: 'Add body field (JSONPath)' }).click();
    await caixa(regra, 'Body 1 path').fill('$.valor');
    const igual = caixa(regra, 'Body 1 equals');

    await igual.fill('10');
    await expect(regra.getByText(/Read as number 10\b/)).toBeVisible();
    await igual.fill('"pago"');
    await expect(regra.getByText(/Read as text "pago"/)).toBeVisible();
  });
});

test.describe('Dado o painel "From this request" (WM-16)', () => {
  const PEDIDO = {
    path: '/pagamentos',
    headers: { 'Content-Type': 'application/json', 'X-Tenant': 'acme' },
    data: '{"id":"p2","status":"pago","valor":10}',
  };

  test('deve virar condição com um clique, sem duplicar, filtrar os campos e gravar a regra', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, PEDIDO);
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await caixa(regra, 'Name').fill('Pix pago');
    await parte(regra, 'Match');

    const painel = regra.getByRole('region', { name: 'From this request' });
    await expect(painel).toContainText('POST /pagamentos');
    const tenant = painel.getByRole('button', { name: /^Use x-tenant: "?acme"?$/i });
    await tenant.click();
    await expect(caixa(regra, 'Header 1 name')).toHaveValue(/^x-tenant$/i);
    await expect(caixa(regra, 'Header 1 value')).toHaveValue('acme');
    await tenant.click();
    await expect(caixa(regra, 'Header 2 name')).toHaveCount(0);

    await painel.getByRole('button', { name: /^Use \$\.status: "?pago"?$/ }).click();
    await expect(caixa(regra, 'Body 1 path')).toHaveValue('$.status');

    await painel.getByRole('searchbox', { name: 'Filter fields' }).fill('valor');
    await expect(painel.getByRole('button', { name: /^Use \$\.valor: 10$/ })).toBeVisible();
    await expect(painel.getByRole('button', { name: /^Use \$\.status/ })).toHaveCount(0);

    await salvarRegra(page, regra, tokenId);
    const [salva] = await lerRegras(request, tokenId);
    const match = salva['match'] as {
      headers: Record<string, unknown>;
      body: unknown[];
    };
    expect(
      Object.fromEntries(Object.entries(match.headers).map(([k, v]) => [k.toLowerCase(), v])),
    ).toEqual({ 'x-tenant': { equals: 'acme' } });
    expect(match.body).toEqual([{ jsonPath: { path: '$.status', equals: 'pago' } }]);
  });

  test('deve inserir o helper do campo no cursor do corpo, na aba Response', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, PEDIDO);
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await parte(regra, 'Response');
    const corpo = caixa(regra, 'Response body');
    await corpo.click();
    await corpo.pressSequentially('status=');

    await regra
      .getByRole('region', { name: 'From this request' })
      .getByRole('button', { name: /^Use \$\.status: "?pago"?$/ })
      .click();

    await expect(corpo).toHaveValue(`status={{jsonPath request.body '$.status'}}`);
  });

  test('deve pedir uma requisição de teste Quando a URL ainda não recebeu nada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await parte(regra, 'Match');

    await expect(regra.getByRole('region', { name: 'From this request' })).toContainText(
      'Send a test request to this URL to pick fields from it.',
    );
  });
});

test.describe('Dado a cola de helpers do template (WM-16, C5)', () => {
  test('deve inserir o helper no cursor, com o hmac e a descrição do jsonPath', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await parte(regra, 'Response');
    await regra.getByRole('switch', { name: 'Template' }).click();
    await abrirAjudaDoTemplate(regra);
    await expect(
      regra.getByText('Value from the JSON body. Simple paths only ($.a.b[0]).'),
    ).toBeVisible();
    const corpo = caixa(regra, 'Response body');

    await corpo.click();
    await regra.getByRole('button', { name: 'Insert jsonPath' }).click();
    await expect(corpo).toHaveValue(/\{\{jsonPath request\.body '\$[^']*'\}\}/);
    await corpo.fill('');
    await corpo.click();
    await regra.getByRole('button', { name: 'Insert hmac' }).click();
    await expect(corpo).toHaveValue(/\{\{hmac /);
  });
});

test.describe('Dado o corpo da resposta (WM-42, WM-46, E-10)', () => {
  test('deve formatar o JSON e sugerir o Content-Type, com a alternativa do padrão da URL', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_content_type: 'text/plain' });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await parte(regra, 'Response');
    const corpo = caixa(regra, 'Response body');
    await corpo.fill('{"a":1,"b":[1,2]}');

    await regra.getByRole('button', { name: 'Format JSON' }).click();
    const formatado = await corpo.inputValue();
    expect(formatado).toContain('\n');
    expect(JSON.parse(formatado)).toEqual({ a: 1, b: [1, 2] });

    await expect(
      regra.getByRole('button', { name: "Use the URL's default content type (text/plain)" }),
    ).toBeVisible();
    const sugerir = regra.getByRole('button', { name: 'Add Content-Type: application/json' });
    await sugerir.click();
    await expect(caixa(regra, 'Response header 1 name')).toHaveValue('Content-Type');
    await expect(caixa(regra, 'Response header 1 value')).toHaveValue('application/json');
    await expect(sugerir).toHaveCount(0);

    await regra.getByRole('switch', { name: 'Template' }).click();
    await expect(regra.getByRole('button', { name: 'Format JSON' })).toHaveCount(0);
  });

  test('deve avisar do JSON inválido sem impedir de salvar', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await caixa(regra, 'Name').fill('Corpo quebrado');
    await parte(regra, 'Response');
    await caixa(regra, 'Response body').fill('{"a":\n');

    await expect(
      regra.getByRole('note').filter({ hasText: /Not valid JSON: line \d+/ }),
    ).toBeVisible();
    await salvarRegra(page, regra, tokenId);
    expect((await lerRegras(request, tokenId))[0]['response']).toMatchObject({ body: '{"a":\n' });
  });
});

test.describe('Dado a regra em palavras (WM-04)', () => {
  test('deve descrever o item da lista pela frase, mantendo o nome como nome acessível', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      {
        name: 'Pix',
        match: { method: ['POST'], path: { equals: '/pagamentos' } },
        response: { status: 201 },
      },
    ]);
    await abrirRegras(page, tokenId);

    const item = linhaDaRegra(page, 'Pix').locator('td.item').getByRole('button');
    await expect(item).toHaveAccessibleName('Pix');
    await expect(item).toHaveAttribute(
      'aria-description',
      /^When a POST to \/pagamentos\b.*answer 201/,
    );
  });

  test('deve manter "Form" clicável com o JSON inválido e dizer o que corrigir para voltar', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    const visao = (nome: string) =>
      regra
        .getByRole('radio', { name: nome, exact: true })
        .or(regra.getByRole('button', { name: nome, exact: true }));
    await visao('JSON').click();
    const json = caixa(regra, 'Rule JSON');
    await json.fill('{"name": ');

    await expect(visao('Form')).toBeEnabled();
    await visao('Form').click();

    await expect(
      regra.getByRole('alert').filter({ hasText: /^\s*To go back to the form, fix: / }),
    ).toBeVisible();
    await expect(json).toBeVisible();
  });
});
