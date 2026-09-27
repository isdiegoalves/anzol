import { abrirChecks, abrirCreate, pendenteAlerta, salvar } from './support/checks';
import { expect, test, tokenInUrl } from './support/fixtures';

// Campo Retry-After dos diálogos da URL. Precisa do backend com `retry_after` no token.
// Item 14, E5: no "Create New URL" o campo fica no painel "Customize response"; o "Edit URL" vira o cartão
// `region "Response"` de Checks, com "Save response". SUPOSIÇÕES em `support/checks.ts`.

const DATA_HTTP = 'Sun, 06 Nov 1994 08:49:37 GMT';

test.describe('Dado o campo Retry-After do diálogo "Create New URL"', () => {
  test('deve criar a URL que responde com Retry-After Quando o campo é preenchido', async ({
    page,
    request,
    tokens,
  }) => {
    const original = await tokens.create();
    await page.goto(`/#/${original}`);

    const dialog = await abrirCreate(page);
    await expect(
      dialog.getByText('Seconds or HTTP-date; useful with 429, 503 or 3xx'),
    ).toBeVisible();
    await dialog.getByLabel('Retry-After').fill('120');
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('New URL created')).toBeVisible();
    // A mensagem aparece antes de a rota trocar: espera sair da URL de origem antes de ler o token.
    await expect(page).not.toHaveURL(new RegExp(original));
    const novo = tokenInUrl(page);
    tokens.track(novo);
    expect(await tokens.read(novo)).toMatchObject({ retry_after: 120 });
    const webhook = await request.post(`/${novo}/429`);
    expect(webhook.status()).toBe(429);
    expect(webhook.headers()['retry-after']).toBe('120');
  });

  for (const valor of ['amanhã', '-5', '2026-09-26T10:00:00Z']) {
    test(`não deve criar e deve dizer o que corrigir Quando o Retry-After é "${valor}"`, async ({
      page,
      tokens,
    }) => {
      await page.goto(`/#/${await tokens.create()}`);

      const dialog = await abrirCreate(page);
      await dialog.getByLabel('Retry-After').fill(valor);
      await dialog.getByLabel('Default status code').click();
      await dialog.getByRole('button', { name: 'Create' }).click();

      await expect(pendenteAlerta(dialog)).toHaveText('1 field needs attention: Retry-After');
      await expect(dialog.getByLabel('Retry-After')).toBeFocused();
      await expect(
        dialog.getByText('The retry after must be a number of seconds or an HTTP date.'),
      ).toBeVisible();
    });
  }
});

test.describe('Dado o campo Retry-After do cartão "Response" de Checks', () => {
  test('deve vir com o valor salvo e trocar por data HTTP Quando "Save response" é clicado', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ retry_after: '30' });
    const dialog = await abrirChecks(page, tokenId, 'Response');

    await expect(dialog.getByLabel('Retry-After')).toHaveValue('30');
    await dialog.getByLabel('Retry-After').fill(DATA_HTTP);
    await salvar(page, dialog, 'Save response', tokenId);

    expect(await tokens.read(tokenId)).toMatchObject({ retry_after: DATA_HTTP });
    const webhook = await request.get(`/${tokenId}/503`);
    expect(webhook.status()).toBe(503);
    expect(webhook.headers()['retry-after']).toBe(DATA_HTTP);
  });

  test('deve desligar o header Quando o campo é apagado (o PUT leva retry_after nulo)', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ retry_after: '30', default_status: '429' });
    const dialog = await abrirChecks(page, tokenId, 'Response');

    await dialog.getByLabel('Retry-After').fill('');
    const put = await salvar(page, dialog, 'Save response', tokenId);

    expect(put).toMatchObject({ retry_after: null });
    expect(await tokens.read(tokenId)).toMatchObject({ retry_after: null, default_status: 429 });
    const webhook = await request.post(`/${tokenId}`);
    expect(webhook.status()).toBe(429);
    expect(webhook.headers()).not.toHaveProperty('retry-after');
  });
});
