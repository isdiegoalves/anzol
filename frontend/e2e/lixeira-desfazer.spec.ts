import { APIRequestContext, Locator, Page } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import {
  anunciados,
  escutarAnuncios,
  expectSoEstaFala,
  expectUmAnuncio,
  limparAnuncios,
} from './support/anuncios';
import { TokenTracker, expect, test } from './support/fixtures';
import { abrirItem, busca, item, itens, lixeira } from './support/inbox';
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

  test('deve levar o foco à linha seguinte Quando a lista tem mais linhas do que desenha', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const enviadas: string[] = [];
    for (let numero = 1; numero <= 40; numero++) {
      enviadas.push(await tokens.send(tokenId, { path: `/linha-${numero}` }));
    }
    const [terceira, segunda] = enviadas.slice(-3);
    await page.goto(`/#/${tokenId}`);
    await expect(abrirItem(page, segunda)).toBeVisible();

    await apagarPeloTeclado(page, segunda);

    await expect(abrirItem(page, terceira)).toBeFocused();
    await expect(item(page, segunda)).toHaveCount(0);
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

test.describe('Dado dois apagares seguidos, com o "Undo" do primeiro ainda aberto', () => {
  test('deve dizer cada um Quando as duas requisições têm o mesmo método e a mesma rota', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const iguais: string[] = [];
    for (let i = 0; i < 4; i++) {
      iguais.push(await tokens.send(tokenId, { path: '/igual' }));
    }
    await escutarAnuncios(page);
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(4);
    await limparAnuncios(page);

    const ditas = async () =>
      (await anunciados(page))
        .filter((anuncio) => anuncio.texto.startsWith('You deleted POST /igual.'))
        .map((anuncio) => anuncio.nasceuComTexto);

    await apagarPeloTeclado(page, iguais[1]);
    await expect.poll(ditas, 'o primeiro apagar é dito').toEqual([false]);
    await lixeira(page, iguais[2]).click();
    await expect(itens(page)).toHaveCount(2);

    await expect.poll(ditas, 'o segundo, com a mesma frase, também').toEqual([false, false]);
  });

  test('deve mudar o aviso uma vez só Quando o segundo é o da requisição aberta', async ({
    page,
    tokens,
  }) => {
    const { tokenId, primeira, segunda } = await comTres(tokens);
    await escutarAnuncios(page);
    await page.goto(`/#/${tokenId}/${primeira}/1`);
    await expect(itens(page)).toHaveCount(3);
    await apagarPeloTeclado(page, segunda);
    await expect(avisoDaRequisicao(page)).toHaveText(APAGOU);
    await limparAnuncios(page);

    await lixeira(page, primeira).click();

    await expectSoEstaFala(
      page,
      /^You deleted this request at .*This copy goes away when you leave it\. Undo is in the request notice\.$/,
      /^Request notice$/,
    );
  });
});

test.describe('Dado um filtro ligado, com a contagem dele na linha de resultado', () => {
  test('deve falar uma vez só, pelo aviso da requisição, e acertar a contagem sem falar por ela', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/fora' });
    const ultima = await tokens.send(tokenId, { path: '/base-3' });
    const meio = await tokens.send(tokenId, { path: '/base-2' });
    await tokens.send(tokenId, { path: '/base-1' });
    await escutarAnuncios(page);
    await page.goto(`/#/${tokenId}?q=base`);
    await expect(page.getByRole('heading', { name: 'Requests (3 of 4)' })).toBeVisible();
    const resultado = busca(page).locator('app-live-region.count');
    await expect(resultado).toContainText('3 requests match');
    await limparAnuncios(page);

    await apagarPeloTeclado(page, meio);
    await expect(abrirItem(page, ultima)).toBeFocused();

    await expect(page.getByRole('heading', { name: 'Requests (2 of 3)' })).toBeVisible();
    await expect(resultado).toContainText('2 requests match');
    await expectSoEstaFala(
      page,
      /^You deleted POST \/base-2\. Undo is in the request notice\.$/,
      /^Request notice$/,
    );
    await limparAnuncios(page);

    await desfazer(page).click();

    await expect(busca(page).locator('app-live-region.count')).toContainText('3 requests match');
    await expectSoEstaFala(page, /^Request restored\.$/);
  });
});

test.describe('Dado o "Undo" que vence com a cópia da apagada na tela', () => {
  test('deve tirar do aviso só a frase do "Undo", sem regravar o texto da cópia', async ({
    page,
    tokens,
  }) => {
    const { tokenId, segunda } = await comTres(tokens);
    await page.clock.install();
    await page.goto(`/#/${tokenId}/${segunda}/1`);
    await expect(itens(page)).toHaveCount(3);
    await apagarPeloTeclado(page, segunda);
    await expect(avisoDaRequisicao(page)).toContainText('Undo is in the request notice.');
    await expect(avisoDaRequisicao(page).locator('[aria-hidden]')).toHaveCount(0);
    // O que muda na região viva: texto regravado faz o leitor repetir a frase; nó que só sai, não.
    await avisoDaRequisicao(page).evaluate((regiao) => {
      const mudancas: string[] = [];
      (window as unknown as { __mudancas: string[] }).__mudancas = mudancas;
      const textos = (nos: NodeList) => [...nos].map((no) => no.textContent).join('|');
      new MutationObserver((registros) => {
        for (const registro of registros) {
          mudancas.push(
            registro.type === 'characterData'
              ? `texto regravado: ${registro.target.textContent}`
              : `entrou [${textos(registro.addedNodes)}], saiu [${textos(registro.removedNodes)}]`,
          );
        }
      }).observe(regiao, { subtree: true, childList: true, characterData: true });
    });

    await page.clock.fastForward(21_000);
    await expect(desfazer(page)).toHaveCount(0);

    await expect(avisoDaRequisicao(page)).toHaveText(
      /^You deleted this request at .*This copy goes away when you leave it\.$/,
    );
    expect(
      await page.evaluate(() => (window as unknown as { __mudancas: string[] }).__mudancas),
    ).toEqual(['entrou [], saiu [ Undo is in the request notice.]']);
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

test.describe('Dado um painel por vez, com a lista à vista e o aviso da requisição fora da tela', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const aviso = (page: Page) => page.locator('mat-snack-bar-container');
  const desfazerDoAviso = (page: Page) => aviso(page).getByRole('button', { name: 'Undo' });

  test('deve falar uma vez só, pelo snackbar, sem citar o aviso da requisição', async ({
    page,
    tokens,
  }) => {
    const { tokenId, segunda } = await comTres(tokens);
    await escutarAnuncios(page);
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(3);
    await expect(page.getByRole('group', { name: 'Request notice' })).toHaveCount(0);
    await limparAnuncios(page);

    await apagarPeloTeclado(page, segunda);

    await expect(aviso(page)).toContainText('Request deleted');
    await expectSoEstaFala(page, /^Request deleted/);
    expect(
      (await anunciados(page)).filter((anuncio) => anuncio.texto.includes('request notice')),
    ).toEqual([]);
  });

  test('deve manter o "Undo" do snackbar por 20 s, ao alcance do Tab, e devolver a requisição por ele', async ({
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
    await expect(desfazerDoAviso(page)).toBeVisible();

    await page.clock.fastForward(15_000);
    await expect(desfazerDoAviso(page)).toBeVisible();
    expect(apagadas).toEqual([]);

    for (let paradas = 0; paradas < 40; paradas++) {
      if (await desfazerDoAviso(page).evaluate((botao) => botao === document.activeElement)) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    await expect(desfazerDoAviso(page)).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(itens(page)).toHaveCount(3);
    await expect(item(page, segunda)).toBeVisible();
    await page.clock.fastForward(21_000);
    expect(apagadas).toEqual([]);
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
