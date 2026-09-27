import { expect, test } from './support/fixtures';

// Checklist 11. Item 14, E4: "Delete all requests" sai do rodapé para o cabeçalho da lista e pede confirmação
// (C §2.1). SUPOSIÇÃO: `dialog "Delete all requests?"` com "Delete all" e "Cancel".

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
    const confirmacao = page.getByRole('dialog', { name: 'Delete all requests?' });
    await confirmacao.getByRole('button', { name: 'Delete all', exact: true }).click();

    await expect(page.getByText('Waiting for first request...')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Requests (0)' })).toBeVisible();
    await expect.poll(async () => (await tokens.listed(tokenId)).length).toBe(0);
  });

  test('não deve apagar nada Quando a confirmação é cancelada', async ({ page, tokens }) => {
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (2)' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete all requests' }).click();
    const confirmacao = page.getByRole('dialog', { name: 'Delete all requests?' });
    await confirmacao.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(confirmacao).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Requests (2)' })).toBeVisible();
    expect(await tokens.listed(tokenId)).toHaveLength(2);
  });
});
