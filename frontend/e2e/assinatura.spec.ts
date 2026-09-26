import { createHmac } from 'node:crypto';
import { APIRequestContext, Locator, Page } from '@playwright/test';
import { Webhook, expect, test } from './support/fixtures';

// Verificação de assinatura HMAC (CA-7, o que é da tela): configurar pelo Edit URL, selo na
// mensagem e condição "Signature" no editor de regras. Precisa do backend com `signature` no
// token, na mensagem e em `match.signature`.

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
    await choose(page, dialog.getByRole('combobox', { name: 'Signature provider' }), 'GitHub');
    await expect(
      dialog.getByText('Sent in X-Hub-Signature-256: sha256=<hex>; use the webhook secret'),
    ).toBeVisible();
    await dialog.getByLabel('Secret').fill(SECRET);
    await expect(dialog.getByLabel('Secret')).toHaveAttribute('type', 'password');
    await dialog.getByText('Sent in X-Hub-Signature-256').scrollIntoViewIfNeeded();
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
    await expect(page.locator('app-signature-badge')).toHaveText('Signature valid — GitHub');
    await screenshot(page, '02-selo-valida');
    await openRequest(page, tokenId, errada);
    await expect(page.locator('app-signature-badge')).toHaveText(
      'Signature invalid — signature mismatch',
    );
    await screenshot(page, '03-selo-invalida');
    await openRequest(page, tokenId, semAssinatura);
    await expect(page.locator('app-signature-badge')).toHaveText(
      'Signature invalid — header X-Hub-Signature-256 absent',
    );
  });

  test('deve mostrar o segredo mascarado e mantê-lo Quando a URL é editada sem mexer nele', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const dialog = await openEditUrl(page, tokenId);

    await expect(dialog.getByRole('combobox', { name: 'Signature provider' })).toHaveText('GitHub');
    await expect(dialog.getByLabel('Secret')).toHaveValue('');
    await expect(dialog.getByLabel('Secret')).toHaveAttribute('placeholder', MASKED);
    await dialog.getByText('Leave blank to keep the current secret').scrollIntoViewIfNeeded();
    await expect(dialog.getByText('Leave blank to keep the current secret')).toBeVisible();
    await screenshot(page, '04-edit-url-segredo-mascarado');
    await dialog.getByRole('textbox', { name: 'Default status code' }).fill('202');
    const put = await submitEdit(page, dialog, tokenId);

    // O mascarado volta como veio: o servidor mantém o segredo, que não sai da tela.
    expect(put['signature']).toEqual({ provider: 'github', secret: MASKED });
    const requestId = await tokens.send(tokenId, github(SECRET));
    await openRequest(page, tokenId, requestId);
    await expect(page.locator('app-signature-badge')).toHaveText('Signature valid — GitHub');
  });

  test('não deve mostrar selo de assinatura Quando a URL não verifica', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, github(SECRET));

    await openRequest(page, tokenId, requestId);

    await expect(page.locator('app-signature-badge')).toHaveText('');
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
    await expect(page.locator('app-signature-badge')).toHaveText(
      'Signature invalid — signature mismatch',
    );
    await expect(page.locator('app-rule-badge')).toHaveText('Answered by rule Recusa assinatura');
    await screenshot(page, '06-selo-invalida-com-regra-401');

    await openRequest(page, tokenId, certa.headers()['x-request-id']);
    await expect(page.locator('app-signature-badge')).toHaveText('Signature valid — GitHub');
    await page.getByRole('button', { name: /^Why\? \(\d+\)$/ }).click();
    await expect(
      page
        .locator('app-rule-badge li')
        .filter({ hasText: /^signature: expected invalid, got valid/ }),
    ).toHaveCount(1);
    await screenshot(page, '07-selo-valida-near-miss');
  });
});
