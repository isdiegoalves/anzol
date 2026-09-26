import { Page } from '@playwright/test';
import { expect, test, tokenInUrl } from './support/fixtures';

// Limpeza automática: campo nos diálogos da URL, contador com o limite e lista ao vivo
// coerente com o corte FIFO do servidor. Precisa do backend com `auto_cleanup` e `removed`.

async function chooseAutoCleanup(page: Page, option: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Auto cleanup' }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Abre a URL e espera o `EventSource` receber os cabeçalhos (assinatura pronta no servidor). */
async function openListening(page: Page, path: string, tokenId: string): Promise<void> {
  const stream = page.waitForResponse((response) =>
    response.url().endsWith(`/token/${tokenId}/stream`),
  );
  await page.goto(path);
  expect((await stream).status()).toBe(200);
}

test.describe('Dado o campo "Auto cleanup" dos diálogos da URL', () => {
  test('deve criar a URL com o limite escolhido e mostrá-lo no contador Quando Create é clicado', async ({
    page,
    tokens,
  }) => {
    const original = await tokens.create();
    await page.goto(`/#/${original}`);

    await page.getByRole('button', { name: 'New' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New URL' });
    await expect(dialog.getByRole('combobox', { name: 'Auto cleanup' })).toHaveText('Disabled');
    await chooseAutoCleanup(page, '1000');
    await expect(dialog.getByText('Keeps the 1000 most recent requests')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('New URL created')).toBeVisible();
    // A mensagem aparece antes de a rota trocar: espera sair da URL de origem antes de ler o token.
    await expect(page).not.toHaveURL(new RegExp(original));
    const novo = tokenInUrl(page);
    tokens.track(novo);
    expect(await tokens.read(novo)).toMatchObject({ auto_cleanup: 1000 });
    await expect(page.getByRole('heading', { name: 'Requests (0 / 1000)' })).toBeVisible();
  });

  test('deve desligar a limpeza Quando Disabled é escolhido no Edit (o PUT leva auto_cleanup nulo)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ auto_cleanup: 500 });
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (0 / 500)' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit URL' });
    await expect(dialog.getByRole('combobox', { name: 'Auto cleanup' })).toHaveText('500');
    await chooseAutoCleanup(page, 'Disabled');
    const put = page.waitForRequest(
      (sent) => sent.method() === 'PUT' && sent.url().endsWith(`/token/${tokenId}`),
    );
    await dialog.getByRole('button', { name: 'Edit' }).click();

    expect((await put).postDataJSON()).toMatchObject({ auto_cleanup: null, retry_after: null });
    await expect(page.getByText('URL updated!')).toBeVisible();
    expect(await tokens.read(tokenId)).toMatchObject({ auto_cleanup: null });
    await expect(page.getByRole('heading', { name: 'Requests (0)' })).toBeVisible();
  });
});

test.describe('Dado uma URL cheia com a mensagem mais antiga aberta', () => {
  test.setTimeout(120_000);

  test('deve tirar a cortada, abrir a seguinte e manter o contador Quando chega mais uma ao vivo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ auto_cleanup: 500 });
    await tokens.sendMany(tokenId, 500);
    const [antiga, seguinte] = await tokens.listed(tokenId);
    await openListening(page, `/#/${tokenId}/${antiga.uuid}/1`, tokenId);
    const details = page.getByRole('table', { name: 'Request Details' });
    await expect(details).toContainText(antiga.uuid);
    await expect(page.getByRole('heading', { name: 'Requests (500 / 500)' })).toBeVisible();

    await tokens.send(tokenId);

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${seguinte.uuid}/1$`));
    await expect(details).toContainText(seguinte.uuid);
    await expect(page.getByRole('button', { name: `Delete request ${antiga.uuid}` })).toHaveCount(
      0,
    );
    await expect(page.getByRole('heading', { name: 'Requests (500 / 500)' })).toBeVisible();

    await page.reload();
    await expect(details).toContainText(seguinte.uuid);
    await expect(page.getByRole('button', { name: `Delete request ${antiga.uuid}` })).toHaveCount(
      0,
    );
    await expect(page.getByRole('heading', { name: 'Requests (500 / 500)' })).toBeVisible();
  });

  test('deve recarregar a lista e abrir a mais próxima Quando o limite é reduzido no Edit', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 505);
    const ordem = await tokens.listed(tokenId);
    const [antiga, primeiraQueFica] = [ordem[0], ordem[5]];
    await page.goto(`/#/${tokenId}/${antiga.uuid}/1`);
    const details = page.getByRole('table', { name: 'Request Details' });
    await expect(details).toContainText(antiga.uuid);
    await expect(page.getByRole('heading', { name: 'Requests (505)' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    await chooseAutoCleanup(page, '500');
    await page
      .getByRole('dialog', { name: 'Edit URL' })
      .getByRole('button', { name: 'Edit' })
      .click();

    await expect(page.getByRole('heading', { name: 'Requests (500 / 500)' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${primeiraQueFica.uuid}/1$`));
    await expect(details).toContainText(primeiraQueFica.uuid);
    for (const cortada of ordem.slice(0, 5)) {
      await expect(
        page.getByRole('button', { name: `Delete request ${cortada.uuid}` }),
      ).toHaveCount(0);
    }
  });
});
