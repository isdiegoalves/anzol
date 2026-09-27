import { expect, test } from './support/fixtures';
import { abrirItem, detalhes, item, itens, lista } from './support/inbox';

import { readStorage, seedStorage } from './support/storage';

// Checklist 6. Item 14, E4: itens de três linhas com selos (C §2.1); First/Previous/Next/Last viram "Newer"/"Older"
// (e K/J); a paginação vira o rodapé "{de}–{até} of {total}" com "Previous page"/"Next page".
// SUPOSIÇÕES (contrato da E4, ver `support/inbox.ts`):
// - o método é o `app-method-badge` da E2, com o papel de cor de hoje na classe (success/info/danger);
// - a lista segue a ordem da API (a mais antiga primeiro): "Older" fica desabilitado na primeira e "Newer" na
//   última; J abre a mais antiga seguinte e K a mais nova;
// - o rodapé diz o que está carregado ("{de}–{até} of {total}"; carregar a página anterior soma as duas) e esconde
//   "Previous page"/"Next page" nas pontas, como hoje.

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

    await expect(page.getByRole('heading', { name: 'Requests (3)' })).toBeVisible();
    await expect(itens(page)).toHaveCount(3);
    for (const [index, { uuid, method }] of (await tokens.listed(tokenId)).entries()) {
      const linha = itens(page).nth(index);
      await expect(linha).toContainText(`#${uuid.substring(0, 5)}`);
      await expect(linha.locator('app-method-badge')).toHaveText(method);
      await expect(linha.locator('app-method-badge')).toHaveClass(new RegExp(COLOR[method]));
      await expect(linha).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM)/);
      await expect(abrirItem(page, uuid)).toHaveAccessibleName(new RegExp(`^${method}\\b`));
    }
  });

  test('deve destacar a não lida e tirar o destaque Quando ela é aberta', async ({ page }) => {
    await seedStorage(page, { unread: JSON.stringify([ids[2]]) });
    await page.goto(`/#/${tokenId}/${ids[0]}/1`);
    await expect(abrirItem(page, ids[2])).toHaveAccessibleName(/\bunread\b/);
    await expect(abrirItem(page, ids[1])).not.toHaveAccessibleName(/\bunread\b/);
    await expect(abrirItem(page, ids[0])).toHaveAttribute('aria-current', /.+/);
    await expect(page).toHaveTitle('(1) Webhook.site');

    await abrirItem(page, ids[2]).click();

    await expect(abrirItem(page, ids[2])).not.toHaveAccessibleName(/\bunread\b/);
    await expect(abrirItem(page, ids[2])).toHaveAttribute('aria-current', /.+/);
    await expect(page).toHaveTitle('Webhook.site');
    expect((await readStorage(page))['unread']).toBe('[]');
  });

  test('deve apagar uma mensagem pela API Quando a lixeira dela é clicada', async ({
    page,
    tokens,
  }) => {
    await page.goto(`/#/${tokenId}`);

    await item(page, ids[1]).hover();
    await page.getByRole('button', { name: `Delete request ${ids[1]}` }).click();

    await expect(itens(page)).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Requests (2)' })).toBeVisible();
    // O apagar tem "Undo" por alguns segundos (C §2.1): a API recebe o DELETE depois.
    await expect
      .poll(async () => (await tokens.listed(tokenId)).map((r) => r.uuid), { timeout: 15_000 })
      .toEqual([ids[0], ids[2]]);
  });

  test('deve andar para a mais nova e a mais antiga Quando "Newer", "Older", K e J são usados', async ({
    page,
  }) => {
    await page.goto(`/#/${tokenId}/${ids[0]}/1`);
    await expect(detalhes(page)).toContainText(ids[0]);
    await expect(page.getByRole('button', { name: 'Older', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'Newer', exact: true }).click();
    await expect(detalhes(page)).toContainText(ids[1]);
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${ids[1]}/1$`));

    await page.getByRole('button', { name: 'Newer', exact: true }).click();
    await expect(detalhes(page)).toContainText(ids[2]);
    await expect(page.getByRole('button', { name: 'Newer', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'Older', exact: true }).click();
    await expect(detalhes(page)).toContainText(ids[1]);

    // Atalhos de uma tecla (S18), fora de campos: K abre a mais nova, J a mais antiga.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('k');
    await expect(detalhes(page)).toContainText(ids[2]);
    await page.keyboard.press('j');
    await expect(detalhes(page)).toContainText(ids[1]);
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${ids[1]}/1$`));
    await expect(lista(page)).toBeVisible();
  });
});

test.describe('Dado uma URL com mais de uma página de mensagens (checklist 6)', () => {
  test('deve carregar a página anterior e a próxima Quando os botões do rodapé são clicados', async ({
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
    const anterior = page.getByRole('button', { name: 'Previous page', exact: true });
    const proxima = page.getByRole('button', { name: 'Next page', exact: true });

    await page.goto(`/#!/${tokenId}/${segundaPagina}/2`);

    await expect(detalhes(page)).toContainText(segundaPagina);
    await expect(page.getByRole('heading', { name: 'Requests (51)' })).toBeVisible();
    await expect(page.getByText('51–51 of 51', { exact: true })).toBeVisible();
    await expect(proxima).toHaveCount(0);
    await anterior.click();
    await expect(page.getByText('1–51 of 51', { exact: true })).toBeVisible();
    await expect(anterior).toHaveCount(0);
    await abrirItem(page, primeira).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${primeira}/1$`));

    await page.goto(`/#/${tokenId}`);
    await page.reload();
    await expect(page.getByText('1–50 of 51', { exact: true })).toBeVisible();
    await proxima.click();
    await expect(page.getByText('1–51 of 51', { exact: true })).toBeVisible();
    await expect(proxima).toHaveCount(0);
    // A última carregada (a da página 2), rolando a lista até o fim, no lugar do antigo "Last".
    await lista(page).hover();
    await page.mouse.wheel(0, 100_000);
    await abrirItem(page, segundaPagina).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${segundaPagina}/2$`));
  });
});
