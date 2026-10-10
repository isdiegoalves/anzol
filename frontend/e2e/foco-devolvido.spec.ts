import { Page } from '@playwright/test';
import { escutarAnuncios, expectUmAnuncio } from './support/anuncios';
import { expect, test } from './support/caos';
import { abrirItem, busca, itens, lista } from './support/inbox';

const foraDoBody = (page: Page) => page.evaluate(() => document.activeElement !== document.body);

for (const lento of [false, true]) {
  test.describe(`Dado uma ação que tira de cena o elemento focado${lento ? ', com o servidor lento' : ''}`, () => {
    test.beforeEach(({ caos }) => {
      if (lento) {
        caos.atrasar(/^\/token\//, 1500);
      }
    });

    test('deve levar o foco à primeira nova Quando a pílula das novas é usada', async ({
      page,
      tokens,
    }) => {
      const tokenId = await tokens.create();
      for (let i = 1; i <= 30; i++) {
        await tokens.send(tokenId, { path: `/base-${i}` });
      }
      await page.goto(`/#/${tokenId}`);
      await expect(page.getByRole('heading', { name: 'Requests (30)' })).toBeVisible();
      await lista(page)
        .locator('cdk-virtual-scroll-viewport')
        .evaluate((viewport) => (viewport.scrollTop = 600));
      const nova = await tokens.send(tokenId, { path: '/nova' });
      const pilula = page.getByRole('button', { name: '1 new request' });

      await pilula.focus();
      await page.keyboard.press('Enter');

      await expect(abrirItem(page, nova)).toBeFocused();
    });

    test('deve voltar à linha A e dizer "Comparison cancelled." Quando o Compare é cancelado', async ({
      page,
      tokens,
    }) => {
      const tokenId = await tokens.create();
      await tokens.send(tokenId, { path: '/b' });
      const a = await tokens.send(tokenId, { path: '/a' });
      await escutarAnuncios(page);
      await page.goto(`/#/${tokenId}/${a}/1`);
      await page.getByRole('button', { name: /^Compare with/ }).click();

      await page.locator('app-compare-band').getByRole('button', { name: 'Cancel' }).focus();
      await page.keyboard.press('Enter');

      await expect(abrirItem(page, a)).toBeFocused();
      await expectUmAnuncio(page, /^Comparison cancelled\.$/);
    });

    test('deve levar o foco a "Filters" Quando um filtro ligado é tirado', async ({
      page,
      tokens,
    }) => {
      const tokenId = await tokens.create();
      await tokens.send(tokenId, { path: '/base' });
      await page.goto(`/#/${tokenId}?q=base`);
      const tirar = busca(page).getByRole('button', { name: /^Remove this filter/ });

      await tirar.focus();
      await page.keyboard.press('Enter');

      await expect(busca(page).getByRole('button', { name: /^Filters/ })).toBeFocused();
    });

    test('deve pôr o foco no segredo ao abrir e no título "Inbox" Quando a URL é destrancada', async ({
      page,
      tokens,
    }) => {
      const tokenId = await tokens.create({ read_secret: 'segredo-foco' });
      await page.goto(`/#/${tokenId}`);
      const segredo = page.getByLabel('Read secret');
      await expect(segredo).toBeFocused();

      await segredo.fill('segredo-foco');
      await page.keyboard.press('Enter');

      await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeFocused();
    });

    test('deve manter o foco no botão Quando a ordem é trocada', async ({ page, tokens }) => {
      const tokenId = await tokens.create();
      await tokens.send(tokenId, { path: '/base' });
      await page.goto(`/#/${tokenId}`);
      const ordem = page.getByRole('button', { name: /Change order$/ });

      await ordem.focus();
      await page.keyboard.press('Enter');

      await expect(
        page.getByRole('button', { name: 'Sorted oldest first. Change order' }),
      ).toBeFocused();
    });

    test('deve levar o foco à linha de status do filtro Quando se chega por um número da Métricas', async ({
      page,
      tokens,
    }) => {
      const tokenId = await tokens.create();
      await tokens.send(tokenId, { path: '/base' });
      await page.goto(`/#/${tokenId}/insights`);
      const numero = page.locator('a[href*="answered=200"]').first();

      await numero.focus();
      await page.keyboard.press('Enter');

      await expect(busca(page).locator('app-live-region.count')).toBeFocused();
      await expect(busca(page).locator('app-live-region.count')).toContainText(
        'Filtered by answered 200',
      );
    });

    test('deve levar o foco à linha seguinte Quando a lixeira apaga a linha focada', async ({
      page,
      tokens,
    }) => {
      const tokenId = await tokens.create();
      const terceira = await tokens.send(tokenId, { path: '/terceira' });
      const segunda = await tokens.send(tokenId, { path: '/segunda' });
      await tokens.send(tokenId, { path: '/primeira' });
      await page.goto(`/#/${tokenId}`);
      await expect(page.getByRole('heading', { name: 'Requests (3)' })).toBeVisible();

      await abrirItem(page, segunda).focus();
      await page.keyboard.press('Tab');
      await expect(itens(page).nth(1).locator('button.delete')).toBeFocused();
      await page.keyboard.press('Enter');

      await expect(abrirItem(page, terceira)).toBeFocused();
    });

    if (!lento) {
      test('deve abrir "Create New URL" com o foco no título, e não em "Customize response"', async ({
        page,
        tokens,
      }) => {
        const tokenId = await tokens.create();
        await page.goto(`/#/${tokenId}`);
        await page.getByRole('button', { name: 'New URL', exact: true }).click();

        await expect(
          page.getByRole('dialog').getByRole('heading', { name: 'Create New URL' }),
        ).toBeFocused();
      });
    }

    if (lento) {
      test('não deve deixar o foco no body Quando a lista que falhou é pedida de novo', async ({
        page,
        tokens,
        caos,
      }) => {
        const tokenId = await tokens.create();
        const unica = await tokens.send(tokenId, { path: '/unica' });
        const desfaz = caos.recusar(new RegExp(`^/token/${tokenId}/requests\\?page=1`), 503);
        await page.goto(`/#/${tokenId}`);
        const tentar = page.getByRole('button', { name: 'Try again now' });
        await expect(tentar).toBeVisible();
        desfaz();

        await tentar.focus();
        await page.keyboard.press('Enter');

        expect(await foraDoBody(page)).toBe(true);
        await expect(abrirItem(page, unica)).toBeFocused({ timeout: 15_000 });
      });
    }
  });
}

test.describe('Dado a lista que passou de 30 s sem chegar', () => {
  test('deve esperar na região da lista e ir à linha quando ela chega Quando "Try again" tira o aviso da tela', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    const unica = await tokens.send(tokenId, { path: '/unica' });
    const presa = caos.segurar(new RegExp(`^/token/${tokenId}/requests\\?`));
    await page.clock.install();
    await page.goto(`/#/${tokenId}`);
    await presa.respondida;
    await page.clock.fastForward('00:31');
    const tentar = lista(page).getByRole('button', { name: 'Try again', exact: true });

    await tentar.focus();
    await page.keyboard.press('Enter');

    await expect(tentar).toHaveCount(0);
    await expect(lista(page)).toBeFocused();
    presa.soltar();
    await expect(abrirItem(page, unica)).toBeFocused();
  });
});
