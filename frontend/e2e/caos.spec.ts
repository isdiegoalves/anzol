import { Page } from '@playwright/test';
import { expect, test } from './support/caos';
import { item } from './support/inbox';
import { estadoAoVivo } from './support/shell';

async function abrir(page: Page, tokenId: string, total: number): Promise<void> {
  await page.goto(`/#/${tokenId}`);
  await expect(page.getByRole('heading', { name: `Requests (${total})` })).toBeVisible();
  await expect(estadoAoVivo(page)).toContainText('Live');
}

test.describe('Dado o proxy de caos na frente do app', () => {
  test('deve cortar só o /stream da URL escolhida: a outra segue ao vivo, a API da cortada responde e, solta, ela volta a receber', async ({
    page,
    context,
    tokens,
    caos,
  }) => {
    const [a, b] = [await tokens.create(), await tokens.create()];
    await tokens.send(a, { path: '/a-antes' });
    await tokens.send(b, { path: '/b-antes' });
    const paginaB = await context.newPage();
    await abrir(page, a, 1);
    await abrir(paginaB, b, 1);

    const religar = page.waitForRequest((pedido) => pedido.url().endsWith(`/token/${a}/stream`));
    expect(caos.cortar(a)).toBe(1);
    expect(await (await religar).response()).toBeNull();

    const naOutra = await tokens.send(b, { path: '/b-no-corte' });
    await expect(item(paginaB, naOutra)).toBeVisible();
    await expect(estadoAoVivo(paginaB)).toContainText('Live');
    await tokens.send(a, { path: '/a-no-corte' });
    expect(await tokens.listed(a)).toHaveLength(2);
    await expect(estadoAoVivo(page)).not.toContainText('Live');

    caos.soltar(a);

    await expect(estadoAoVivo(page)).toContainText('Live', { timeout: 15_000 });
    const depois = await tokens.send(a, { path: '/a-depois' });
    await expect(item(page, depois)).toBeVisible();
  });

  test('deve congelar só o /stream da URL escolhida: nada chega por ele, a outra segue ao vivo e, solto, ele reabre', async ({
    page,
    context,
    tokens,
    caos,
  }) => {
    const [a, b] = [await tokens.create(), await tokens.create()];
    await tokens.send(a, { path: '/a-antes' });
    await tokens.send(b, { path: '/b-antes' });
    const paginaB = await context.newPage();
    await abrir(page, a, 1);
    await abrir(paginaB, b, 1);

    expect(caos.congelar(a)).toBe(1);

    const congelada = await tokens.send(a, { path: '/a-no-congelamento' });
    await expect.poll(() => caos.engolidos(a)).toBeGreaterThan(0);
    await expect(item(page, congelada)).toHaveCount(0);
    const naOutra = await tokens.send(b, { path: '/b-no-congelamento' });
    await expect(item(paginaB, naOutra)).toBeVisible();
    expect(await tokens.listed(a)).toHaveLength(2);

    caos.soltar(a);

    await expect(estadoAoVivo(page)).toContainText('Live', { timeout: 15_000 });
    const depois = await tokens.send(a, { path: '/a-depois' });
    await expect(item(page, depois)).toBeVisible();
  });

  test('deve recusar e atrasar só a rota e o método pedidos, para a tela e para a API', async ({
    page,
    request,
    tokens,
    caos,
  }) => {
    const [a, b] = [await tokens.create(), await tokens.create()];
    const listaDe = (token: string) => `/token/${token}/requests?page=1&sorting=newest`;

    const pararDeRecusar = caos.recusar(new RegExp(`^/token/${a}/requests\\?`));
    caos.recusar(new RegExp(`^/token/${a}$`), 503, 'PUT');

    const recusada = page.waitForResponse((resposta) => resposta.url().endsWith(listaDe(a)));
    await page.goto(`/#/${a}`);
    expect((await recusada).status()).toBe(503);
    expect((await request.get(listaDe(b))).status()).toBe(200);
    expect((await request.get(`/token/${a}`)).status()).toBe(200);
    expect((await request.put(`/token/${a}`, { data: {} })).status()).toBe(503);
    pararDeRecusar();
    expect((await request.get(listaDe(a))).status()).toBe(200);
    caos.restaurar();
    expect((await request.put(`/token/${a}`, { data: {} })).status()).toBe(200);

    caos.atrasar(new RegExp(`^/token/${a}/requests\\?`), 1500);
    const chegadas: string[] = [];
    const inicio = Date.now();
    await Promise.all([
      request.get(listaDe(a)).then(() => chegadas.push('atrasada')),
      request.get(listaDe(b)).then(() => chegadas.push('outra')),
    ]);
    expect(chegadas).toEqual(['outra', 'atrasada']);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(1500);
  });
});
