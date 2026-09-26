import { expect, test } from './support/fixtures';
import { readStorage, seedStorage } from './support/storage';

// Checklist 6.

const COLOR: Record<string, string> = { GET: 'success', POST: 'info', DELETE: 'danger' };

test.describe('Dado a lista lateral com três mensagens (checklist 6)', () => {
  let tokenId: string;
  let ids: string[];

  test.beforeEach(async ({ tokens }) => {
    tokenId = await tokens.create();
    for (const method of ['GET', 'POST', 'DELETE']) {
      await tokens.send(tokenId, { method });
    }
    ids = (await tokens.listed(tokenId)).map((request) => request.uuid);
  });

  test('deve mostrar método com a cor do app atual, início do UUID e data Quando a URL é aberta', async ({
    page,
    tokens,
  }) => {
    await page.goto(`/#/${tokenId}`);
    const items = page.locator('.item');

    await expect(page.getByRole('heading', { name: 'Requests (3)' })).toBeVisible();
    await expect(items).toHaveCount(3);
    for (const [index, { uuid, method }] of (await tokens.listed(tokenId)).entries()) {
      const item = items.nth(index);
      await expect(item).toContainText(`${method} #${uuid.substring(0, 5)}`);
      await expect(item).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM)/);
      await expect(item.locator('app-method-label span')).toHaveClass(new RegExp(COLOR[method]));
    }
  });

  test('deve destacar a não lida e tirar o destaque Quando ela é aberta', async ({ page }) => {
    await seedStorage(page, { unread: JSON.stringify([ids[2]]) });
    await page.goto(`/#/${tokenId}/${ids[0]}/1`);
    const unread = page.locator('.item.unread');
    await expect(unread).toHaveCount(1);
    await expect(page).toHaveTitle('(1) Webhook.site');

    await unread.getByRole('button', { name: new RegExp(`#${ids[2].substring(0, 5)}`) }).click();

    await expect(page.locator('.item.unread')).toHaveCount(0);
    await expect(page).toHaveTitle('Webhook.site');
    expect((await readStorage(page))['unread']).toBe('[]');
  });

  test('deve apagar uma mensagem pela API Quando o X dela é clicado', async ({ page, tokens }) => {
    await page.goto(`/#/${tokenId}`);

    await page.locator('.item').nth(1).hover();
    await page.getByRole('button', { name: `Delete request ${ids[1]}` }).click();

    await expect(page.locator('.item')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Requests (2)' })).toBeVisible();
    await expect
      .poll(async () => (await tokens.listed(tokenId)).map((r) => r.uuid))
      .toEqual([ids[0], ids[2]]);
  });

  test('deve andar por primeira, anterior, próxima e última Quando os botões são usados', async ({
    page,
  }) => {
    await page.goto(`/#/${tokenId}/${ids[0]}/1`);
    const details = page.getByRole('table', { name: 'Request Details' });
    await expect(details).toContainText(ids[0]);
    await expect(page.getByRole('button', { name: 'First' })).toBeDisabled();

    await page.getByRole('button', { name: 'Next →' }).click();
    await expect(details).toContainText(ids[1]);
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${ids[1]}/1$`));

    await page.getByRole('button', { name: 'Last' }).click();
    await expect(details).toContainText(ids[2]);
    await expect(page.getByRole('button', { name: 'Last' })).toBeDisabled();

    await page.getByRole('button', { name: '← Previous' }).click();
    await expect(details).toContainText(ids[1]);

    await page.getByRole('button', { name: 'First' }).click();
    await expect(details).toContainText(ids[0]);
  });
});

test.describe('Dado uma URL com mais de uma página de mensagens (checklist 6)', () => {
  test('deve carregar a página anterior e a próxima Quando os links de página são clicados', async ({
    page,
    tokens,
  }) => {
    test.setTimeout(90_000);
    const tokenId = await tokens.create();
    for (let n = 0; n < 51; n++) {
      await tokens.send(tokenId, { data: String(n) });
    }
    const primeira = (await tokens.listed(tokenId, 1))[0].uuid;
    const segundaPagina = (await tokens.listed(tokenId, 2))[0].uuid;

    await page.goto(`/#!/${tokenId}/${segundaPagina}/2`);

    await expect(page.getByRole('table', { name: 'Request Details' })).toContainText(segundaPagina);
    await expect(page.getByRole('heading', { name: 'Requests (51)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Previous Page' }).click();
    await expect(page.getByRole('button', { name: 'Previous Page' })).toHaveCount(0);
    await page.getByRole('button', { name: 'First' }).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${primeira}/1$`));

    await page.goto(`/#/${tokenId}`);
    await page.reload();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Last' }).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${segundaPagina}/2$`));
  });
});
