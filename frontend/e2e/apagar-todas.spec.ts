import { expect, test } from './support/fixtures';

// Checklist 11.

test.describe('Dado uma URL com mensagens (checklist 11)', () => {
  let tokenId: string;

  test.beforeEach(async ({ tokens }) => {
    tokenId = await tokens.create();
    await tokens.send(tokenId, { method: 'GET' });
    await tokens.send(tokenId, { method: 'POST' });
  });

  test('deve apagar todas e voltar a esperar Quando "Delete all requests" é clicado', async ({
    page,
    tokens,
  }) => {
    await page.goto(`/#/${tokenId}`);

    await page.getByRole('button', { name: 'Delete all requests' }).click();

    await expect(page.getByText('Waiting for first request...')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Requests (0)' })).toBeVisible();
    await expect.poll(async () => (await tokens.listed(tokenId)).length).toBe(0);
  });
});
