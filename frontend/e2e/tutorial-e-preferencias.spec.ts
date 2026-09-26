import { expect, test } from './support/fixtures';
import { readStorage, seedStorage } from './support/storage';

// Checklist 12 e 14.

test.describe('Dado o tutorial (checklist 12)', () => {
  test('deve esconder e continuar escondido após recarregar Quando o × é clicado com mensagens', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    const tutorial = page.getByRole('region', { name: 'Tutorial' });
    await expect(tutorial).toBeVisible();

    await tutorial.getByRole('button', { name: 'Close' }).click();
    await expect(tutorial).toBeHidden();
    await page.reload();

    await expect(page.getByRole('table', { name: 'Request Details' })).toBeVisible();
    await expect(tutorial).toBeHidden();
    expect((await readStorage(page))['hideTutorial']).toBe('true');
  });

  test('deve mostrar o tutorial mesmo escondido Quando a URL não tem mensagens', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, { hideTutorial: 'true' });

    await page.goto(`/#/${tokenId}`);

    await expect(page.getByRole('region', { name: 'Tutorial' })).toContainText(`/${tokenId}`);
  });
});

test.describe('Dado as preferências no localStorage (checklist 14)', () => {
  /** Gravado pelo app atual (8084) em 2026-09-25, chaves e formato exatos. */
  const gravadoPeloAppAtual = (tokenId: string) => ({
    token: JSON.stringify({ uuid: tokenId, default_status: 200, cors: false }),
    formatJsonEnable: 'true',
    autoNavEnable: 'true',
    hideTutorial: 'true',
    redirectEnable: 'false',
    redirectUrl: '"http://destino.example"',
    redirectContentType: '"application/json"',
    redirectHeaders: '"x-token,referer"',
    redirectMethod: '"PUT"',
    unread: '[]',
  });

  test('deve abrir com as mesmas preferências Quando o localStorage veio do app atual', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, {
      data: '{"a":1}',
      headers: { 'content-type': 'application/json' },
    });
    await seedStorage(page, gravadoPeloAppAtual(tokenId));

    await page.goto('/');

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/`));
    await expect(page.getByRole('switch', { name: 'Format JSON/XML' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Auto Navigate' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Auto redirect' })).not.toBeChecked();
    await expect(page.getByRole('region', { name: 'Tutorial' })).toBeHidden();
    await expect(page.locator('pre')).toHaveText('{\n  "a": 1\n}');
    await page.getByRole('button', { name: 'Settings...' }).click();
    await expect(page.getByLabel('Redirect to')).toHaveValue('http://destino.example');
    await expect(page.getByLabel('Content Type')).toHaveValue('application/json');
    await expect(page.getByLabel('Redirect Headers')).toHaveValue('x-token,referer');
    await expect(page.getByRole('combobox', { name: 'HTTP Method' })).toContainText('PUT');
  });

  test('deve gravar nas mesmas chaves em JSON e manter após recarregar Quando as opções mudam', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);

    await page.getByRole('switch', { name: 'Format JSON/XML' }).click();
    await page.getByRole('switch', { name: 'Auto Navigate' }).click();
    await page.reload();

    await expect(page.getByRole('switch', { name: 'Format JSON/XML' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Auto Navigate' })).toBeChecked();
    const stored = await readStorage(page);
    expect(stored).toMatchObject({
      formatJsonEnable: 'true',
      autoNavEnable: 'true',
      redirectEnable: 'false',
      redirectUrl: 'null',
      redirectContentType: '"text/plain"',
      redirectHeaders: 'null',
      redirectMethod: '""',
      hideTutorial: 'false',
      unread: '[]',
    });
    expect(JSON.parse(stored['token'])).toMatchObject({ uuid: tokenId });
  });
});
