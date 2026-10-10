import { expect, test } from './support/caos';
import { acoes, itens } from './support/inbox';

test.describe('Dado uma ação que não dá certo', () => {
  test('deve dizer que não copiou, e não "Copied payload", Quando o navegador recusa a cópia', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: '{"a":1}' });
    await page.addInitScript(() => {
      document.execCommand = () => false;
    });
    await page.goto(`/#/${tokenId}/${requestId}/1`);

    await acoes(page).getByRole('button', { name: 'Copy payload' }).click();

    await expect(page.getByText('Could not copy. Select the text and copy it.')).toBeVisible();
    await expect(page.getByText('Copied payload')).toHaveCount(0);
  });

  test('deve devolver a mensagem à lista e dizer que não apagou Quando o DELETE responde 503', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/fica' });
    await page.clock.install();
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
    caos.recusar(new RegExp(`^/token/${tokenId}/request/`), 503, 'DELETE');

    await itens(page)
      .first()
      .getByRole('button', { name: /^Delete this request: / })
      .click();
    await expect(itens(page)).toHaveCount(0);
    await page.clock.fastForward(21_000);

    await expect(page.getByText('Could not delete (503). The request is still here.')).toBeVisible({
      timeout: 10_000,
    });
    await expect(itens(page)).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
  });
});
