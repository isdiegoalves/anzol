import { createHmac } from 'node:crypto';
import { APIRequestContext, Locator, Page } from '@playwright/test';
import { Webhook, expect, test } from './support/fixtures';
import {
  abrirAba,
  abrirItem,
  abrirMensagem,
  falhas,
  item,
  porque,
  verificacoes,
} from './support/inbox';

// Verificação de assinatura HMAC (CA-7, o que é da tela): configurar pelo Edit URL, selo na
// mensagem e condição "Signature" no editor de regras. Precisa do backend com `signature` no
// token, na mensagem e em `match.signature`. Item 13.1: selo na lista, linha do header realçada,
// quadro dos provedores com a anatomia e o Edit que diz o que falta.
// Item 14 (D7, CA-5): o leiaute novo mantém o que este spec cobra. E4: o selo da lista é o `app-check-chip` do
// item (texto curto de hoje, "Sig OK", "Bad sig", "No sig"; o nome acessível do item diz "Signature …"); o selo do detalhe
// vira o cartão no `group "Checks on this request"` (título e, na linha seguinte, o provedor ou o motivo do
// servidor); a tabela Headers fica na aba "Headers (n)" e a linha realçada leva a frase do veredito (a classe
// `signature valid|invalid|absent` de hoje sai: o tom vem por ícone e texto).

const SCREENS = process.env['SCREENS_DIR'];
const SECRET = 'segredo-do-e2e';
/** Como o servidor mostra o segredo salvo: `••••` e os 4 últimos. */
const MASKED = '••••-e2e';
const BODY = '{"action":"opened","number":42}';

async function screenshot(page: Page, name: string) {
  if (SCREENS) {
    await page.screenshot({ path: `${SCREENS}/${name}.png`, animations: 'disabled' });
  }
}

/** Webhook como o GitHub manda: `X-Hub-Signature-256: sha256=<hex>` do corpo cru. */
function github(secret: string | null, body = BODY): Webhook {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) {
    headers['X-Hub-Signature-256'] =
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }
  return { headers, data: body };
}

/** Webhook assinado como o genérico `X-Signature: sha256=<hex>` configurado no teste. */
function generic(secret: string, body = BODY): Webhook {
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return { headers: { 'X-Signature': `sha256=${signature}` }, data: body };
}

/** A linha da tabela Headers de um header (a sintética "(not received)" também). */
function headerRow(page: Page, name: string): Locator {
  return page
    .getByRole('table', { name: 'Headers' })
    .getByRole('row', { name: new RegExp(`^${name} `) });
}

/** A aba "Headers (n)" do detalhe, onde fica a tabela. */
async function openHeaders(page: Page) {
  await abrirAba(page, 'Headers');
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
  await abrirMensagem(page, tokenId, requestId);
}

async function getRules(api: APIRequestContext, tokenId: string) {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as Record<string, unknown>[];
}

test.describe('Dado a seção "Signature verification" do Edit URL', () => {
  test('deve verificar com o GitHub configurado pela tela e marcar as mensagens assinada certa, errada e sem assinatura', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await openEditUrl(page, tokenId);

    await expect(dialog.getByRole('combobox', { name: 'Signature provider' })).toHaveText('None');
    const providers = dialog.getByRole('table', { name: 'Signature providers' });
    await expect(providers.getByRole('row')).toHaveCount(6);
    await expect(providers.locator('[aria-current]')).toHaveCount(0);
    await choose(page, dialog.getByRole('combobox', { name: 'Signature provider' }), 'GitHub');
    await expect(providers.locator('[aria-current=true]')).toHaveText(
      /^GitHub\s*X-Hub-Signature-256\s*Raw body, HMAC-SHA256, hex\s*The webhook's secret$/,
    );
    await expect(dialog.locator('.anatomy')).toHaveText(
      'Expected header: X-Hub-Signature-256: sha256=<hex of HMAC-SHA256(body)>',
    );
    await dialog.getByLabel('Secret', { exact: true }).fill(SECRET);
    await expect(dialog.getByLabel('Secret', { exact: true })).toHaveAttribute('type', 'password');
    await providers.scrollIntoViewIfNeeded();
    await screenshot(page, '01-edit-url-github');
    const put = await submitEdit(page, dialog, tokenId);

    expect(put['signature']).toEqual({ provider: 'github', secret: SECRET });
    expect(await tokens.read(tokenId)).toMatchObject({
      signature: { provider: 'github', secret: MASKED },
    });

    const certa = await tokens.send(tokenId, github(SECRET));
    const errada = await tokens.send(tokenId, github('outro-segredo'));
    const semAssinatura = await tokens.send(tokenId, github(null));

    await openRequest(page, tokenId, certa);
    await expect(verificacoes(page)).toContainText(/Signature valid\s*GitHub/);
    await expect(abrirItem(page, certa)).toHaveAccessibleName(/\bSignature valid: GitHub\b/);
    await expect(item(page, certa)).toContainText('Sig OK');
    await expect(abrirItem(page, errada)).toHaveAccessibleName(
      /\bSignature invalid: signature mismatch\b/,
    );
    await expect(item(page, errada)).toContainText('Bad sig');
    await expect(abrirItem(page, semAssinatura)).toHaveAccessibleName(
      /\bSignature absent: header X-Hub-Signature-256 absent\b/,
    );
    await expect(item(page, semAssinatura)).toContainText('No sig');
    await openHeaders(page);
    const valida = headerRow(page, 'x-hub-signature-256');
    await expect(valida).toContainText('Signature valid — HMAC-SHA256 of the raw body matched');
    await expect(
      page
        .getByRole('table', { name: 'Headers' })
        .getByRole('row')
        .filter({ hasText: 'Signature ' }),
    ).toHaveCount(1);
    await screenshot(page, '02-selo-valida');
    await openRequest(page, tokenId, errada);
    await expect(verificacoes(page)).toContainText(/Signature invalid\s*signature mismatch/);
    await openHeaders(page);
    await expect(headerRow(page, 'x-hub-signature-256')).toContainText(
      'Signature invalid — HMAC-SHA256 of the raw body did not match (signature mismatch)',
    );
    await screenshot(page, '03-selo-invalida');
    await openRequest(page, tokenId, semAssinatura);
    await expect(verificacoes(page)).toContainText(
      /Signature absent\s*header X-Hub-Signature-256 absent/,
    );
    await openHeaders(page);
    const ausente = page.getByRole('table', { name: 'Headers' }).locator('tbody tr').first();
    await expect(ausente).toHaveText(
      /^\s*x-hub-signature-256\s*\(not received\)\s*⊘? ?Signature absent — the GitHub check expects the X-Hub-Signature-256 header\s*$/,
    );
    await screenshot(page, '03b-header-ausente');
  });

  test('deve mostrar o segredo mascarado e mantê-lo Quando a URL é editada sem mexer nele', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const dialog = await openEditUrl(page, tokenId);

    await expect(dialog.getByRole('combobox', { name: 'Signature provider' })).toHaveText('GitHub');
    await expect(dialog.getByLabel('Secret', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('Secret', { exact: true })).toHaveAttribute(
      'placeholder',
      MASKED,
    );
    await dialog.getByText('Leave blank to keep the current secret').scrollIntoViewIfNeeded();
    await expect(dialog.getByText('Leave blank to keep the current secret')).toBeVisible();
    await screenshot(page, '04-edit-url-segredo-mascarado');
    await dialog.getByRole('textbox', { name: 'Default status code' }).fill('202');
    const put = await submitEdit(page, dialog, tokenId);

    // O mascarado volta como veio: o servidor mantém o segredo, que não sai da tela.
    expect(put['signature']).toEqual({ provider: 'github', secret: MASKED });
    const requestId = await tokens.send(tokenId, github(SECRET));
    await openRequest(page, tokenId, requestId);
    await expect(verificacoes(page)).toContainText(/Signature valid\s*GitHub/);
  });

  test('não deve mostrar selo nem realce de assinatura Quando a URL não verifica', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, github(SECRET));

    await openRequest(page, tokenId, requestId);

    await expect(verificacoes(page)).not.toContainText(/Signature (valid|invalid|absent)/);
    await expect(abrirItem(page, requestId)).toBeVisible();
    await expect(abrirItem(page, requestId)).not.toHaveAccessibleName(
      /signature (valid|invalid|absent)/i,
    );
    await expect(item(page, requestId)).not.toContainText(/Sig OK|Bad sig|No sig/);
    await openHeaders(page);
    await expect(headerRow(page, 'x-hub-signature-256')).not.toContainText('Signature ');
  });

  test('deve dizer o que falta, focar o primeiro campo e salvar o genérico Quando Edit é clicado com os obrigatórios vazios', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await openEditUrl(page, tokenId);
    const puts: string[] = [];
    page.on('request', (sent) => {
      if (sent.method() === 'PUT' && sent.url().endsWith(`/token/${tokenId}`)) {
        puts.push(sent.url());
      }
    });

    await choose(page, dialog.getByRole('combobox', { name: 'Signature provider' }), 'Generic');
    const header = dialog.getByRole('textbox', { name: 'Signature header' });
    const secret = dialog.getByLabel('Secret', { exact: true });
    await expect(header).toHaveAttribute('required', '');
    await expect(secret).toHaveAttribute('required', '');
    await expect(dialog.getByRole('textbox', { name: 'Prefix' })).not.toHaveAttribute('required');
    await expect(dialog.getByRole('button', { name: 'Edit' })).toBeEnabled();
    await expect(dialog.locator('#token-form-pending')).toHaveCount(0);
    await header.scrollIntoViewIfNeeded();
    await screenshot(page, '08-generico-obrigatorios');

    await dialog.getByRole('button', { name: 'Edit' }).click();

    await expect(dialog.locator('#token-form-pending')).toHaveText(
      'To save, fill in: Signature header, Secret',
    );
    await expect(header).toBeFocused();
    await expect(dialog.getByText('The header is required.')).toBeVisible();
    await expect(dialog.getByText('The secret is required, up to 256 characters.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Edit' })).toHaveAttribute(
      'aria-describedby',
      'token-form-pending',
    );
    expect(puts).toEqual([]);
    await screenshot(page, '09-generico-o-que-falta');

    await header.fill('X-Signature');
    await expect(dialog.locator('#token-form-pending')).toHaveText('To save, fill in: Secret');
    await dialog.getByRole('textbox', { name: 'Prefix' }).fill('sha256=');
    await expect(dialog.locator('.anatomy')).toHaveText(
      'Expected header: X-Signature: sha256=<hex of HMAC-SHA256(body)>',
    );
    await secret.fill(SECRET);
    await expect(dialog.locator('#token-form-pending')).toHaveCount(0);
    const put = await submitEdit(page, dialog, tokenId);

    expect(put['signature']).toEqual({
      provider: 'generic',
      secret: SECRET,
      header: 'X-Signature',
      algorithm: 'sha256',
      encoding: 'hex',
      prefix: 'sha256=',
    });
    const requestId = await tokens.send(tokenId, generic(SECRET));
    await openRequest(page, tokenId, requestId);
    await openHeaders(page);
    await expect(headerRow(page, 'x-signature')).toContainText(
      'Signature valid — HMAC-SHA256 of the raw body matched',
    );
  });

  test('deve exigir segredo novo, com aviso, Quando o provedor muda numa URL com segredo salvo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const dialog = await openEditUrl(page, tokenId);

    await choose(page, dialog.getByRole('combobox', { name: 'Signature provider' }), 'Shopify');

    await expect(dialog.getByRole('status')).toHaveText(
      'The saved GitHub secret is not reused for Shopify: paste the Shopify secret.',
    );
    await expect(dialog.getByLabel('Secret', { exact: true })).toHaveAttribute('required', '');
    await expect(dialog.getByLabel('Secret', { exact: true })).not.toHaveAttribute(
      'placeholder',
      MASKED,
    );
    await dialog.getByRole('button', { name: 'Edit' }).click();
    await expect(dialog.locator('#token-form-pending')).toHaveText('To save, fill in: Secret');
    await expect(dialog.getByLabel('Secret', { exact: true })).toBeFocused();
    await screenshot(page, '10-troca-de-provedor');
    await dialog.getByLabel('Secret', { exact: true }).fill('shpss_novo');
    const put = await submitEdit(page, dialog, tokenId);

    expect(put['signature']).toEqual({ provider: 'shopify', secret: 'shpss_novo' });
    expect(await tokens.read(tokenId)).toMatchObject({
      signature: { provider: 'shopify', secret: '••••novo' },
    });
  });
});

test.describe('Dado a condição "Signature" no editor de regras', () => {
  test('deve responder 401 à assinatura inválida com a regra criada pela tela e explicar o near miss da válida', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    await page.goto(`/#/${tokenId}/rules`);
    await expect(page.getByRole('table', { name: 'Rules' })).toBeVisible();

    await page.getByRole('button', { name: 'New rule' }).click();
    const dialog = page.getByRole('dialog', { name: 'New rule' });
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Recusa assinatura');
    await choose(page, dialog.getByRole('combobox', { name: 'Signature' }), 'Invalid');
    await dialog.getByRole('spinbutton', { name: 'Status' }).fill('401');
    await dialog.getByRole('textbox', { name: 'Response body' }).fill('{"error":"bad signature"}');
    await dialog.getByRole('button', { name: 'Add body condition' }).scrollIntoViewIfNeeded();
    await screenshot(page, '05-editor-condicao-signature');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Rule saved')).toBeVisible();

    expect(await getRules(request, tokenId)).toEqual([
      expect.objectContaining({
        name: 'Recusa assinatura',
        match: expect.objectContaining({ signature: 'invalid' }),
      }),
    ]);

    const errada = await request.post(`/${tokenId}`, github('outro-segredo'));
    expect(errada.status()).toBe(401);
    const certa = await request.post(`/${tokenId}`, github(SECRET));
    expect(certa.status()).toBe(200);

    await openRequest(page, tokenId, errada.headers()['x-request-id']);
    await expect(verificacoes(page)).toContainText(/Signature invalid\s*signature mismatch/);
    await expect(verificacoes(page)).toContainText(/Answered by rule\s*Recusa assinatura/);
    await screenshot(page, '06-selo-invalida-com-regra-401');

    await openRequest(page, tokenId, certa.headers()['x-request-id']);
    await expect(verificacoes(page)).toContainText(/Signature valid\s*GitHub/);
    await porque(page).click();
    await expect(
      falhas(page).filter({ hasText: /^signature: expected invalid, got valid/ }),
    ).toHaveCount(1);
    await screenshot(page, '07-selo-valida-near-miss');
  });
});
