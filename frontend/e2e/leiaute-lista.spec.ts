import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { compacto } from './support/shell';
import { seedStorage } from './support/storage';

// Em pt-BR, onde os rótulos do cabeçalho da lista são mais compridos.
function lista(page: Page): Locator {
  return page.getByRole('region', { name: 'Lista de requisições', exact: true });
}

function divisoria(page: Page): Locator {
  return page.getByRole('separator', { name: 'Redimensionar lista e detalhe' });
}

/** Quanto a lista, ou algo que rola dentro dela, passa da própria largura (a barra de rolagem lateral). */
function rolagemLateral(regiao: Locator): Promise<string[]> {
  return regiao.evaluate((raiz) =>
    [raiz, ...raiz.querySelectorAll('*')].flatMap((no) => {
      const rola = ['auto', 'scroll'].includes(getComputedStyle(no).overflowX);
      return rola && no.scrollWidth > no.clientWidth + 1
        ? [`${no.className} ${no.scrollWidth} > ${no.clientWidth}`]
        : [];
    }),
  );
}

async function abrirEntrada(page: Page, tokenId: string, guardado: Record<string, string> = {}) {
  await seedStorage(page, { language: '"pt-BR"', ...guardado });
  await page.goto(`/#/${tokenId}`);
  await expect(lista(page).locator('.item').first()).toBeVisible();
}

test.describe('Dado a lista da Entrada numa tela larga', () => {
  test.beforeEach(({ page }) => {
    test.skip(compacto(page), 'lista e detalhe lado a lado só no desktop');
  });

  for (const tela of [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ]) {
    test(`deve começar a lista com mais de um quarto da janela a ${tela.width} px`, async ({
      page,
      tokens,
    }) => {
      const tokenId = await tokens.create();
      await tokens.send(tokenId, { path: '/webhooks/pagamentos' });
      await page.setViewportSize(tela);
      await abrirEntrada(page, tokenId);

      const largura = (await lista(page).boundingBox())!.width;
      expect(largura).toBeGreaterThan(tela.width / 4);
      expect(Number(await divisoria(page).getAttribute('aria-valuenow'))).toBe(Math.round(largura));
    });
  }

  test('deve manter a largura que a pessoa deixou na divisória', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/webhooks/pagamentos' });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await abrirEntrada(page, tokenId, { inboxListWidth: '340' });

    await expect(divisoria(page)).toHaveAttribute('aria-valuenow', '340');
    expect(Math.round((await lista(page).boundingBox())!.width)).toBe(340);
  });

  test('não deve ter rolagem lateral na lista, nem na largura mínima', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/webhooks/pagamentos' });
    await abrirEntrada(page, tokenId);
    expect(await rolagemLateral(lista(page)), 'na largura inicial').toEqual([]);

    await divisoria(page).focus();
    await page.keyboard.press('Home');
    await expect(divisoria(page)).toHaveAttribute('aria-valuenow', '300');
    expect(await rolagemLateral(lista(page)), 'na largura mínima').toEqual([]);
  });
});
