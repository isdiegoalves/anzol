import { expect, test } from './support/fixtures';
import { seedStorage } from './support/storage';

test.use({ reducedMotion: 'reduce' });

test.describe('Dado o sistema pedindo menos movimento', () => {
  test('deve ir à seção de Verificações de uma vez, sem a rolagem suave', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.addInitScript(() => {
      const rolar = Element.prototype.scrollIntoView;
      const pedidos: unknown[] = [];
      Object.assign(window, { rolagensPedidas: pedidos });
      Element.prototype.scrollIntoView = function (opcoes?: boolean | ScrollIntoViewOptions) {
        pedidos.push(opcoes);
        rolar.call(this, opcoes);
      };
    });

    await page.goto(`/#/${tokenId}/checks?section=health`);

    const atalhos = page.getByRole('navigation', { name: 'On this page' });
    await expect(atalhos.locator('[aria-current]')).toContainText('Health');
    await expect(page.getByRole('region', { name: 'Health' })).toBeInViewport();
    expect(
      await page.evaluate(
        () => (window as unknown as { rolagensPedidas: unknown[] }).rolagensPedidas,
      ),
    ).toContainEqual({ block: 'start', behavior: 'auto' });
  });

  test('deve abrir "Forward from this browser (legacy)" sem a seta girar aos poucos', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/outbound`);

    const legado = page.getByRole('button', { name: 'Forward from this browser (legacy)' });
    await expect(legado.locator('.chevron')).toHaveCSS('transition-duration', '0s');
  });
});
