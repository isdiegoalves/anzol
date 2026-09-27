import { UUID, expect, test, tokenInUrl } from './support/fixtures';
import { readStorage, seedStorage } from './support/storage';

// Checklist 1, 2 e 3.

test.describe('Dado a abertura da tela (checklist 1)', () => {
  test('deve abrir a última URL do localStorage Quando a raiz é aberta com token salvo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, { token: JSON.stringify({ uuid: tokenId }) });

    await page.goto('/');

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}$`));
    await expect(page.getByText('Waiting for first request...')).toBeVisible();
  });

  test('deve criar uma URL nova e ir para ela Quando a raiz é aberta sem token salvo', async ({
    page,
    request,
    tokens,
  }) => {
    await seedStorage(page, {});

    await page.goto('/');

    await expect(page).toHaveURL(new RegExp(`#/${UUID.source}$`));
    const tokenId = tokenInUrl(page);
    tokens.track(tokenId);
    expect((await request.get(`/token/${tokenId}`)).status()).toBe(200);
    expect(JSON.parse((await readStorage(page))['token'] ?? 'null')).toMatchObject({
      uuid: tokenId,
    });
  });
});

test.describe('Dado um link salvo do app antigo (checklist 2)', () => {
  test('deve abrir a mensagem certa Quando o link é /#!/{uuid}/{requestUuid}/1', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { data: 'primeira' });
    const segunda = await tokens.send(tokenId, { data: 'segunda' });
    await tokens.send(tokenId, { data: 'terceira' });

    await page.goto(`/#!/${tokenId}/${segunda}/1`);

    await expect(page).toHaveURL(new RegExp(`/#/${tokenId}/${segunda}/1$`));
    await expect(page.getByRole('group', { name: 'Request metadata' })).toContainText(segunda);
    await expect(page.locator('pre')).toHaveText('segunda');
  });
});

test.describe('Dado a URL do webhook na barra superior (checklist 3)', () => {
  test('deve exibir a URL que recebe webhooks e copiá-la Quando Copy é clicado', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_content: 'pong' });
    await page.goto(`/#/${tokenId}`);
    const url = page.getByRole('textbox', { name: 'Webhook URL' });

    await expect(url).toHaveValue(`${new URL(page.url()).origin}/${tokenId}`);
    await page.getByRole('button', { name: 'Copy', exact: true }).click();

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await url.inputValue());
    const webhook = await request.post(copied, { data: 'ping' });
    expect(await webhook.text()).toBe('pong');
    expect(webhook.headers()['x-token-id']).toBe(tokenId);
  });
});
