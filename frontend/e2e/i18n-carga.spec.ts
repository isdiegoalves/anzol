import { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { seedStorage } from './support/storage';

// A tradução pt-BR é um chunk à parte, com hash no nome, que o `main` importa antes do bootstrap. Na imagem, o
// index.html leva o trecho do `preload-translation.mjs`, que pede esse chunk junto com o `main` a quem vai ver a tela
// em pt-BR e não o pede a quem vai vê-la em inglês. Cada teste é uma carga fria: contexto novo, sem cache.

const EXPORTA_A_TRADUCAO = /export\s*\{[^}]*\btranslations\b/;

// O `ng serve` não passa pelo `preload-translation.mjs`: lá a tradução segue sendo pedida pelo `main`.
test.beforeEach(async ({ request }) => {
  const pagina = await (await request.get('/')).text();
  test.skip(pagina.includes('/@vite/client'), 'ng serve: o index.html não tem o preload');
});

/**
 * O chunk da tradução, achado por HTTP entre os que o `main` importa, pelo que ele exporta: não depende do que o
 * index.html manda pedir.
 */
async function chunkDaTraducao(request: APIRequestContext): Promise<string> {
  const pagina = await (await request.get('/')).text();
  const main = /src="(main-[^"]+\.js)"/.exec(pagina)?.[1];
  expect(main, 'o index.html aponta para o main').toBeDefined();
  const importados = new Set(
    (await (await request.get(`/${main}`)).text()).match(/chunk-[\w-]+\.js/g),
  );
  const traducoes: string[] = [];
  for (const chunk of importados) {
    if (EXPORTA_A_TRADUCAO.test(await (await request.get(`/${chunk}`)).text())) {
      traducoes.push(chunk);
    }
  }
  expect(traducoes, 'o main importa um chunk de tradução').toHaveLength(1);
  return `/${traducoes[0]}`;
}

/** Os `.js` que a página pede e os que o servidor recusa, pelo caminho. */
function vigiarJs(page: Page): { pedidos: string[]; recusados: string[] } {
  const js = { pedidos: [] as string[], recusados: [] as string[] };
  page.on('request', (pedido) => {
    const caminho = new URL(pedido.url()).pathname;
    if (caminho.endsWith('.js')) {
      js.pedidos.push(caminho);
    }
  });
  page.on('response', (resposta) => {
    const caminho = new URL(resposta.url()).pathname;
    if (caminho.endsWith('.js') && resposta.status() >= 400) {
      js.recusados.push(caminho);
    }
  });
  return js;
}

/**
 * Segura o `main` até a tradução ser pedida, ou por 5 s, e diz se o pedido saiu com ele ainda a caminho. Sem o
 * preload, quem pede a tradução é o `main`, depois de chegar e rodar: o pedido nunca sai antes.
 */
async function segurarOMain(page: Page, traducao: string): Promise<() => boolean> {
  const pedida = page
    .waitForRequest((pedido) => new URL(pedido.url()).pathname === traducao, { timeout: 5_000 })
    .then(
      () => true,
      () => false,
    );
  let antesDoMain = false;
  await page.route(/\/main-[^/]+\.js$/, async (route) => {
    antesDoMain = await pedida;
    await route.continue();
  });
  return () => antesDoMain;
}

const preloads = (page: Page) =>
  page
    .locator('link[rel="modulepreload"]')
    .evaluateAll((links) => links.map((link) => new URL((link as HTMLLinkElement).href).pathname));

test.describe('Dado o navegador em pt-BR e nenhum idioma escolhido', () => {
  test.use({ locale: 'pt-BR' });

  test('deve pedir a tradução com o main ainda a caminho', async ({ page, request, tokens }) => {
    const traducao = await chunkDaTraducao(request);
    const tokenId = await tokens.create();
    const pedidaAntesDoMain = await segurarOMain(page, traducao);

    await page.goto(`/#/${tokenId}`);

    await expect(page.getByRole('navigation', { name: 'Seções da URL' })).toBeVisible();
    expect(pedidaAntesDoMain(), 'a tradução foi pedida sem esperar o main chegar').toBe(true);
  });

  test('deve pedir uma vez só, pelo nome do chunk que o main importa', async ({
    page,
    request,
    tokens,
  }) => {
    const traducao = await chunkDaTraducao(request);
    const tokenId = await tokens.create();
    const js = vigiarJs(page);

    await page.goto(`/#/${tokenId}`);

    await expect(page.getByRole('heading', { name: 'Requisições (0)' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    expect(await preloads(page)).toContain(traducao);
    expect(js.pedidos.filter((caminho) => caminho === traducao)).toHaveLength(1);
    expect(js.recusados).toEqual([]);
  });

  test('não deve pedir a tradução Quando o inglês foi escolhido em Settings', async ({
    page,
    request,
    tokens,
  }) => {
    const traducao = await chunkDaTraducao(request);
    const tokenId = await tokens.create();
    await seedStorage(page, { language: '"en"' });
    const js = vigiarJs(page);

    await page.goto(`/#/${tokenId}`);

    await expect(page.getByRole('heading', { name: 'Requests (0)' })).toBeVisible();
    expect(js.pedidos).not.toContain(traducao);
    expect(await preloads(page)).not.toContain(traducao);
  });
});

test.describe('Dado o navegador em inglês', () => {
  test('não deve pedir a tradução', async ({ page, request, tokens }) => {
    const traducao = await chunkDaTraducao(request);
    const tokenId = await tokens.create();
    const js = vigiarJs(page);

    await page.goto(`/#/${tokenId}`);

    await expect(page.getByRole('heading', { name: 'Requests (0)' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(js.pedidos).not.toContain(traducao);
    expect(await preloads(page)).not.toContain(traducao);
  });

  test('deve pedir a tradução com o main ainda a caminho Quando o pt-BR foi escolhido em Settings', async ({
    page,
    request,
    tokens,
  }) => {
    const traducao = await chunkDaTraducao(request);
    const tokenId = await tokens.create();
    await seedStorage(page, { language: '"pt-BR"' });
    const pedidaAntesDoMain = await segurarOMain(page, traducao);

    await page.goto(`/#/${tokenId}`);

    await expect(page.getByRole('navigation', { name: 'Seções da URL' })).toBeVisible();
    expect(pedidaAntesDoMain(), 'a tradução foi pedida sem esperar o main chegar').toBe(true);
  });
});
