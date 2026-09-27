import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirChecks, pendenteAlerta, salvar } from './support/checks';
import { abrirAba, acoes, expectCorpo, item, linhas } from './support/inbox';
import { seedStorage } from './support/storage';

// Item 12 (privacidade), CA-5 da tela: proteger, desbloquear, Lock, compartilhar e a página do
// link. Precisa do backend do item 12 (`read_secret`, `unlock`/`lock`, `share`).

const SEGREDO = 'segredo-do-e2e';
const PROTEGIDA = { error: 'This URL is protected', protected: true };

/**
 * Linhas de uma tabela do detalhe, com as células separadas por espaço. Item 14, E4: as tabelas ficam nas abas do
 * detalhe (também na página do link), então a aba é aberta antes.
 */
async function rows(page: Page, table: 'Headers' | 'Query strings') {
  await abrirAba(page, table === 'Headers' ? 'Headers' : 'Query');
  return linhas(page, table);
}

/** Faixa "Shared read-only link · expires …" da página do link. */
const banner = (page: Page) => page.getByRole('main').getByRole('status');

/** A tela de desbloqueio: digita o segredo e clica "Unlock". */
async function unlock(page: Page, secret: string): Promise<void> {
  await page.getByLabel('Secret', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

/** Abre a URL e espera o `EventSource` ser aceito (200): o SSE passa pelo cookie de acesso. */
async function waitForStream(page: Page, tokenId: string): Promise<void> {
  const stream = await page.waitForResponse((response) =>
    response.url().endsWith(`/token/${tokenId}/stream`),
  );
  expect(stream.status()).toBe(200);
}

// Item 14, E5: a seção "Privacy" do "Edit URL" vira o cartão `region "Privacy"` de Checks, com "Save privacy"; o
// "Create New URL" mantém a seção (criar já protegida). SUPOSIÇÕES em `support/checks.ts`.
test.describe('Dado o Create New URL e o cartão "Privacy" de Checks', () => {
  test('deve proteger a URL, seguir aberta nesta tela e mostrar "Lock" Quando o segredo é definido', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByText('Waiting for first request...')).toBeVisible();

    const dialog = await abrirChecks(page, tokenId, 'Privacy');
    await dialog.getByRole('switch', { name: 'Require a secret to view this URL' }).click();
    await dialog.getByLabel('Secret to view', { exact: true }).fill(SEGREDO);
    await dialog.getByLabel('Confirm secret', { exact: true }).fill(SEGREDO);
    tokens.protectedWith(tokenId, SEGREDO);
    await salvar(page, dialog, 'Save privacy', tokenId);

    const semSegredo = await request.get(`/token/${tokenId}`);
    expect(semSegredo.status()).toBe(401);
    expect(await semSegredo.json()).toMatchObject(PROTEGIDA);
    // A tela desbloqueou sozinha com o segredo novo: recarregar abre a URL, não a tela de desbloqueio.
    await page.reload();
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This URL is protected' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Lock' })).toBeVisible();
  });

  test('deve recusar segredo curto ou confirmação diferente e dizer o que falta Quando tenta criar', async ({
    page,
    tokens,
  }) => {
    await page.goto(`/#/${await tokens.create()}`);

    await page.getByRole('button', { name: 'New URL', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New URL' });
    await dialog.getByRole('switch', { name: 'Require a secret to view this URL' }).click();
    await dialog.getByLabel('Secret to view', { exact: true }).fill('curto');
    await dialog.getByLabel('Confirm secret', { exact: true }).fill('outro');
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(pendenteAlerta(dialog)).toHaveText(
      '2 fields need attention: Secret to view, Confirm secret',
    );
    await expect(dialog.getByText('The secret must have 8 to 256 characters.')).toBeVisible();
    await expect(dialog.getByText('The secrets do not match.')).toBeVisible();
  });

  test('deve manter o segredo com os campos em branco e tirá-lo com o switch desligado Quando edita', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ read_secret: SEGREDO });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await unlock(page, SEGREDO);
    await expect(page.getByText('Waiting for first request...')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'URL sections' })
      .getByRole('link', { name: /^Checks(, .+)?$/ })
      .click();
    const dialog = page.getByRole('region', { name: 'Privacy', exact: true });
    await expect(
      dialog.getByRole('switch', { name: 'Require a secret to view this URL' }),
    ).toBeChecked();
    await expect(
      dialog.getByText('This URL is protected. Leave the fields blank to keep the current secret.'),
    ).toBeVisible();
    await salvar(page, dialog, 'Save privacy', tokenId);
    expect((await request.get(`/token/${tokenId}`)).status()).toBe(401);
    const comSegredo = await request.get(`/token/${tokenId}`, {
      headers: { 'X-Webhook-Secret': SEGREDO },
    });
    expect(comSegredo.status()).toBe(200);
    expect(await comSegredo.json()).toMatchObject({ protected: true });

    await dialog.getByRole('switch', { name: 'Require a secret to view this URL' }).click();
    await expect(dialog.getByText('Saving removes the secret')).toBeVisible();
    await salvar(page, dialog, 'Save privacy', tokenId);

    const aberta = await request.get(`/token/${tokenId}`);
    expect(aberta.status()).toBe(200);
    expect(await aberta.json()).toMatchObject({ protected: false });
    await expect(page.getByRole('button', { name: 'Lock' })).toBeHidden();
  });
});

test.describe('Dado uma URL protegida aberta sem acesso', () => {
  let tokenId: string;

  test.beforeEach(async ({ page, tokens }) => {
    tokenId = await tokens.create({ read_secret: SEGREDO });
    await seedStorage(page, {});
  });

  test('deve mostrar a tela de desbloqueio, recusar o segredo errado e abrir com o SSE ligado Quando o certo é digitado', async ({
    page,
    tokens,
  }) => {
    const antiga = await tokens.send(tokenId, { data: 'antes do desbloqueio' });
    await page.goto(`/#/${tokenId}`);

    await expect(page.getByRole('heading', { name: 'This URL is protected' })).toBeVisible();
    await expect(page.getByText('URL not found')).toBeHidden();
    await unlock(page, 'segredo-errado');
    await expect(page.getByRole('alert')).toHaveText('Wrong secret. Try again.');

    const stream = waitForStream(page, tokenId);
    await unlock(page, SEGREDO);
    await expect(page.getByRole('group', { name: 'Request metadata' })).toContainText(antiga);
    await stream;
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${antiga}/1$`));

    // Item 14, E4: sem o snackbar "Request received"; a chegada entra na lista (ver tempo-real.spec.ts).
    const aoVivo = await tokens.send(tokenId, { data: 'ao vivo' });
    await expect(item(page, aoVivo)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Requests (2)' })).toBeVisible();
  });

  test('deve travar o botão e mostrar a espera Quando o servidor responde 429 (10 falhas no minuto)', async ({
    page,
    request,
  }) => {
    for (let i = 0; i < 10; i++) {
      await request.post(`/token/${tokenId}/unlock`, { data: { secret: `errado-${i}` } });
    }
    await page.goto(`/#/${tokenId}`);

    await unlock(page, SEGREDO);

    await expect(page.getByRole('alert')).toHaveText(
      /Too many attempts\. Try again in \d+ seconds?\./,
    );
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  test('deve voltar à tela de desbloqueio, também depois de recarregar, Quando "Lock" é clicado', async ({
    page,
  }) => {
    await page.goto(`/#/${tokenId}`);
    await unlock(page, SEGREDO);
    await expect(page.getByText('Waiting for first request...')).toBeVisible();

    await page.getByRole('button', { name: 'Lock' }).click();

    await expect(page.getByText('URL locked')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This URL is protected' })).toBeVisible();
    await expect(page.getByText('Waiting for first request...')).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'This URL is protected' })).toBeVisible();
  });
});

test.describe('Dado o "Share read-only link…" de uma mensagem', () => {
  test('deve criar o link com 7 dias e mascaramento, e a página dele mostrar a mensagem só-leitura até ser revogado', async ({
    page,
    browser,
    tokens,
  }) => {
    const tokenId = await tokens.create({ read_secret: SEGREDO });
    const requestId = await tokens.send(tokenId, {
      path: '/hook?token=abc123&page=2',
      headers: {
        authorization: 'Bearer muito-secreto',
        'content-type': 'application/json',
        'x-custom': 'visivel',
      },
      data: '{"cartao":"4111"}',
    });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/${requestId}/1`);
    await unlock(page, SEGREDO);
    await expect(page.getByRole('group', { name: 'Request metadata' })).toContainText(requestId);

    await acoes(page).getByRole('button', { name: 'Share read-only link…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share read-only link' });
    await expect(dialog.getByRole('combobox', { name: 'Expires in' })).toHaveText('7 days');
    await expect(dialog.getByRole('switch', { name: 'Hide sensitive values' })).toBeChecked();
    await expect(dialog.getByText('The request body is not masked')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create link' }).click();
    const linkField = dialog.getByLabel('Read-only link');
    await expect(linkField).toHaveValue(/\/#\/share\/[0-9A-Za-z]+$/);
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(await linkField.inputValue());
    const shareId = link.split('/').pop() ?? '';
    await expect(dialog.getByRole('list', { name: 'Active links' })).toContainText(shareId);

    // Outro navegador, sem o cookie de acesso nem URL própria: só lê.
    const context = await browser.newContext();
    const visitor = await context.newPage();
    const calls: string[] = [];
    visitor.on('request', (sent) => calls.push(new URL(sent.url()).pathname));
    await visitor.goto(link);

    await expect(banner(visitor)).toHaveText(
      /Shared read-only link · expires [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM) \(in 7 days\)/,
    );
    expect(await rows(visitor, 'Headers')).toEqual(
      expect.arrayContaining(['authorization [redacted]', 'x-custom visivel']),
    );
    expect(await rows(visitor, 'Query strings')).toEqual(['token [redacted]', 'page 2']);
    await abrirAba(visitor, 'Body');
    // Fidelidade ao C (INBOX-22): sem `formatJsonEnable` salvo, o JSON aparece formatado.
    await expectCorpo(visitor, '{\n  "cartao": "4111"\n}');
    await expect(visitor.getByRole('button')).toHaveCount(0);
    await expect(visitor.getByRole('link', { name: /Permalink|Raw content/ })).toHaveCount(0);
    expect(calls.filter((path) => path.startsWith('/token'))).toEqual([]);
    // S22: a rota vem da `url` com `[redacted]` no lugar do token, sem `token_id` e sem ações.
    await expect(visitor.getByRole('heading', { name: /^\/hook\?/ })).toBeVisible();
    await expect(visitor.getByRole('heading', { name: /^\/hook\?/ })).not.toContainText(tokenId);
    await expect(visitor.getByRole('toolbar', { name: 'Request actions' })).toHaveCount(0);
    await expect(visitor.getByRole('menuitem')).toHaveCount(0);
    expect(await visitor.content()).not.toContain(tokenId);

    await dialog.getByRole('button', { name: `Revoke link ${shareId}` }).click();
    await expect(page.getByText('Link revoked')).toBeVisible();
    await visitor.reload();
    await expect(
      visitor.getByRole('heading', { name: 'This link is not available' }),
    ).toBeVisible();
    await context.close();
  });

  test('deve mostrar os valores sensíveis Quando "Hide sensitive values" é desligado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, {
      headers: { authorization: 'Bearer aberto' },
      data: 'x',
    });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/${requestId}/1`);

    await acoes(page).getByRole('button', { name: 'Share read-only link…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share read-only link' });
    await dialog.getByRole('combobox', { name: 'Expires in' }).click();
    await page.getByRole('option', { name: '1 hour' }).click();
    await dialog.getByRole('switch', { name: 'Hide sensitive values' }).click();
    await dialog.getByRole('button', { name: 'Create link' }).click();
    const link = await dialog.getByLabel('Read-only link').inputValue();
    await expect(dialog.getByRole('list', { name: 'Active links' })).toContainText(
      'all values shown',
    );

    await page.goto(link);
    await expect(banner(page)).toContainText('(in an hour)');
    expect(await rows(page, 'Headers')).toEqual(
      expect.arrayContaining(['authorization Bearer aberto']),
    );
  });
});

test.describe('Dado um link só-leitura que não existe', () => {
  test('deve mostrar o aviso amigável, sem criar URL nenhuma, Quando o link é aberto', async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on('request', (sent) => calls.push(`${sent.method()} ${new URL(sent.url()).pathname}`));
    await seedStorage(page, {});

    await page.goto('/#/share/NaoExiste0000000000000');

    await expect(page.getByRole('heading', { name: 'This link is not available' })).toBeVisible();
    await expect(
      page.getByText('It may have expired, been revoked, or the request may have been deleted.'),
    ).toBeVisible();
    expect(calls.filter((call) => call.includes('/token'))).toEqual([]);
  });
});
