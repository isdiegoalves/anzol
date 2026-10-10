import { Page } from '@playwright/test';
import { expect, test } from './support/caos';
import { campoDeBusca, itens, lista } from './support/inbox';

const rotulos = (page: Page) =>
  itens(page)
    .locator('button.select')
    .evaluateAll((botoes) => botoes.map((botao) => botao.getAttribute('aria-label') ?? ''));
const titulo = (page: Page) => lista(page).getByRole('heading', { level: 2 });
const salva = (page: Page) =>
  page.evaluate(
    () => (JSON.parse(localStorage.getItem('token') ?? 'null') as { uuid?: string } | null)?.uuid,
  );

test.describe('Dado o servidor respondendo 503', () => {
  test('deve mostrar o erro da lista, sem onboarding nem número no título, e a mensagem que chega durante ele', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 3);
    const desfaz = caos.recusar(new RegExp(`^/token/${tokenId}/requests(\\?|$)`), 503, 'GET');

    await page.goto(`/#/${tokenId}`);

    await expect(lista(page).getByText('Could not load the list (503).')).toBeVisible();
    await expect(titulo(page)).toHaveText('Requests');
    await expect(page.getByText('Your URL is ready')).toHaveCount(0);
    await expect(page.getByText('Waiting for first request...')).toHaveCount(0);
    await expect(lista(page).getByRole('button', { name: 'Try again now' })).toBeVisible();

    await tokens.send(tokenId, { path: '/durante' });

    await expect.poll(() => rotulos(page)).toEqual([expect.stringContaining('/durante')]);
    await expect(
      lista(page).getByText('1 arrived just now; the 3 before it did not load (503).'),
    ).toBeVisible();
    await expect(titulo(page)).toHaveText('Requests');

    desfaz();
    await lista(page).getByRole('button', { name: 'Try again now' }).click();

    await expect(titulo(page)).toHaveText('Requests (4)');
    await expect.poll(() => rotulos(page).then((todos) => todos.length)).toBe(4);
    await expect(lista(page).getByText(/did not load/)).toHaveCount(0);
  });

  test('deve dizer uma vez que a busca falhou, sem resultado nem "of 0", e buscar de novo pelo "Try again"', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 12);
    await page.goto(`/#/${tokenId}`);
    await expect(titulo(page)).toHaveText('Requests (12)');
    const desfaz = caos.recusar(new RegExp(`^/token/${tokenId}/requests/search$`), 503, 'POST');

    await campoDeBusca(page).fill('base');

    await expect(page.getByText('Could not search (503).')).toHaveCount(1);
    await expect(page.getByText('Could not search (503).')).toBeVisible();
    await expect(itens(page)).toHaveCount(0);
    await expect(lista(page).locator('.range')).toHaveCount(0);
    await expect(page.getByText(/ of 0\b|0 requests match/)).toHaveCount(0);
    await expect(titulo(page)).toHaveText('Requests');
    await expect(campoDeBusca(page)).toHaveValue('base');

    desfaz();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();

    await expect(page.getByText('Could not search (503).')).toHaveCount(0);
    await expect(titulo(page)).toHaveText(/^Requests \(\d+ of 12\)$/);
  });

  test('deve mostrar a página de erro da URL, sem apagar a URL salva nem criar outra', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/antes' });
    await page.goto(`/#/${tokenId}`);
    await expect(titulo(page)).toHaveText('Requests (1)');
    const criadas: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/token') {
        criadas.push(request.url());
      }
    });
    const desfaz = caos.recusar(new RegExp(`^/token/${tokenId}$`), 503, 'GET');

    await page.reload();

    await expect(
      page.getByRole('heading', { name: 'Could not open this URL (503).' }),
    ).toBeVisible();
    await expect(page.getByText('Your saved URL is unchanged; nothing was created.')).toBeVisible();
    expect(await salva(page)).toBe(tokenId);

    await page.goto('/#/');

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}$`));
    await expect(
      page.getByRole('heading', { name: 'Could not open this URL (503).' }),
    ).toBeVisible();
    expect(await salva(page)).toBe(tokenId);
    expect(criadas).toEqual([]);

    desfaz();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();

    await expect(titulo(page)).toHaveText('Requests (1)');
    await expect.poll(() => rotulos(page)).toEqual([expect.stringContaining('/antes')]);
  });
});

test.describe('Dado o servidor demorando', () => {
  test('deve avisar da demora aos 30 s sem cancelar a lista, que entra quando chega', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 2);
    const listaPresa = caos.segurar(new RegExp(`^/token/${tokenId}/requests\\?`));
    await page.clock.install();
    await page.goto(`/#/${tokenId}`);
    await listaPresa.respondida;

    await page.clock.fastForward('00:31');

    await expect(lista(page).getByText('The server is taking more than 30 s.')).toBeVisible();
    await expect(lista(page).getByRole('button', { name: 'Try again', exact: true })).toBeVisible();

    listaPresa.soltar();

    await expect(titulo(page)).toHaveText('Requests (2)');
    await expect(lista(page).getByText('The server is taking more than 30 s.')).toHaveCount(0);
  });
});
