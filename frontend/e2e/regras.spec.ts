import { APIRequestContext, Locator, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expect, test } from './support/fixtures';

// Regras de resposta, fase A (CA-1, CA-2, CA-4, CA-9, CA-10 parcial): aba "Rules", editor,
// import/export e selo na mensagem. Precisa do backend com `GET|PUT /token/{id}/rules`.

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

/** Linhas da tabela de regras: nome, prioridade, match e status. */
const ruleRows = (page: Page) =>
  page
    .getByRole('table', { name: 'Rules' })
    .locator('tbody tr[data-rule-id]')
    .evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll('td.data')].map((td) => td.textContent?.trim())),
    );

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

    await page.getByRole('button', { name: 'New rule' }).click();
    const dialog = page.getByRole('dialog', { name: 'New rule' });
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Pix pago');
    await choose(page, dialog.getByRole('combobox', { name: 'Methods' }), 'POST');
    await page.keyboard.press('Escape');
    await choose(page, dialog.getByRole('combobox', { name: 'Path match' }), 'Equals');
    await dialog.getByRole('textbox', { name: 'Path', exact: true }).fill('/pagamentos');
    await dialog.getByRole('button', { name: 'Add header condition' }).click();
    await dialog.getByRole('textbox', { name: 'Header 1 name' }).fill('X-Signature');
    await choose(page, dialog.getByRole('combobox', { name: 'Header 1 operator' }), 'is present');
    await dialog.getByRole('button', { name: 'Add body condition' }).click();
    await choose(page, dialog.getByRole('combobox', { name: 'Body 1 type' }), 'JSONPath');
    await dialog.getByRole('textbox', { name: 'Body 1 path' }).fill('$.status');
    await dialog.getByRole('textbox', { name: 'Body 1 equals' }).fill('"pago"');
    await dialog.getByRole('spinbutton', { name: 'Status' }).fill('201');
    await dialog.getByRole('button', { name: 'Add response header' }).click();
    await dialog.getByRole('textbox', { name: 'Response header 1 name' }).fill('Content-Type');
    await dialog.getByRole('textbox', { name: 'Response header 1 value' }).fill('application/json');
    await dialog.getByRole('textbox', { name: 'Response body' }).fill('{"ok":true}');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('Rule saved')).toBeVisible();
    expect(await ruleRows(page)).toEqual([['Pix pago', '5', 'POST /pagamentos', '201']]);
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

    await page.getByRole('link', { name: 'Inbox', exact: true }).click();
    await expect(page.getByText('Answered by rule Pix pago')).toBeVisible();
  });

  test('deve mostrar o erro 422 do servidor no campo Path e não fechar Quando a regex é inválida', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await openRules(page, tokenId);

    await page.getByRole('button', { name: 'New rule' }).click();
    const dialog = page.getByRole('dialog', { name: 'New rule' });
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Regex quebrada');
    await choose(page, dialog.getByRole('combobox', { name: 'Path match' }), 'Matches regex');
    await dialog.getByRole('textbox', { name: 'Path', exact: true }).fill('([a-z');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog.locator('mat-error')).toContainText(/regex/i);
    await expect(dialog).toBeVisible();
    await expect(page.getByText('No rules yet')).toBeVisible();
  });

  test('deve salvar a regra escrita na visão JSON Quando o JSON é válido', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await openRules(page, tokenId);

    await page.getByRole('button', { name: 'New rule' }).click();
    const dialog = page.getByRole('dialog', { name: 'New rule' });
    await dialog.getByRole('radio', { name: 'JSON' }).click();
    const json = dialog.getByRole('textbox', { name: 'Rule JSON' });
    await json.fill('{"name": ""}');
    await expect(dialog.getByText('name: The name field is required.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await json.fill(JSON.stringify(PIX));
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeHidden();
    expect(await ruleRows(page)).toEqual([['Pix pago', '5', 'POST /pagamentos', '201']]);
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
    await expect(page.getByText('No rule matched — closest: Pix pago')).toBeVisible();
    const why = page.getByRole('button', { name: /^Why\? \(\d+\)$/ });
    await why.click();

    await expect(why).toHaveAttribute('aria-expanded', 'true');
    const failed = page.locator('app-rule-badge li');
    await expect(failed.filter({ hasText: /^method: .*POST.*GET/ })).toHaveCount(1);
    await expect(failed.filter({ hasText: /^header x-signature: absent/i })).toHaveCount(1);
    await expect(failed.filter({ hasText: /^body \$\.status: .*pendente/ })).toHaveCount(1);
  });

  test('não deve mostrar selo Quando a URL não tem regras', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId);

    await page.goto(`/#/${tokenId}/${requestId}/1`);

    await expect(page.getByRole('table', { name: 'Request Details' })).toContainText(requestId);
    await expect(page.locator('app-rule-badge')).toHaveText('');
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
    await page.getByLabel('Rules JSON file').setInputFiles(caminho);

    await expect(page.getByText('Imported 2 rules')).toBeVisible();
    expect(await ruleRows(page)).toEqual([
      ['Pix pago', '5', 'POST /pagamentos', '201'],
      ['Tudo', '5', 'ANY (any path)', '200'],
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

    await page.getByLabel('Rules JSON file').setInputFiles({
      name: 'rules.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{ name: 'x', match: { path: { regex: '([a-z' } } }])),
    });

    await expect(page.getByRole('alert')).toContainText('Rule 1 › match.path.regex:');
    expect(await ruleRows(page)).toEqual([['Pix pago', '5', 'POST /pagamentos', '201']]);
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

    await page.getByRole('link', { name: 'Inbox', exact: true }).click();
    await expect(page.getByText('Requests (2)')).toBeVisible();
    await request.post(`/${tokenId}`);
    await expect(page.getByText('Requests (3)')).toBeVisible();
  });
});
