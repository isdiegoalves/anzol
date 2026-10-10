import { Page } from '@playwright/test';
import { expect, test } from './support/caos';
import { lista } from './support/inbox';
import { estadoAoVivo } from './support/shell';

const rodape = (page: Page) => lista(page).locator('.range');
const tentarAgora = (page: Page) => page.getByRole('button', { name: 'Try again now' });
const pilula = (page: Page) => page.getByRole('button', { name: /\bnew requests?\b/ });

async function abrir(page: Page, caminho: string): Promise<void> {
  await page.goto(`/#/${caminho}`);
  await expect(page.getByRole('heading', { name: /^Requests \(\d+\)$/ })).toBeVisible();
  await expect(estadoAoVivo(page)).toContainText('Live');
}

test.describe('Dado o /stream de uma URL que cai e volta', () => {
  test('deve trazer todas as que chegaram durante uma queda longa, mesmo mais de uma página', async ({
    page,
    tokens,
    caos,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/antes' });
    await abrir(page, tokenId);

    caos.cortar(tokenId);
    await expect(tentarAgora(page)).toBeVisible({ timeout: 20_000 });
    await tokens.sendMany(tokenId, 60, 20);
    caos.soltar(tokenId);
    await tentarAgora(page).click();

    await expect(page.getByRole('heading', { name: 'Requests (61)' })).toBeVisible();
    await expect(rodape(page)).toHaveText('1–61 of 61');
  });

  test('não deve trazer como novas as que já existiam Quando a volta pega a URL aberta na página 3', async ({
    page,
    tokens,
    caos,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 120);
    const [antiga] = await tokens.listed(tokenId, 3);
    await abrir(page, `${tokenId}/${antiga.uuid}/3`);
    await expect(rodape(page)).toHaveText('101–120 of 120');

    caos.cortar(tokenId);
    await expect(tentarAgora(page)).toBeVisible({ timeout: 20_000 });
    caos.soltar(tokenId);
    const retomada = page.waitForResponse((resposta) =>
      resposta.url().includes('/requests?after='),
    );
    await tentarAgora(page).click();
    await retomada;

    await expect(estadoAoVivo(page)).toContainText('Live');
    await expect(rodape(page)).toHaveText('101–120 of 120');
    await expect(pilula(page)).toHaveCount(0);
  });
});
