import { APIRequestContext, Locator, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expect, test } from './support/fixtures';
import { falhas, itens, porque, verificacoes } from './support/inbox';
import {
  celular,
  importar,
  importarSubstituindo,
  linhasDasRegras,
  metodo,
  novaRegra,
  parte,
} from './support/regras';

// Regras de resposta, fase A (CA-1, CA-2, CA-4, CA-9, CA-10 parcial): aba "Rules", editor,
// import/export e selo na mensagem. Precisa do backend com `GET|PUT /token/{id}/rules`.
// Item 14, E6: o editor sai do diálogo e vira a `region "New rule"` ao lado da lista, com as abas Match, Response,
// Scenario e Test (SUPOSIÇÕES em `support/regras.ts`); salvar volta à lista.

const PIX = {
  name: 'Pix pago',
  priority: 5,
  match: {
    method: ['POST'],
    path: { equals: '/pagamentos' },
    headers: { 'X-Signature': { present: true } },
    body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
  },
  response: { status: 201, headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' },
};

async function putRules(api: APIRequestContext, tokenId: string, rules: object[]) {
  const response = await api.put(`/token/${tokenId}/rules`, { data: rules });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { id: string; name: string }[];
}

async function getRules(api: APIRequestContext, tokenId: string) {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as Record<string, unknown>[];
}

/**
 * Linhas da tabela de regras: nome, prioridade, match e status. Fidelidade ao C (item 14.1, RULES-01/02): a linha vira
 * o item de 3 linhas (`support/regras.ts`) e o match traz todas as condições.
 */
const ruleRows = linhasDasRegras;
const LINHA_PIX = [
  'Pix pago',
  '5',
  'POST /pagamentos · header X-Signature present · $.status = "pago"',
  '201',
];

async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function openRules(page: Page, tokenId: string) {
  await page.goto(`/#/${tokenId}/rules`);
  // A lista carregada libera as ações (antes disso o PUT apagaria as regras salvas).
  await expect(page.getByRole('table', { name: 'Rules' })).toBeVisible();
}

test.describe('Dado a aba "Rules" de uma URL sem regras', () => {
  test('deve criar a regra pelo editor, responder o webhook conforme ela e marcar a mensagem com o selo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_status: '200', default_content: 'padrão' });
    await openRules(page, tokenId);
    await expect(page.getByText('No rules yet')).toBeVisible();

    const dialog = await novaRegra(page);
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Pix pago');
    await parte(dialog, 'Match');
    await metodo(dialog, 'POST');
    await choose(page, dialog.getByRole('combobox', { name: 'Path match' }), 'Equals');
    await dialog.getByRole('textbox', { name: 'Path', exact: true }).fill('/pagamentos');
    await dialog.getByRole('button', { name: 'Add header condition' }).click();
    await dialog.getByRole('textbox', { name: 'Header 1 name' }).fill('X-Signature');
    await choose(page, dialog.getByRole('combobox', { name: 'Header 1 operator' }), 'is present');
    await dialog.getByRole('button', { name: 'Add body condition' }).click();
    await choose(page, dialog.getByRole('combobox', { name: 'Body 1 type' }), 'JSONPath');
    await dialog.getByRole('textbox', { name: 'Body 1 path' }).fill('$.status');
    await dialog.getByRole('textbox', { name: 'Body 1 equals' }).fill('"pago"');
    await parte(dialog, 'Response');
    await dialog.getByRole('spinbutton', { name: 'Status' }).fill('201');
    await dialog.getByRole('button', { name: 'Add response header' }).click();
    await dialog.getByRole('textbox', { name: 'Response header 1 name' }).fill('Content-Type');
    await dialog.getByRole('textbox', { name: 'Response header 1 value' }).fill('application/json');
    await dialog.getByRole('textbox', { name: 'Response body' }).fill('{"ok":true}');
    // A regra em palavras (C §2.5) acompanha o que foi preenchido. Fidelidade ao C, fase 2 (RULES-15): o parágrafo
    // "Rule in plain words", sem o rótulo "In plain words:".
    await expect(dialog.getByLabel('Rule in plain words')).toHaveText(
      /^When a POST to \/pagamentos\b.*answer 201\.$/,
    );
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules$`));
    await expect(page.getByText('Rule saved')).toBeVisible();
    expect(await ruleRows(page)).toEqual([LINHA_PIX]);
    expect(await getRules(request, tokenId)).toEqual([
      expect.objectContaining({
        name: 'Pix pago',
        match: expect.objectContaining({
          method: ['POST'],
          path: { equals: '/pagamentos' },
          headers: { 'X-Signature': { present: true } },
          body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
        }),
      }),
    ]);

    const webhook = await request.post(`/${tokenId}/pagamentos`, {
      headers: { 'X-Signature': 'abc', 'Content-Type': 'application/json' },
      data: '{"status":"pago"}',
    });
    expect(webhook.status()).toBe(201);
    expect(webhook.headers()['content-type']).toContain('application/json');
    expect(await webhook.text()).toBe('{"ok":true}');

    await page.getByRole('link', { name: /^Inbox(, .+)?$/ }).click();
    // Abaixo de 840 px a Inbox mostra um painel por vez: abre a mensagem pela lista.
    if (celular(page)) {
      await itens(page)
        .first()
        .getByRole('button', { name: /^POST / })
        .click();
    }
    // Item 14, E4: o selo da regra é o cartão do `group "Checks on this request"`.
    // Fidelidade ao C, fase 2 (INBOX-18): o cartão da regra diz o status.
    await expect(verificacoes(page)).toContainText(/Answered by rule · 201\s*Pix pago/);
  });

  test('deve mostrar o erro 422 do servidor no campo Path e não fechar Quando a regex é inválida', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await openRules(page, tokenId);

    const dialog = await novaRegra(page);
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Regex quebrada');
    await parte(dialog, 'Match');
    await choose(page, dialog.getByRole('combobox', { name: 'Path match' }), 'Matches regex');
    await dialog.getByRole('textbox', { name: 'Path', exact: true }).fill('([a-z');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog.locator('mat-error')).toContainText(/regex/i);
    await expect(dialog).toBeVisible();
    // UX de Regras, F8: no celular a lista vazia fica atrás da folha do editor.
    if (!celular(page)) {
      await expect(page.getByText('No rules yet')).toBeVisible();
    }
  });

  test('deve salvar a regra escrita na visão JSON Quando o JSON é válido', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await openRules(page, tokenId);

    const dialog = await novaRegra(page);
    await dialog.getByRole('radio', { name: 'JSON' }).click();
    const json = dialog.getByRole('textbox', { name: 'Rule JSON' });
    await json.fill('{"name": ""}');
    await expect(dialog.getByText('name: The name field is required.')).toBeVisible();
    // UX de Regras, WM-12/WM-04: Save nunca fica desabilitado; o clique diz o que corrigir e não grava.
    const salvar = dialog.getByRole('button', { name: 'Save' });
    await expect(salvar).toBeEnabled();
    await salvar.click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'To save, fix:' })).toBeVisible();
    expect(await getRules(request, tokenId)).toEqual([]);
    await json.fill(JSON.stringify(PIX));
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeHidden();
    expect(await ruleRows(page)).toEqual([LINHA_PIX]);
    expect(await getRules(request, tokenId)).toEqual([
      expect.objectContaining({ name: 'Pix pago' }),
    ]);
  });
});

test.describe('Dado uma URL com regras salvas', () => {
  test('deve responder com o padrão da URL Quando a regra é desligada na lista', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_status: '202', default_content: 'padrão' });
    await putRules(request, tokenId, [{ name: 'Tudo', response: { status: 418, body: 'bule' } }]);
    await openRules(page, tokenId);
    expect((await request.post(`/${tokenId}`)).status()).toBe(418);

    await page.getByRole('switch', { name: 'Enable rule Tudo' }).click();

    await expect.poll(async () => (await getRules(request, tokenId))[0]?.['enabled']).toBe(false);
    const webhook = await request.post(`/${tokenId}`);
    expect(webhook.status()).toBe(202);
    expect(await webhook.text()).toBe('padrão');
  });

  test('deve responder pela regra que sobe na lista Quando "Move up" troca as prioridades', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await putRules(request, tokenId, [
      { name: 'Primeira', priority: 1, response: { status: 201 } },
      { name: 'Segunda', priority: 5, response: { status: 202 } },
    ]);
    await openRules(page, tokenId);
    expect((await request.post(`/${tokenId}`)).status()).toBe(201);

    await page
      .locator('tr', { hasText: 'Segunda' })
      .getByRole('button', { name: 'Move up' })
      .click();

    await expect
      .poll(async () => (await ruleRows(page)).map((row) => row[0]))
      .toEqual(['Segunda', 'Primeira']);
    await expect.poll(async () => (await request.post(`/${tokenId}`)).status()).toBe(202);
  });

  test('deve mostrar a regra mais próxima e as condições que falharam Quando nenhuma casa (near miss)', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await putRules(request, tokenId, [PIX]);
    const requestId = await tokens.send(tokenId, {
      method: 'GET',
      path: '/pagamentos',
      headers: { 'content-type': 'application/json' },
      data: '{"status":"pendente"}',
    });

    await page.goto(`/#/${tokenId}/${requestId}/1`);
    await expect(verificacoes(page)).toContainText(/No rule matched.*Closest: Pix pago/);
    const why = porque(page);
    await why.click();

    await expect(why).toHaveAttribute('aria-expanded', 'true');
    const failed = falhas(page);
    await expect(failed.filter({ hasText: /^method: .*POST.*GET/ })).toHaveCount(1);
    await expect(failed.filter({ hasText: /^header x-signature: absent/i })).toHaveCount(1);
    await expect(failed.filter({ hasText: /^body \$\.status: .*pendente/ })).toHaveCount(1);
  });

  test('não deve mostrar selo Quando a URL não tem regras', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId);

    await page.goto(`/#/${tokenId}/${requestId}/1`);

    await expect(page.getByRole('group', { name: 'Request metadata' })).toContainText(requestId);
    await expect(verificacoes(page)).toBeVisible();
    await expect(verificacoes(page)).not.toContainText(/Answered by rule|No rule matched/);
  });
});

test.describe('Dado o export e o import de regras', () => {
  test('deve baixar o JSON salvo e levá-lo para outra URL sem perda Quando exporta e importa', async ({
    page,
    request,
    tokens,
  }, testInfo) => {
    const origem = await tokens.create();
    const salvas = await putRules(request, origem, [PIX, { name: 'Tudo', enabled: false }]);
    await openRules(page, origem);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export' }).click();
    const arquivo = await download;
    expect(arquivo.suggestedFilename()).toBe(`rules-${origem}.json`);
    const caminho = testInfo.outputPath('rules.json');
    await arquivo.saveAs(caminho);
    const exportado = JSON.parse(await readFile(caminho, 'utf8')) as { id: string }[];
    expect(exportado).toEqual(await getRules(request, origem));
    expect(exportado.map((rule) => rule.id)).toEqual(salvas.map((rule) => rule.id));

    const destino = await tokens.create();
    await openRules(page, destino);
    // UX de Regras, WM-19: o import mostra a diferença antes (`dialog "Import rules"`) e só grava no "Replace".
    await importarSubstituindo(page, caminho);

    await expect(page.getByText('Imported 2 rules')).toBeVisible();
    expect(await ruleRows(page)).toEqual([
      LINHA_PIX,
      ['Tudo', '5', expect.stringMatching(/^any request/i), '200'],
    ]);
    expect(await getRules(request, destino)).toEqual(exportado);
  });

  test('deve mostrar o 422 e manter as regras Quando o arquivo importado tem regra inválida', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await putRules(request, tokenId, [PIX]);
    await openRules(page, tokenId);

    // UX de Regras, WM-19: a prévia (`dialog "Import rules"`) vem antes; o 422 aparece ao confirmar o "Replace".
    const janela = await importar(page, {
      name: 'rules.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{ name: 'x', match: { path: { regex: '([a-z' } } }])),
    });
    await janela.getByRole('radio', { name: /^Replace the 1 saved rules?$/ }).check();
    await janela.getByRole('button', { name: 'Replace', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText('Rule 1 › match.path.regex:');
    expect(await ruleRows(page)).toEqual([LINHA_PIX]);
    expect(await getRules(request, tokenId)).toHaveLength(1);
  });
});

test.describe('Dado a alternância "Inbox" / "Rules"', () => {
  test('deve ir e voltar entre as abas mantendo a URL e o tempo real', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId);
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByText('Requests (1)')).toBeVisible();

    await page.getByRole('link', { name: 'Rules' }).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules$`));
    await expect(page.getByRole('link', { name: 'Rules' })).toHaveAttribute('aria-current', 'page');
    await request.post(`/${tokenId}`);

    await page.getByRole('link', { name: /^Inbox(, .+)?$/ }).click();
    await expect(page.getByText('Requests (2)')).toBeVisible();
    await request.post(`/${tokenId}`);
    await expect(page.getByText('Requests (3)')).toBeVisible();
  });
});
