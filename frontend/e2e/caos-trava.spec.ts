import { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './support/caos';
import { itens, lista } from './support/inbox';
import { celular, linhaDaRegra } from './support/regras';
import { seedStorage } from './support/storage';

const rotulos = (page: Page) =>
  itens(page)
    .locator('button.select')
    .evaluateAll((botoes) => botoes.map((botao) => botao.getAttribute('aria-label') ?? ''));

type Regra = Record<string, unknown>;
const regra = (name: string): Regra => ({
  name,
  enabled: true,
  priority: 5,
  match: { method: ['POST'] },
  response: { status: 201, headers: {}, body: '' },
});

async function gravar(api: APIRequestContext, tokenId: string, rules: Regra[]): Promise<Regra[]> {
  const response = await api.put(`/token/${tokenId}/rules`, { data: rules });
  expect(response.status()).toBe(200);
  return (await response.json()) as Regra[];
}

test.describe('Dado um clique repetido com o pedido a caminho', () => {
  test('deve pedir a página seguinte uma vez só Quando "Next page" é clicado duas vezes', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 60, 30);
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (60)' })).toBeVisible();
    let pedidos = 0;
    page.on('request', (request) => {
      if (/\/requests\?.*page=2/.test(request.url())) {
        pedidos++;
      }
    });
    const pagina2 = caos.segurar(new RegExp(`^/token/${tokenId}/requests\\?.*page=2`));
    const proxima = page.getByRole('button', { name: 'Next page' });

    await proxima.click();
    await pagina2.respondida;
    await proxima.click({ force: true });
    pagina2.soltar();

    await expect(lista(page).locator('.range')).toHaveText('1–60 of 60');
    const todos = await rotulos(page);
    expect(new Set(todos).size).toBe(todos.length);
    expect(pedidos).toBe(1);
  });

  test('deve mover a regra uma posição, sem o aviso "changed elsewhere", Quando "Move down" é clicado duas vezes', async ({
    page,
    tokens,
    caos,
  }) => {
    test.skip(celular(page), 'as setas da linha ficam à vista só na lista larga');
    const tokenId = await tokens.create();
    await gravar(page.request, tokenId, [regra('A'), regra('B'), regra('C')]);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/rules`);
    await expect(page.getByRole('table', { name: 'Rules' })).toContainText('C');
    let gravacoes = 0;
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().endsWith(`/token/${tokenId}/rules`)) {
        gravacoes++;
      }
    });
    const put = caos.segurar(new RegExp(`^/token/${tokenId}/rules$`), 'PUT');
    const descer = linhaDaRegra(page, 'A').getByRole('button', { name: 'Move down' });

    await descer.click();
    await put.respondida;
    await descer.click({ force: true });
    put.soltar();

    await expect
      .poll(async () =>
        ((await (await page.request.get(`/token/${tokenId}/rules`)).json()) as Regra[]).map(
          (r) => r['name'],
        ),
      )
      .toEqual(['B', 'A', 'C']);
    await expect(page.getByRole('alert').filter({ hasText: 'changed elsewhere' })).toHaveCount(0);
    expect(gravacoes).toBe(1);
  });
});
