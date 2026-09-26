import { Request } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { readStorage, seedStorage } from './support/storage';

// Checklist 9 (formatar JSON está em detalhe.spec.ts; auto-navegar com mensagem nova, em
// tempo-real.spec.ts).

test.describe('Dado o toggle de CORS (checklist 9)', () => {
  test('deve ligar no servidor e continuar ligado após recarregar Quando é clicado (regressão do C2)', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId);
    await page.goto(`/#/${tokenId}`);
    const cors = page.getByRole('switch', { name: /Enable CORS/ });
    await expect(cors).not.toBeChecked();

    await cors.click();
    await expect(page.getByText('CORS enabled.')).toBeVisible();
    await page.reload();

    await expect(page.getByRole('switch', { name: /Enable CORS/ })).toBeChecked();
    expect(
      ((await (await request.get(`/token/${tokenId}`)).json()) as { cors: boolean }).cors,
    ).toBe(true);
    const webhook = await request.get(`/${tokenId}`);
    expect(webhook.headers()['access-control-allow-origin']).toBe('*');
  });
});

test.describe('Dado o redirect pelo navegador (checklist 9)', () => {
  test('deve reenviar a mensagem com método, caminho, query e headers escolhidos Quando "Redirect Now" é clicado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, {
      method: 'POST',
      path: '/sub/rota?q=1',
      headers: { 'x-token': 'segredo', 'content-type': 'text/plain' },
      data: 'corpo',
    });
    await seedStorage(page, {});
    const redirected: Request[] = [];
    await page.route('http://redirect.e2e.test/**', async (route) => {
      redirected.push(route.request());
      await route.fulfill({
        status: 200,
        body: 'ok',
        headers: { 'access-control-allow-origin': '*' },
      });
    });
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('switch', { name: 'Auto redirect' })).toBeDisabled();

    await page.getByRole('button', { name: 'Settings...' }).click();
    const dialog = page.getByRole('dialog', { name: 'Redirection Settings' });
    await dialog.getByLabel('Redirect to').fill('http://redirect.e2e.test');
    await dialog.getByLabel('Redirect Headers').fill('x-token');
    await dialog.getByRole('combobox', { name: 'HTTP Method' }).click();
    await page.getByRole('option', { name: 'PUT' }).click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Redirect Now' }).click();

    await expect(
      page.getByText('Redirected request to http://redirect.e2e.test/sub/rota?q=1'),
    ).toBeVisible();
    expect(redirected).toHaveLength(1);
    expect(redirected[0].method()).toBe('PUT');
    expect(redirected[0].url()).toBe('http://redirect.e2e.test/sub/rota?q=1');
    expect(redirected[0].postData()).toBe('corpo');
    expect(await redirected[0].headerValue('x-token')).toBe('segredo');
    expect(await redirected[0].headerValue('content-type')).toBe('text/plain');
    await expect(page.getByRole('switch', { name: 'Auto redirect' })).toBeEnabled();
    expect(await readStorage(page)).toMatchObject({
      redirectUrl: '"http://redirect.e2e.test"',
      redirectHeaders: '"x-token"',
      redirectMethod: '"PUT"',
    });
  });
});

test.describe('Dado o toggle de auto-navegar (checklist 9)', () => {
  test('deve ficar gravado Quando é ligado', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);

    await page.getByRole('switch', { name: 'Auto Navigate' }).click();

    expect((await readStorage(page))['autoNavEnable']).toBe('true');
  });
});
