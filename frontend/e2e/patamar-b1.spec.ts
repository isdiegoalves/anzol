import { Locator, Page } from '@playwright/test';
import {
  escutarAnuncios,
  expectSemAnuncio,
  expectSoEstaFala,
  expectUmAnuncio,
  limparAnuncios,
} from './support/anuncios';
import { TokenTracker, expect, test } from './support/fixtures';
import {
  abrirFiltros,
  abrirItem,
  busca,
  campoDeBusca,
  detalhes,
  filtro,
  item,
  itens,
  lista,
} from './support/inbox';
import {
  CHAVE_URLS,
  abrirSeletor,
  botaoDeFiltros,
  conexao,
  filtrosLigados,
  id5,
  itensInteirosNaTela,
  listaDeUrls,
  seletor,
  urlInexistente,
  urlNoSeletor,
  urlsConhecidas,
  verResultado,
} from './support/patamar';
import {
  CAMINHO,
  DESTINOS,
  Destino,
  acaoDoShell,
  compacto,
  destino,
  estadoAoVivo,
} from './support/shell';
import { seedStorage } from './support/storage';

const ROTAS: [Destino, string][] = DESTINOS.map((nome) => [nome, CAMINHO[nome]]);

const CHIPS: Record<string, string[]> = {
  Method: ['POST', 'GET', 'PUT', 'DELETE', 'PATCH'],
  Signature: ['Signature invalid', 'Signature absent', 'Signature valid'],
  Schema: ['Schema invalid', 'Schema valid'],
  Answer: ['Answered by rule…', 'Near miss of…', 'Default response'],
};

async function abrirEntrada(page: Page, tokenId: string, n: number, rota = ''): Promise<void> {
  await page.goto(`/#/${tokenId}${rota}`);
  await expect(page.getByRole('heading', { name: `Requests (${n})` })).toBeVisible();
}

const TIPO_DO_EVENTO = 'charge.refunded';

/**
 * Uma requisição de rota longa, com tipo de evento no corpo, assinatura que não confere e a resposta padrão (o selo
 * "200 · Default response"): a segunda linha do item fica disputada. Com `schema` que o corpo não cumpre, entra mais
 * um selo de erro.
 */
async function comTipoDeEvento(
  tokens: TokenTracker,
  schema?: Record<string, unknown>,
): Promise<{ tokenId: string; id: string }> {
  const tokenId = await tokens.create({
    signature: { provider: 'github', secret: 'segredo-da-lista' },
    ...(schema && { schema }),
  });
  const id = await tokens.send(tokenId, {
    path: '/pedidos/2026/09/loja-centro/confirmacoes/instantaneas/pagamento-aprovado',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}`,
    },
    data: JSON.stringify({ type: TIPO_DO_EVENTO }),
  });
  return { tokenId, id };
}

/** O que a segunda linha do item deixa ver, contando o que sobra dentro dos recortes dos ancestrais. */
interface SegundaLinha {
  /** Letras do nome de quem respondeu à vista no selo, depois do "200 · " (a fonte é de largura fixa). */
  selo: number;
  /** Letras do tipo do evento à vista; 0 quando ele não aparece. */
  tipo: number;
  idInteiro: boolean;
  /** Os outros selos (assinatura, schema) estão inteiros. */
  selosInteiros: boolean;
}

function segundaLinha(linha: Locator): Promise<SegundaLinha> {
  return linha.evaluate((raiz, tipo) => {
    const aVista = (caixa: DOMRect, de: Element | null) => {
      let [esquerda, direita, topo, base] = [caixa.left, caixa.right, caixa.top, caixa.bottom];
      for (let el = de; el && raiz.contains(el); el = el.parentElement) {
        if (getComputedStyle(el).overflowX !== 'visible') {
          const corte = el.getBoundingClientRect();
          esquerda = Math.max(esquerda, corte.left);
          direita = Math.min(direita, corte.right);
          topo = Math.max(topo, corte.top);
          base = Math.min(base, corte.bottom);
        }
      }
      return { largura: Math.max(0, direita - esquerda), altura: Math.max(0, base - topo) };
    };
    /** Quantas letras de `texto` aparecem; o texto cortado gasta a última com as reticências. */
    const letras = (dentro: Element, texto: string): number => {
      const textos = document.createTreeWalker(dentro, NodeFilter.SHOW_TEXT);
      let no = textos.nextNode() as Text | null;
      while (no && !no.data.includes(texto)) {
        no = textos.nextNode() as Text | null;
      }
      if (!no) {
        return 0;
      }
      const faixa = document.createRange();
      faixa.setStart(no, no.data.indexOf(texto));
      faixa.setEnd(no, no.data.indexOf(texto) + texto.length);
      const inteiro = faixa.getBoundingClientRect();
      const visto = aVista(inteiro, no.parentElement);
      if (visto.altura < inteiro.height / 2) {
        return 0;
      }
      const cabem = Math.floor((visto.largura + 0.5) / (inteiro.width / texto.length));
      return cabem >= texto.length ? texto.length : Math.max(0, cabem - 1);
    };
    const inteiro = (el: Element) => {
      const caixa = el.getBoundingClientRect();
      return aVista(caixa, el).largura >= caixa.width - 0.5;
    };
    const selo = raiz.querySelector('.seals app-check-chip[data-kind="rule"] .title')!;
    const nome = (selo.textContent ?? '').trim();
    const numero = nome.indexOf(' · ') + 3;
    return {
      selo: letras(selo, nome) - numero,
      tipo: letras(raiz, tipo),
      idInteiro: inteiro(raiz.querySelector('.id')!),
      selosInteiros: [
        ...raiz.querySelectorAll('.seals app-check-chip:not([data-kind="rule"])'),
      ].every(inteiro),
    };
  }, TIPO_DO_EVENTO);
}

test.describe('Dado o seletor de URLs no cabeçalho', () => {
  test('deve mostrar a URL aberta como "URL {id5}" e listar as URLs abertas neste navegador, a aberta primeiro', async ({
    page,
    tokens,
  }) => {
    const a = await tokens.create();
    const b = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${a}`);
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(a)}. Switch URL`);
    await page.goto(`/#/${b}/rules`);
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(b)}. Switch URL`);
    await expect(seletor(page)).toContainText(`URL ${id5(b)}`);

    const painel = await abrirSeletor(page);

    const urls = painel.getByRole('menuitemradio');
    await expect(urls).toHaveCount(2);
    await expect(urls.first()).toHaveAccessibleName(`URL ${id5(b)}, ${id5(b)}, open now`);
    await expect(urls.first()).toHaveAttribute('aria-checked', 'true');
    await expect(urls.nth(1)).toHaveAccessibleName(
      new RegExp(`^URL ${id5(a)}, ${id5(a)}, opened .+`),
    );
    await expect(urls.nth(1)).toHaveAttribute('aria-checked', 'false');
    for (const acao of ['New URL…', 'Rename this URL…', 'Forget a URL…', 'Open another URL…']) {
      await expect(painel.getByRole('menuitem', { name: acao, exact: true })).toBeVisible();
    }
    await expect(painel).toContainText('Kept only in this browser.');
    await expect(painel.getByRole('searchbox', { name: 'Find a URL' })).toHaveCount(0);
    await expect(painel.getByRole('menuitem', { name: /Delete/ })).toHaveCount(0);
  });

  test('deve abrir a outra URL no mesmo destino, entrar no histórico e anunciar a troca uma vez', async ({
    page,
    tokens,
  }) => {
    const a = await tokens.create();
    const b = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await page.goto(`/#/${a}`);
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(a)}. Switch URL`);
    await page.goto(`/#/${b}/rules`);
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    const painel = await abrirSeletor(page);
    await limparAnuncios(page);

    await urlNoSeletor(painel, a).click();

    await expect(page).toHaveURL(new RegExp(`#/${a}/rules$`));
    await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
      new RegExp(`/${a}$`),
    );
    await expect(destino(page, 'Rules')).toHaveAttribute('aria-current', 'page');
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(a)}. Switch URL`);
    await expectUmAnuncio(page, new RegExp(`^URL ${id5(a)} opened\\.`));

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`#/${b}/rules$`));
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(b)}. Switch URL`);
  });

  test('deve falar só a URL aberta na Entrada, sem o estado da conexão, e anunciar também a volta pelo navegador', async ({
    page,
    tokens,
  }) => {
    const a = await tokens.create();
    const b = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, { [CHAVE_URLS]: listaDeUrls([{ uuid: a }, { uuid: b }]) });
    await page.goto(`/#/${a}`);
    await expect(estadoAoVivo(page)).toContainText('Live');
    const painel = await abrirSeletor(page);
    await limparAnuncios(page);

    await urlNoSeletor(painel, b).click();

    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(b)}. Switch URL`);
    await expect(estadoAoVivo(page)).toContainText('Live');
    await expectSoEstaFala(page, new RegExp(`^URL ${id5(b)} opened\\. Inbox, 0 requests\\.$`));
    await limparAnuncios(page);

    await page.goBack();

    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(a)}. Switch URL`);
    await expect(estadoAoVivo(page)).toContainText('Live');
    await expectSoEstaFala(page, new RegExp(`^URL ${id5(a)} opened\\. Inbox, 0 requests\\.$`));
  });

  test('deve guardar o apelido só no navegador, usá-lo no botão e no título, e anunciar uma vez', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 0);
    const escritas: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/token')) {
        escritas.push(`${r.method()} ${r.url()}`);
      }
    });

    const painel = await abrirSeletor(page);
    await painel.getByRole('menuitem', { name: 'Rename this URL…', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Rename this URL' });
    const apelido = dialogo.getByRole('textbox', { name: 'Nickname' });
    await expect(apelido).toHaveAttribute('maxlength', '40');
    await expect(dialogo).toContainText('Only you see it, in this browser.');
    await apelido.fill('Pagamentos');
    await limparAnuncios(page);
    await dialogo.getByRole('button', { name: 'Save nickname' }).click();

    await expect(dialogo).toBeHidden();
    await expect(seletor(page)).toHaveAccessibleName('Pagamentos. Switch URL');
    await expect(seletor(page)).toContainText('Pagamentos');
    await expectUmAnuncio(page, /^Nickname saved\.$/);
    await expect(page).toHaveTitle('Inbox · Pagamentos · Anzol');
    expect(await urlsConhecidas(page)).toEqual([
      expect.objectContaining({ uuid: tokenId, nickname: 'Pagamentos' }),
    ]);
    expect(escritas, 'o apelido não vai ao servidor').toEqual([]);

    await page.reload();
    await expect(seletor(page)).toHaveAccessibleName('Pagamentos. Switch URL');
    await (
      await abrirSeletor(page)
    )
      .getByRole('menuitem', { name: 'Rename this URL…', exact: true })
      .click();
    await page.getByRole('dialog', { name: 'Rename this URL' }).getByRole('textbox').fill('');
    await page.getByRole('button', { name: 'Save nickname' }).click();
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(tokenId)}. Switch URL`);
  });

  test('deve esquecer uma URL sem apagá-la no servidor', async ({ page, request, tokens }) => {
    const a = await tokens.create();
    const b = await tokens.create();
    await seedStorage(page, {
      [CHAVE_URLS]: listaDeUrls([{ uuid: b }, { uuid: a, nickname: 'Antiga' }]),
    });
    await abrirEntrada(page, b, 0);

    const painel = await abrirSeletor(page);
    await painel.getByRole('menuitem', { name: 'Forget a URL…', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Forget a URL' });
    await expect(dialogo).toContainText('Forgetting does not delete the URL on the server.');
    await expect(dialogo.getByRole('checkbox')).toHaveCount(2);
    await dialogo.getByRole('checkbox', { name: /Antiga/ }).check();
    await dialogo.getByRole('button', { name: 'Forget', exact: true }).click();

    await expect(dialogo).toBeHidden();
    expect((await urlsConhecidas(page)).map((u) => u.uuid)).toEqual([b]);
    await expect((await abrirSeletor(page)).getByRole('menuitemradio')).toHaveCount(1);
    expect((await request.get(`/token/${a}`)).status()).toBe(200);
  });

  test('deve abrir pelo "Open another URL…" a URL do endereço colado, no mesmo destino, e recusar o texto sem id', async ({
    page,
    tokens,
  }) => {
    const a = await tokens.create();
    const b = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await page.goto(`/#/${a}/rules`);
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();

    const painel = await abrirSeletor(page);
    await painel.getByRole('menuitem', { name: 'Open another URL…', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Open another URL' });
    const endereco = dialogo.getByRole('textbox', { name: 'Address or id' });
    await expect(endereco).toBeFocused();
    await expect(dialogo).toContainText('Paste the address of an Anzol URL, or just its id.');

    await endereco.fill('http://localhost:3000/pedidos');
    await limparAnuncios(page);
    await dialogo.getByRole('button', { name: 'Open URL', exact: true }).click();
    await expect(endereco).toHaveAttribute('aria-invalid', 'true');
    await expect(dialogo).toContainText('This address is not a valid URL id.');
    await expectUmAnuncio(page, /^This address is not a valid URL id\.$/);

    await endereco.fill(`${new URL(page.url()).origin}/${b}/pedidos?x=1`);
    await limparAnuncios(page);
    await endereco.press('Enter');

    await expect(dialogo).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`#/${b}/rules$`));
    await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
      new RegExp(`/${b}$`),
    );
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(b)}. Switch URL`);
    await expectUmAnuncio(page, new RegExp(`^URL ${id5(b)} opened\\.`));
    expect((await urlsConhecidas(page)).map((u) => u.uuid)).toEqual([b, a]);
  });

  test('deve mostrar a página de URL inexistente Quando o id dado em "Open another URL…" não existe', async ({
    page,
    tokens,
  }) => {
    const a = await tokens.create();
    const sumida = urlInexistente();
    await seedStorage(page, {});
    await abrirEntrada(page, a, 0);

    const painel = await abrirSeletor(page);
    await painel.getByRole('menuitem', { name: 'Open another URL…', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Open another URL' });
    await dialogo.getByRole('textbox', { name: 'Address or id' }).fill(sumida);
    await dialogo.getByRole('button', { name: 'Open URL', exact: true }).click();

    await expect(
      page.getByRole('heading', { name: 'This URL no longer exists', level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/${sumida}$`));
  });

  test('deve oferecer a busca "Find a URL" a partir de 8 URLs, por apelido e por início do UUID', async ({
    page,
    tokens,
  }) => {
    const aberta = await tokens.create();
    const outras = Array.from({ length: 7 }, (_, i) => ({
      uuid: urlInexistente(),
      nickname: i === 3 ? 'Notificações' : `Loja ${i}`,
    }));
    await seedStorage(page, { [CHAVE_URLS]: listaDeUrls([{ uuid: aberta }, ...outras]) });
    await abrirEntrada(page, aberta, 0);

    const painel = await abrirSeletor(page);
    const achar = painel.getByRole('searchbox', { name: 'Find a URL' });
    await expect(painel.getByRole('menuitemradio')).toHaveCount(8);

    await achar.fill('notif');
    await expect(painel.getByRole('menuitemradio')).toHaveCount(1);
    await expect(urlNoSeletor(painel, outras[3].uuid)).toHaveAccessibleName(/^Notificações, /);

    await achar.fill(outras[5].uuid.substring(0, 6));
    await expect(painel.getByRole('menuitemradio')).toHaveCount(1);
    await expect(urlNoSeletor(painel, outras[5].uuid)).toBeVisible();
  });

  test('deve pôr na lista a URL que o navegador já guardava (migração) e esquecer todas em Settings', async ({
    page,
    tokens,
  }) => {
    const guardada = await tokens.create();
    await seedStorage(page, { token: JSON.stringify({ uuid: guardada }) });
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`#/${guardada}$`));

    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(guardada)}. Switch URL`);
    await expect
      .poll(async () => (await urlsConhecidas(page)).map((u) => u.uuid))
      .toEqual([guardada]);

    const outra = await tokens.create();
    await page.goto(`/#/${outra}`);
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(outra)}. Switch URL`);
    await (await acaoDoShell(page, 'Settings')).click();
    await page.getByRole('button', { name: 'Forget all URLs' }).click();
    await expect
      .poll(async () => (await urlsConhecidas(page)).map((u) => u.uuid))
      .not.toContain(guardada);
  });

  test('deve abrir pela tecla U e devolver o foco ao botão com Esc', async ({ page, tokens }) => {
    test.skip(compacto(page), 'teclado: só no desktop');
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 0);

    const menu = page.getByRole('menu', { name: 'URLs in this browser' });
    // O U só vale depois do GET /token/{id}, que com o servidor frio chega depois da lista.
    await expect(async () => {
      await page.keyboard.press('u');
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(seletor(page)).toBeFocused();
  });

  test('deve abrir como folha com "Close" no celular', async ({ page, tokens }) => {
    test.skip(!compacto(page), 'só no celular');
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 0);

    await seletor(page).click();

    const folha = page.getByRole('dialog', { name: 'URLs in this browser' });
    await expect(folha.getByRole('menuitemradio')).toHaveCount(1);
    await folha.getByRole('button', { name: 'Close' }).click();
    await expect(folha).toBeHidden();
  });
});

test.describe('Dado "Delete URL" com e sem outra URL conhecida', () => {
  async function apagarAUrl(page: Page): Promise<void> {
    await (
      compacto(page)
        ? page.getByRole('button', { name: 'More actions', exact: true })
        : page.getByRole('button', { name: 'More URL actions' })
    ).click();
    await page.getByRole('menuitem', { name: 'Delete URL' }).click();
    await page
      .getByRole('dialog', { name: 'Delete this URL?' })
      .getByRole('button', { name: 'Delete URL' })
      .click();
  }

  test('deve abrir a próxima URL conhecida do seletor, sem criar outra', async ({
    page,
    request,
    tokens,
  }) => {
    const outra = await tokens.create();
    const apagada = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${outra}`);
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(outra)}. Switch URL`);
    await page.goto(`/#/${apagada}`);
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(apagada)}. Switch URL`);
    const criadas: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/token') {
        criadas.push(r.url());
      }
    });

    await apagarAUrl(page);

    await expect(page).toHaveURL(new RegExp(`#/${outra}$`));
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(outra)}. Switch URL`);
    expect((await request.get(`/token/${apagada}`)).status()).not.toBe(200);
    expect((await urlsConhecidas(page)).map((u) => u.uuid)).toEqual([outra]);
    expect(criadas, 'nenhuma URL criada: havia outra conhecida').toEqual([]);
  });

  test('deve criar uma URL, como na primeira visita, Quando não há outra conhecida', async ({
    page,
    request,
    tokens,
  }) => {
    const apagada = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${apagada}`);
    await expect(seletor(page)).toHaveAccessibleName(`URL ${id5(apagada)}. Switch URL`);

    await apagarAUrl(page);

    await expect(page).not.toHaveURL(new RegExp(apagada));
    await expect(page).toHaveURL(/#\/[0-9a-f-]{36}$/);
    const nova = /#\/([0-9a-f-]{36})/.exec(page.url())![1];
    tokens.track(nova);
    expect((await request.get(`/token/${nova}`)).status()).toBe(200);
    expect((await urlsConhecidas(page)).map((u) => u.uuid)).toEqual([nova]);
  });
});

test.describe('Dado os filtros da Entrada numa linha', () => {
  async function tres(tokens: {
    create(): Promise<string>;
    send: (t: string, w: object) => Promise<string>;
  }) {
    const tokenId = await tokens.create();
    // A busca olha também a URL gravada, que leva o id: "/a" casaria todas quando o id começa com "a".
    const a = await tokens.send(tokenId, { method: 'POST', path: '/alfa', data: 'a' });
    const b = await tokens.send(tokenId, { method: 'GET', path: '/b' });
    const c = await tokens.send(tokenId, { method: 'POST', path: '/c', data: 'c' });
    return { tokenId, a, b, c };
  }

  test('deve esconder os chips atrás de "Filters" e mostrá-los em quatro subgrupos, sem "More filters"', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await tres(tokens);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 3);
    const botao = botaoDeFiltros(page);
    const grupo = page.getByRole('toolbar', { name: 'Filters' });

    await expect(botao).toHaveAccessibleName('Filters');
    await expect(botao).toHaveAttribute('aria-expanded', 'false');
    await expect(grupo).toBeHidden();
    await expect(filtrosLigados(page)).toHaveCount(0);
    await expect(busca(page).getByText(/requests? match/)).toHaveCount(0);
    const antes = compacto(page) ? null : await itens(page).first().boundingBox();

    await botao.click();

    await expect(botao).toHaveAttribute('aria-expanded', 'true');
    const controla = await botao.getAttribute('aria-controls');
    expect(controla, 'aria-controls aponta para o painel').toBeTruthy();
    await expect(page.locator(`[id="${controla}"]`)).toBeVisible();
    for (const [subgrupo, chips] of Object.entries(CHIPS)) {
      await expect(grupo.getByText(subgrupo, { exact: true })).toBeVisible();
      for (const chip of chips) {
        await expect(filtro(page, chip)).toBeVisible();
        await expect(filtro(page, chip)).toHaveAttribute('aria-pressed', 'false');
      }
    }
    await expect(page.getByRole('button', { name: 'More filters' })).toHaveCount(0);
    if (antes) {
      // No desktop o painel empurra a lista: não a cobre.
      const painel = (await grupo.boundingBox())!;
      const depois = (await itens(page).first().boundingBox())!;
      expect(depois.y).toBeGreaterThan(antes.y);
      expect(depois.y).toBeGreaterThanOrEqual(painel.y + painel.height - 1);
    }
  });

  test('deve contar os filtros no botão, listá-los em "Active filters" e tirar um por vez', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await tres(tokens);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 3);

    await abrirFiltros(page);
    await filtro(page, 'POST').click();
    await expect(filtro(page, 'POST')).toHaveAttribute('aria-pressed', 'true');
    await filtro(page, 'Default response').click();

    await expect(botaoDeFiltros(page)).toHaveAccessibleName('Filters, 2 active');
    await expect(botaoDeFiltros(page)).toContainText('Filters · 2');
    await verResultado(page);
    const ligados = filtrosLigados(page);
    await expect(ligados).toContainText('POST');
    await expect(ligados).toContainText('Default response');
    await expect(itens(page)).toHaveCount(2);
    await expect(busca(page).getByRole('status').filter({ hasText: /match/ })).toContainText(
      /^2 requests match/,
    );
    await expect(page).toHaveURL(/[?&]methods=POST\b/);

    await ligados.getByRole('button', { name: 'Remove this filter: Default response' }).click();
    await expect(botaoDeFiltros(page)).toHaveAccessibleName('Filters, 1 active');
    // Patamar, F1 (guia §3.6): o chip ligado diz o filtro por extenso, como as condições de Regras ("method POST").
    await ligados.getByRole('button', { name: 'Remove this filter: method POST' }).click();

    await expect(filtrosLigados(page)).toHaveCount(0);
    await expect(botaoDeFiltros(page)).toHaveAccessibleName('Filters');
    await expect(itens(page)).toHaveCount(3);
  });

  test('não deve trocar a requisição aberta ao filtrar: avisa que ela está fora do filtro e oferece a primeira', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'lista e detalhe lado a lado: só no desktop');
    const { tokenId, b, c } = await tres(tokens);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/${b}/1`);
    await expect(detalhes(page)).toContainText(b);

    await abrirFiltros(page);
    await filtro(page, 'POST').click();
    await expect(itens(page)).toHaveCount(2);

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${b}/1`));
    await expect(detalhes(page)).toContainText(b);
    const detalhe = page.getByRole('region', { name: 'Request detail' });
    await expect(detalhe).toContainText('This request is not in the current filter.');
    await detalhe.getByRole('button', { name: 'Open the first result' }).click();
    await expect(detalhes(page)).toContainText(c);
  });

  test('deve anunciar só o resultado, uma vez, e nada a cada tecla', async ({ page, tokens }) => {
    const { tokenId } = await tres(tokens);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 3);
    await abrirFiltros(page);
    await limparAnuncios(page);

    await filtro(page, 'POST').click();
    await expectUmAnuncio(page, /^2 requests match/);
    await expectSemAnuncio(page, /Searching|Buscando/);

    await limparAnuncios(page);
    await filtro(page, 'POST').click();
    await expectUmAnuncio(page, /^No filter\. 3 requests\.$/);
    await filtro(page, 'POST').click();
    await expect(filtro(page, 'POST')).toHaveAttribute('aria-pressed', 'true');
    await expectUmAnuncio(page, /2 requests match/);

    await verResultado(page);
    await limparAnuncios(page);
    await campoDeBusca(page).pressSequentially('/alfa', { delay: 80 });
    await expectUmAnuncio(page, /requests? match/);
    await expect(itens(page)).toHaveCount(1);

    await limparAnuncios(page);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expectUmAnuncio(page, /^Filters cleared\. 3 requests\.$/);
  });

  test('deve abrir e fechar pela tecla F, andar nos chips com as setas e ser uma parada só do Tab', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'teclado: só no desktop');
    const { tokenId } = await tres(tokens);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 3);
    const grupo = page.getByRole('toolbar', { name: 'Filters' });

    await page.keyboard.press('f');
    await expect(grupo).toBeVisible();
    await expect(filtro(page, 'POST')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(filtro(page, 'GET')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(filtro(page, 'GET')).toHaveAttribute('aria-pressed', 'true');
    const paradas = await grupo
      .getByRole('button')
      .evaluateAll((chips) => chips.filter((c) => (c as HTMLElement).tabIndex >= 0).length);
    expect(paradas, 'roving tabindex: uma parada de Tab').toBe(1);

    await page.keyboard.press('Escape');
    await expect(grupo).toBeHidden();
    await expect(botaoDeFiltros(page)).toBeFocused();
  });

  test('deve manter "Copy as anzol wait-for" à vista sem filtro, na linha do cabeçalho da lista', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'no celular a linha do cabeçalho não leva o wait-for (wireframe)');
    const { tokenId } = await tres(tokens);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 3);

    const copiar = lista(page).getByRole('button', { name: 'Copy as anzol wait-for' });
    await expect(copiar).toBeVisible();
    await expect(copiar).toHaveAttribute('title', /\S/);
    await expect(busca(page).getByRole('button', { name: 'Copy as anzol wait-for' })).toHaveCount(
      0,
    );
    const cabecalho = (await page.getByRole('switch', { name: 'Follow new' }).boundingBox())!;
    const botao = (await copiar.boundingBox())!;
    expect(
      Math.abs(botao.y + botao.height / 2 - (cabecalho.y + cabecalho.height / 2)),
    ).toBeLessThan(16);
  });
});

test.describe('Dado a lista densa', () => {
  test.describe('a 1440×900 em pt-BR', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('deve mostrar 9 requisições inteiras ou mais na primeira tela, sem filtro', async ({
      page,
      tokens,
    }, testInfo) => {
      test.skip(!!testInfo.project.use.isMobile, 'medida do desktop');
      const tokenId = await tokens.create();
      await tokens.sendMany(tokenId, 14);
      await seedStorage(page, { language: '"pt-BR"' });

      await page.goto(`/#/${tokenId}`);
      await expect(page.getByRole('heading', { name: 'Requisições (14)' })).toBeVisible();
      await expect(page.locator('.item').first()).toBeVisible();

      await expect.poll(() => itensInteirosNaTela(page)).toBeGreaterThanOrEqual(9);
    });

    test('deve quebrar o cabeçalho da lista em duas linhas só com a janela das mais novas, e ainda mostrar 9 inteiras', async ({
      page,
      tokens,
    }, testInfo) => {
      test.skip(!!testInfo.project.use.isMobile, 'medida do desktop');
      const tokenId = await tokens.create();
      await tokens.sendMany(tokenId, 60);
      await seedStorage(page, { language: '"pt-BR"' });
      const altura = async () =>
        (await page.locator('app-request-list .head').boundingBox())?.height ?? 0;

      await page.goto(`/#/${tokenId}`);
      await expect(page.getByRole('heading', { name: 'Requisições (60)' })).toBeVisible();
      const semFiltro = await altura();

      await page.goto(`/#/${tokenId}?methods=POST`);
      await expect(page.getByRole('heading', { name: 'Requisições (60 de 60)' })).toBeVisible();
      expect(await altura(), 'com filtro do servidor, uma linha').toBe(semFiltro);

      await page.goto(`/#/${tokenId}?methods=POST&window=50`);
      await expect(
        page.getByRole('heading', { name: 'Requisições (50 das 50 mais novas)' }),
      ).toBeVisible();
      expect(await altura(), 'com a janela, no máximo duas linhas').toBeLessThanOrEqual(
        2 * semFiltro,
      );
      await expect.poll(() => itensInteirosNaTela(page)).toBeGreaterThanOrEqual(9);
    });

    test('deve mostrar 9 requisições inteiras ou mais na densidade compacta de Settings', async ({
      page,
      tokens,
    }, testInfo) => {
      test.skip(!!testInfo.project.use.isMobile, 'medida do desktop');
      const tokenId = await tokens.create();
      await tokens.sendMany(tokenId, 14);
      await seedStorage(page, { language: '"pt-BR"', density: '"compact"' });

      await page.goto(`/#/${tokenId}`);
      await expect(page.getByRole('heading', { name: 'Requisições (14)' })).toBeVisible();
      await expect(page.locator('.item').first()).toBeVisible();

      await expect(page.locator('html')).toHaveClass(/\bcompact\b/);
      await expect.poll(() => itensInteirosNaTela(page)).toBeGreaterThanOrEqual(9);
    });

    test('deve mostrar 6 letras ou mais do nome de quem respondeu e do tipo do evento, com o #id inteiro, Quando cabem os dois', async ({
      page,
      tokens,
    }, testInfo) => {
      test.skip(!!testInfo.project.use.isMobile, 'medida do desktop');
      const { tokenId, id } = await comTipoDeEvento(tokens);
      await seedStorage(page, {});
      await abrirEntrada(page, tokenId, 1);
      await page.evaluate(() => document.fonts.ready);

      const linha = await segundaLinha(item(page, id));

      expect(linha.selo, 'letras do nome de quem respondeu à vista').toBeGreaterThanOrEqual(6);
      expect(linha.tipo, 'letras do tipo do evento à vista').toBeGreaterThanOrEqual(6);
      expect(linha.idInteiro, 'o #id inteiro').toBe(true);
    });

    test('deve tirar o tipo do evento da linha, com os selos de erro e o #id inteiros, Quando não cabem os dois', async ({
      page,
      tokens,
    }, testInfo) => {
      test.skip(!!testInfo.project.use.isMobile, 'medida do desktop');
      const { tokenId, id } = await comTipoDeEvento(tokens, {
        type: 'object',
        required: ['id'],
      });
      await seedStorage(page, {});
      await abrirEntrada(page, tokenId, 1);
      await page.evaluate(() => document.fonts.ready);
      await expect(item(page, id)).toContainText('1 schema error');

      const linha = await segundaLinha(item(page, id));

      expect(linha.tipo, 'letras do tipo do evento à vista').toBe(0);
      expect(linha.selosInteiros, 'os selos de erro inteiros').toBe(true);
      expect(linha.idInteiro, 'o #id inteiro').toBe(true);
    });
  });

  test('deve mostrar 6 letras ou mais do nome de quem respondeu, e o tipo do evento legível ou fora da linha, também a 390 px', async ({
    page,
    tokens,
  }, testInfo) => {
    test.skip(!testInfo.project.use.isMobile, 'medida do celular');
    const { tokenId, id } = await comTipoDeEvento(tokens);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 1);
    await page.evaluate(() => document.fonts.ready);

    const linha = await segundaLinha(item(page, id));

    expect(linha.selo, 'letras do nome de quem respondeu à vista').toBeGreaterThanOrEqual(6);
    expect(
      linha.tipo === 0 || linha.tipo >= 6,
      `letras do tipo do evento à vista: ${linha.tipo}`,
    ).toBe(true);
    expect(linha.idInteiro, 'o #id inteiro').toBe(true);
  });

  test('deve ter item de 36 px na densidade compacta (64 no celular, nas duas densidades)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, { data: 'x' });
    await seedStorage(page, { density: '"compact"' });
    await abrirEntrada(page, tokenId, 1);

    const altura = (await item(page, id).boundingBox())!.height;
    const esperada = compacto(page) ? 64 : 36;
    expect(
      Math.abs(altura - esperada),
      `item de ${esperada} px, tem ${altura}`,
    ).toBeLessThanOrEqual(1);
  });

  test('deve ter item de duas linhas e 40 px na densidade confortável (64 no celular), com hora e #id, sem IP nem agente na linha', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const caminho = '/pedidos/2026/09/loja-centro/confirmacoes/instantaneas/pagamento-aprovado';
    const id = await tokens.send(tokenId, {
      path: caminho,
      headers: { 'User-Agent': 'agente-de-teste/1.0' },
      data: 'x',
    });
    const { ip } = (await (await request.get(`/token/${tokenId}/request/${id}`)).json()) as {
      ip: string;
    };
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 1);
    const linha = item(page, id);

    const altura = (await linha.boundingBox())!.height;
    const esperada = compacto(page) ? 64 : 40;
    expect(
      Math.abs(altura - esperada),
      `item de ${esperada} px, tem ${altura}`,
    ).toBeLessThanOrEqual(1);
    const quando = linha.getByText(/^\s*(a few seconds ago|\d+ s ago|just now|a minute ago)\s*$/);
    await expect(quando).toBeVisible();
    await expect(quando).toHaveAttribute('title', /\b\d{1,2}:\d{2}\b/);
    await expect(linha).toContainText(`#${id5(id)}`);
    await expect(linha).not.toContainText(ip);
    await expect(linha).not.toContainText('agente-de-teste/1.0');
    await expect(abrirItem(page, id)).toHaveAccessibleName(
      new RegExp(`^POST ${caminho}, #${id5(id)}, from ${ip.replace(/\./g, '\\.')}, `),
    );
    await expect(linha.locator(`[title="${caminho}"]`)).toHaveCount(1);
  });

  test('deve pôr a pílula de novas acima da lista, sem cobrir item nenhum', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'lista e detalhe lado a lado: só no desktop');
    const tokenId = await tokens.create();
    const aberta = await tokens.send(tokenId, { path: '/aberta' });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/${aberta}/1`);
    await expect(detalhes(page)).toContainText(aberta);
    await expect(estadoAoVivo(page)).toContainText('Live');

    await tokens.send(tokenId, { path: '/nova' });

    const pilula = page.getByRole('button', { name: /\b1 new request\b/ });
    await expect(pilula).toBeVisible();
    const caixa = (await pilula.boundingBox())!;
    const primeiro = (await itens(page).first().boundingBox())!;
    expect(caixa.y + caixa.height, 'a pílula acaba antes do primeiro item').toBeLessThanOrEqual(
      primeiro.y + 1,
    );
  });

  test('deve andar na lista com as setas sem abrir, e abrir com Enter levando o foco ao detalhe', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'teclado: só no desktop');
    const tokenId = await tokens.create();
    const velha = await tokens.send(tokenId, { path: '/velha' });
    const nova = await tokens.send(tokenId, { path: '/nova' });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/${nova}/1`);
    await expect(detalhes(page)).toContainText(nova);

    await abrirItem(page, nova).focus();
    await page.keyboard.press('ArrowDown');

    await expect(abrirItem(page, velha)).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${nova}/1`));
    await expect(detalhes(page)).toContainText(nova);
    const paradas = await itens(page)
      .getByRole('button', { name: /#[0-9a-f]{5}/ })
      .evaluateAll((botoes) => botoes.filter((b) => (b as HTMLElement).tabIndex >= 0).length);
    expect(paradas, 'a lista é uma parada de Tab').toBe(1);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${velha}/1`));
    await expect(
      page.getByRole('region', { name: 'Request detail' }).getByRole('heading', { name: '/velha' }),
    ).toBeFocused();
  });
});

test.describe('Dado uma URL que não existe', () => {
  const rotas: [string, string][] = [
    ...ROTAS,
    ['Compare', `/compare/${urlInexistente()}/${urlInexistente()}`],
  ];
  for (const [nome, rota] of rotas) {
    test(`deve mostrar a página única em ${nome}, com o endereço pedido, e não criar URL`, async ({
      page,
    }) => {
      const falta = urlInexistente();
      const criadas: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === '/token') {
          criadas.push(r.url());
        }
      });
      await seedStorage(page, {});

      await page.goto(`/#/${falta}${rota}`);

      const principal = page.getByRole('main');
      await expect(
        principal.getByRole('heading', { name: 'This URL no longer exists', level: 1 }),
      ).toBeVisible();
      await expect(principal).toContainText(
        'It was deleted, or it expired after 7 days without use.',
      );
      await expect(principal).toContainText('Whoever sends to it gets 410 Gone.');
      await expect(principal.getByRole('button', { name: 'Create a new URL' })).toBeVisible();
      expect(page.url().endsWith(`/#/${falta}${rota}`)).toBe(true);
      await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
        new RegExp(`/${falta}$`),
      );
      await expect(page.getByText('deleted', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy', exact: true })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      for (const d of DESTINOS) {
        await expect(destino(page, d)).toHaveAttribute('aria-disabled', 'true');
        await expect(destino(page, d)).toHaveAttribute('aria-describedby', /\S/);
      }
      await expect(seletor(page)).toBeEnabled();
      await expect(page).toHaveTitle('URL not found · Anzol');
      expect(criadas, 'nenhuma URL criada sem a pessoa pedir').toEqual([]);
    });
  }

  test('deve criar a URL nova só quando "Create a new URL" é clicado', async ({
    page,
    request,
    tokens,
  }) => {
    const falta = urlInexistente();
    await seedStorage(page, {});
    await page.goto(`/#/${falta}/checks`);

    await page.getByRole('button', { name: 'Create a new URL' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Create New URL' });
    if (await dialogo.isVisible().catch(() => false)) {
      await dialogo.getByRole('button', { name: 'Create', exact: true }).click();
    }

    await expect(page).not.toHaveURL(new RegExp(falta));
    await expect(page).toHaveURL(/#\/[0-9a-f-]{36}/);
    const nova = /#\/([0-9a-f-]{36})/.exec(page.url())![1];
    tokens.track(nova);
    expect((await request.get(`/token/${nova}`)).status()).toBe(200);
  });

  test('deve oferecer "Switch to another URL" só com outra na lista, e tirar a inexistente do navegador', async ({
    page,
    tokens,
  }) => {
    const falta = urlInexistente();
    const outra = await tokens.create();
    await seedStorage(page, { [CHAVE_URLS]: listaDeUrls([{ uuid: falta }, { uuid: outra }]) });
    await page.goto(`/#/${falta}`);
    await expect(
      page.getByRole('heading', { name: 'This URL no longer exists', level: 1 }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Switch to another URL' }).click();
    const painel = page
      .getByRole('menu', { name: 'URLs in this browser' })
      .or(page.getByRole('dialog', { name: 'URLs in this browser' }));
    await expect(urlNoSeletor(painel, outra)).toBeVisible();
    await expect(urlNoSeletor(painel, falta)).toHaveAccessibleName(/, deleted$/);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Remove from this browser' }).click();
    await expect.poll(async () => (await urlsConhecidas(page)).map((u) => u.uuid)).toEqual([outra]);
  });

  test('não deve oferecer "Switch to another URL" sem outra URL na lista', async ({ page }) => {
    const falta = urlInexistente();
    await seedStorage(page, {});
    await page.goto(`/#/${falta}`);

    await expect(page.getByRole('button', { name: 'Create a new URL' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch to another URL' })).toHaveCount(0);
  });

  test('deve dizer que o endereço não é um identificador válido', async ({ page }) => {
    await seedStorage(page, {});
    await page.goto('/#/12345/rules');

    await expect(page.getByRole('main')).toContainText('This address is not a valid URL id.');
    await expect(page.getByRole('button', { name: 'Create a new URL' })).toBeVisible();
    await expect(page).toHaveTitle('URL not found · Anzol');
  });
});

test.describe('Dado a faixa "sem conexão"', () => {
  test('deve existir vazia desde a carga, em todos os destinos', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    for (const [nome, rota] of ROTAS) {
      await page.goto(`/#/${tokenId}${rota}`);
      await expect(destino(page, nome)).toHaveAttribute('aria-current', 'page');
      await expect(conexao(page), nome).toBeAttached();
      await expect(conexao(page), nome).toHaveText('');
    }
  });

  test('deve avisar a queda uma vez, guardar o que foi digitado e avisar a volta', async ({
    page,
    context,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/antes' });
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 1);
    await expect(estadoAoVivo(page)).toContainText('Live');
    await limparAnuncios(page);

    await context.setOffline(true);
    await campoDeBusca(page).fill('antes');

    await expect(conexao(page)).toContainText(
      /No connection to the server since \d{1,2}:\d{2}.*\. What you typed is kept\./,
    );
    const tentar = page.getByRole('button', { name: 'Try again now' });
    await expect(tentar).toBeVisible();
    await expectUmAnuncio(page, /^No connection to the server since/, /^Connection$/);
    await expectSemAnuncio(page, /Trying again in/);
    const contagem = page.getByText(/Trying again in \d+ s/);
    if ((await contagem.count()) > 0) {
      expect(
        await contagem.first().evaluate((el) => !!el.closest('[aria-hidden="true"]')),
        'a contagem regressiva fica fora da região viva',
      ).toBe(true);
    }
    await expect(conexao(page)).not.toContainText(/docker|ANZOL_|compose/i);
    await expect(campoDeBusca(page)).toHaveValue('antes');

    await limparAnuncios(page);
    await context.setOffline(false);
    await tentar.click();

    await expectUmAnuncio(page, /^Connected again\.$/, /^Connection$/);
    await expect(conexao(page)).toHaveText('', { timeout: 10_000 });
    await expect(estadoAoVivo(page)).toContainText('Live');
  });

  test('deve juntar na pílula o que chegou durante a queda, sem trocar a requisição aberta', async ({
    page,
    context,
    tokens,
  }) => {
    test.skip(compacto(page), 'lista e detalhe lado a lado: só no desktop');
    const tokenId = await tokens.create();
    const aberta = await tokens.send(tokenId, { path: '/aberta' });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/${aberta}/1`);
    await expect(detalhes(page)).toContainText(aberta);
    await expect(estadoAoVivo(page)).toContainText('Live');

    await context.setOffline(true);
    await campoDeBusca(page).fill('x');
    await expect(page.getByRole('button', { name: 'Try again now' })).toBeVisible();
    // A chegada vem depois de a busca vazia valer: com o "x" ainda ligado, ela só conta, e não vai à pílula.
    const semFiltro = page.waitForEvent('requestfailed', (pedido) =>
      pedido.url().includes('/requests?page=1'),
    );
    await campoDeBusca(page).fill('');
    await semFiltro;
    await tokens.send(tokenId, { path: '/na-queda' });
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Try again now' }).click();

    await expect(page.getByRole('button', { name: /\b1 new request\b/ })).toBeVisible();
    await expect(detalhes(page)).toContainText(aberta);
  });

  test('deve trocar o destino no rail e mostrar "Could not open Rules" Quando o pedaço da tela não carrega', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 0);
    await page.route(/\.js(\?.*)?$/, (rota) => rota.abort());

    await destino(page, 'Rules').click();

    const principal = page.getByRole('main');
    await expect(principal).toContainText('Could not open Rules');
    await expect(principal).toContainText('The server did not answer. Nothing was changed.');
    await expect(principal.getByRole('link', { name: 'Back to the Inbox' })).toBeVisible();
    await expect(destino(page, 'Rules')).toHaveAttribute('aria-current', 'page');

    await page.unroute(/\.js(\?.*)?$/);
    await principal.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
  });
});

test.describe('Dado o título da aba e os marcos de cada destino', () => {
  test('deve dizer o destino e a URL no título da aba', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    for (const [nome, rota] of ROTAS) {
      await page.goto(`/#/${tokenId}${rota}`);
      await expect(page, nome).toHaveTitle(`${nome} · URL ${id5(tokenId)} · Anzol`);
    }
  });

  test('deve dizer "Locked" na tela de destrancar e "Shared request" no link só-leitura', async ({
    page,
    request,
    tokens,
  }) => {
    const trancada = await tokens.create({ read_secret: 'segredo-do-patamar' });
    await seedStorage(page, {});
    await page.goto(`/#/${trancada}`);
    await expect(page.getByRole('heading', { name: 'This URL is protected' })).toBeVisible();
    await expect(page).toHaveTitle('Locked · Anzol');

    const aberta = await tokens.create();
    const id = await tokens.send(aberta, { data: 'compartilhada' });
    const link = await request.post(`/token/${aberta}/request/${id}/share`, { data: {} });
    const { id: compartilhado } = (await link.json()) as { id: string };
    await page.goto(`/#/share/${compartilhado}`);
    await expect(page.getByText(/Shared read-only link/)).toBeVisible();
    await expect(page).toHaveTitle('Shared request · Anzol');
  });

  test('deve ter um h1 e um main com nome em cada destino', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    for (const [nome, rota] of ROTAS) {
      await page.goto(`/#/${tokenId}${rota}`);
      await expect(page.getByRole('heading', { level: 1 }), nome).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 }), nome).toHaveAccessibleName(nome);
      await expect(page.getByRole('main'), nome).toHaveCount(1);
      await expect(page.getByRole('main'), nome).toHaveAccessibleName(/\S/);
    }
  });

  test('deve começar pelo "Skip to content", que leva o foco ao conteúdo', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'teclado: só no desktop');
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 0);

    await page.keyboard.press('Tab');
    const pular = page.getByRole('link', { name: 'Skip to content' });
    await expect(pular).toBeFocused();
    await expect(pular).toBeInViewport();
    await page.keyboard.press('Enter');

    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('main, [role="main"]')))
      .toBe(true);
  });
});

test.describe('Dado o rail e o cabeçalho da URL em todos os destinos', () => {
  test('deve mostrar "Live", o contador e "Search requests" no mesmo lugar em todo destino', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'rail: só no desktop');
    const tokenId = await tokens.create();
    await tokens.send(tokenId);
    await tokens.send(tokenId);
    await seedStorage(page, {});
    const lugares: number[] = [];
    for (const [nome, rota] of ROTAS) {
      await page.goto(`/#/${tokenId}${rota}`);
      await expect(destino(page, nome)).toHaveAttribute('aria-current', 'page');
      await expect(estadoAoVivo(page), nome).toContainText('Live');
      await expect(page.getByRole('link', { name: '2 requests', exact: true }), nome).toBeVisible();
      await expect(page.getByRole('button', { name: 'Search requests' }), nome).toBeVisible();
      lugares.push(Math.round((await destino(page, 'Inbox').boundingBox())!.y));
    }
    expect(new Set(lugares).size, `o rail não pula entre os destinos: ${lugares.join(', ')}`).toBe(
      1,
    );
  });

  test('deve levar à Entrada com o foco na busca Quando "Search requests" é clicado fora dela', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'rail: só no desktop');
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/rules`);
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Search requests' }).click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}$`));
    await expect(campoDeBusca(page)).toBeFocused();
  });

  test('deve ter "New URL" como botão de ícone de 48 px, com o title e a tecla de hoje', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'rail: só no desktop');
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 0);

    const nova = page.getByRole('button', { name: 'New URL', exact: true });
    await expect(nova).toHaveAttribute('title', 'New URL (N)');
    const caixa = (await nova.boundingBox())!;
    expect([Math.round(caixa.width), Math.round(caixa.height)]).toEqual([48, 48]);
  });
});
