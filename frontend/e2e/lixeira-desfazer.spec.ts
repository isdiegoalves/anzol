import { APIRequestContext, Locator, Page } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import {
  escutarAnuncios,
  expectSoEstaFala,
  expectUmAnuncio,
  limparAnuncios,
} from './support/anuncios';
import { TokenTracker, expect, test } from './support/fixtures';
import { abrirItem, item, itens, lixeira } from './support/inbox';
import { avisoDaRequisicao } from './support/patamar';

const APAGOU = 'You deleted POST /segunda. Undo is in the request notice.';

/** Três requisições, da mais nova para a mais antiga: `/primeira` (a que a tela abre), `/segunda` e `/terceira`. */
async function comTres(tokens: TokenTracker) {
  const tokenId = await tokens.create();
  const terceira = await tokens.send(tokenId, { path: '/terceira' });
  const segunda = await tokens.send(tokenId, { path: '/segunda' });
  const primeira = await tokens.send(tokenId, { path: '/primeira' });
  return { tokenId, primeira, segunda, terceira };
}

function desfazer(page: Page): Locator {
  return page.getByRole('group', { name: 'Request notice' }).getByRole('button', { name: 'Undo' });
}

/** Espera a tela desenhar dois quadros: o que a tecla disparou já está no DOM. */
async function desenhar(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((pronto) =>
        requestAnimationFrame(() => requestAnimationFrame(() => pronto())),
      ),
  );
}

/** Lixeira da linha pelo teclado: o foco na linha, Tab e Enter. */
async function apagarPeloTeclado(page: Page, uuid: string): Promise<void> {
  await abrirItem(page, uuid).focus();
  await page.keyboard.press('Tab');
  await expect(lixeira(page, uuid)).toBeFocused();
  await page.keyboard.press('Enter');
}

test.describe('Dado a lixeira de uma linha usada pelo teclado', () => {
  test('deve dizer o método e a rota no nome da lixeira', async ({ page, tokens }) => {
    const { tokenId, segunda } = await comTres(tokens);
    await page.goto(`/#/${tokenId}`);

    await expect(lixeira(page, segunda)).toHaveAccessibleName('Delete this request: POST /segunda');
  });

  test('deve levar o foco à linha seguinte, e o Tab com Enter não apaga uma segunda', async ({
    page,
    tokens,
  }) => {
    const { tokenId, segunda, terceira } = await comTres(tokens);
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(3);

    await apagarPeloTeclado(page, segunda);
    await expect(abrirItem(page, terceira)).toBeFocused();
    await expect(itens(page)).toHaveCount(2);

    await page.keyboard.press('Tab');
    await expect(lixeira(page, terceira)).not.toBeFocused();
    await page.keyboard.press('Enter');
    await desenhar(page);

    await expect(avisoDaRequisicao(page)).toHaveText(APAGOU);
    await expect(itens(page)).toHaveCount(2);
    await expect(item(page, terceira)).toBeVisible();
  });

  test('deve falar uma vez só, pelo aviso da requisição, com o "Undo" nele', async ({
    page,
    tokens,
  }) => {
    const { tokenId, segunda } = await comTres(tokens);
    await escutarAnuncios(page);
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(3);
    await limparAnuncios(page);

    await apagarPeloTeclado(page, segunda);

    await expect(avisoDaRequisicao(page)).toHaveText(APAGOU);
    await expect(desfazer(page)).toBeVisible();
    await expectSoEstaFala(
      page,
      /^You deleted POST \/segunda\. Undo is in the request notice\.$/,
      /^Request notice$/,
    );
  });

  test('deve devolver a requisição, com o foco na linha dela, Quando o "Undo" do aviso é alcançado pelo Tab', async ({
    page,
    tokens,
  }) => {
    const { tokenId, segunda } = await comTres(tokens);
    const apagadas: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'DELETE') {
        apagadas.push(request.url());
      }
    });
    await escutarAnuncios(page);
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(3);
    await apagarPeloTeclado(page, segunda);
    await expect(desfazer(page)).toBeVisible();
    await limparAnuncios(page);

    for (let paradas = 0; paradas < 20; paradas++) {
      if (await desfazer(page).evaluate((botao) => botao === document.activeElement)) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    await expect(desfazer(page)).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(itens(page)).toHaveCount(3);
    await expect(abrirItem(page, segunda)).toBeFocused();
    await expect(avisoDaRequisicao(page)).toHaveText('');
    await expectUmAnuncio(page, /^Request restored\.$/);
    expect(apagadas).toEqual([]);
  });

  test('deve manter o "Undo" à mão e só apagar no servidor quando ele vence', async ({
    page,
    tokens,
  }) => {
    const { tokenId, segunda } = await comTres(tokens);
    const apagadas: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'DELETE') {
        apagadas.push(new URL(request.url()).pathname);
      }
    });
    await page.clock.install();
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(3);
    await apagarPeloTeclado(page, segunda);
    await expect(desfazer(page)).toBeVisible();

    // O relógio da página segue andando sozinho: a folga cobre a máquina lenta sem chegar aos 20 s.
    await page.clock.fastForward(15_000);
    await expect(desfazer(page)).toBeVisible();
    expect(apagadas).toEqual([]);

    await page.clock.fastForward(6_000);

    await expect.poll(() => apagadas).toEqual([`/token/${tokenId}/request/${segunda}`]);
    await expect(desfazer(page)).toHaveCount(0);
    await expect(avisoDaRequisicao(page)).toHaveText('');
  });

  test('deve dizer onde está o "Undo" no aviso da cópia Quando a apagada é a aberta', async ({
    page,
    tokens,
  }) => {
    const { tokenId, segunda } = await comTres(tokens);
    await escutarAnuncios(page);
    await page.goto(`/#/${tokenId}/${segunda}/1`);
    await expect(itens(page)).toHaveCount(3);
    await limparAnuncios(page);

    await apagarPeloTeclado(page, segunda);

    const frase =
      /^You deleted this request at \d{1,2}:\d{2}.*\. You are seeing the copy this page had loaded\. This copy goes away when you leave it\. Undo is in the request notice\.$/;
    await expect(avisoDaRequisicao(page)).toHaveText(frase);
    await expect(desfazer(page)).toBeVisible();
    await expectSoEstaFala(page, frase, /^Request notice$/);
  });
});

test.describe('Dado a página que sai com o "Undo" ainda aberto', () => {
  /** As requisições que a API ainda lista, com o segredo de leitura quando a URL é protegida. */
  async function noServidor(
    request: APIRequestContext,
    tokenId: string,
    segredo?: string,
  ): Promise<string[]> {
    const resposta = await request.get(`/token/${tokenId}/requests`, {
      headers: segredo ? { 'X-Anzol-Secret': segredo } : undefined,
    });
    return ((await resposta.json()) as { data: { uuid: string }[] }).data.map((r) => r.uuid);
  }

  test('deve apagar no servidor Quando a página é fechada', async ({ page, tokens, request }) => {
    const { tokenId, segunda } = await comTres(tokens);
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(3);
    await apagarPeloTeclado(page, segunda);
    await expect(desfazer(page)).toBeVisible();
    expect(await noServidor(request, tokenId)).toContain(segunda);

    await page.close({ runBeforeUnload: true });

    await expect.poll(() => noServidor(request, tokenId)).not.toContain(segunda);
  });

  test('deve apagar no servidor, sem o "Undo" na volta, Quando a página é recarregada', async ({
    page,
    tokens,
    request,
  }) => {
    const { tokenId, segunda } = await comTres(tokens);
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(3);
    await apagarPeloTeclado(page, segunda);
    await expect(desfazer(page)).toBeVisible();

    await page.reload();

    await expect.poll(() => noServidor(request, tokenId)).not.toContain(segunda);
    await expect(page.getByRole('heading', { name: /^Requests \(\d\)$/ })).toBeVisible();
    await expect(desfazer(page)).toHaveCount(0);
    await expect(avisoDaRequisicao(page)).toHaveText('');
  });

  test('deve apagar no servidor a requisição de uma URL protegida Quando a página é recarregada', async ({
    page,
    tokens,
    request,
  }) => {
    const segredo = 'segredo-do-undo';
    const tokenId = await tokens.create({ read_secret: segredo });
    const fica = await tokens.send(tokenId, { path: '/fica' });
    const sai = await tokens.send(tokenId, { path: '/sai' });
    await page.goto(`/#/${tokenId}`);
    await page.getByLabel('Read secret').fill(segredo);
    await page.keyboard.press('Enter');
    await expect(itens(page)).toHaveCount(2);
    await apagarPeloTeclado(page, sai);
    await expect(desfazer(page)).toBeVisible();

    await page.reload();

    await expect.poll(() => noServidor(request, tokenId, segredo)).toEqual([fica]);
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`Dado o aviso da requisição com o "Undo", no tema ${colorScheme}`, () => {
    test.use({ colorScheme });

    test('deve passar no axe sem violação grave', async ({ page, tokens }) => {
      const { tokenId, segunda } = await comTres(tokens);
      await page.goto(`/#/${tokenId}`);
      await expect(itens(page)).toHaveCount(3);
      await apagarPeloTeclado(page, segunda);
      await expect(desfazer(page)).toBeVisible();

      await expectSemViolacoesGraves(page, `aviso com Undo, ${colorScheme}`);
    });
  });
}
