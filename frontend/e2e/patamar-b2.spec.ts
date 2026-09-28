import { Locator, Page } from '@playwright/test';
import {
  escutarAnuncios,
  expectSemAnuncio,
  expectUmAnuncio,
  limparAnuncios,
} from './support/anuncios';
import { TokenTracker, expect, test } from './support/fixtures';
import {
  abrirFiltros,
  abrirItem,
  abrirMensagem,
  acoes,
  campoDeBusca,
  detalhes,
  filtro,
  item,
  itens,
  lista,
  mostrarLista,
  verificacoes,
} from './support/inbox';
import { avisoDaRequisicao, id5, urlInexistente, verResultado } from './support/patamar';
import { gravarRegras } from './support/regras';
import { compacto } from './support/shell';
import { seedStorage } from './support/storage';

// Patamar (a combinação), fatia B2 — a requisição que some vira aviso, e o status respondido aparece em todo lugar
// (UX-38, UX-02, UX-39; guia-combinacao §3.2; CA-5 e CA-7). Nunca outra requisição é aberta no lugar: os testes
// conferem que o `#id` do detalhe é o do endereço, ou que o detalhe não tem `#id`. SUPOSIÇÕES (o guia não fixa):
// - SUPOSIÇÃO: as ações desligadas ficam `aria-disabled="true"` com a razão na descrição acessível; na barra ou no
//   `More`, conforme a largura e a §5.3 (o helper `acaoDoDetalhe()` procura nos dois).
// - SUPOSIÇÃO: os nomes das ações são os de hoje ("Compare with…", "Share read-only link…", "Create rule from this
//   request", "Copy As", "Permalink", "Raw content", "Delete request").
// - SUPOSIÇÃO: o selo do item é um elemento só, com o texto "{status} · {origem}"; a falha de rede mostra o rótulo do
//   tipo ("Connection reset").
// - SUPOSIÇÃO: o lado que falta na comparação é dito por "A" ou "B" ("Request B (#xxxxx) no longer exists.").
// - SUPOSIÇÃO: o "Look in older requests" só aparece quando a URL guarda mais do que as 500 já varridas.
// - SUPOSIÇÃO: a linha de Métricas leva à Entrada com o filtro do status; o parâmetro da rota é da F1 e o teste só
//   exige que o link vá para a Entrada desta URL.

const RAZAO = 'The server no longer has this request.';
const PIX = {
  name: 'Pedido pago',
  priority: 1,
  match: { method: ['POST'], path: { equals: '/pago' } },
  response: { status: 201 },
};

/** O detalhe (`region "Request detail"`). */
function detalhe(page: Page): Locator {
  return page.getByRole('region', { name: 'Request detail' });
}

/** O `More` do detalhe. */
function mais(page: Page): Locator {
  return detalhe(page).getByRole('button', { name: /^More(:|$)/ });
}

/**
 * Uma ação do detalhe, na barra ou no `More` (que esta função abre). Devolve o elemento e se o menu ficou aberto.
 */
async function acaoDoDetalhe(
  page: Page,
  nome: string,
): Promise<{ acao: Locator; noMenu: boolean }> {
  const botao = acoes(page).getByRole('button', { name: nome, exact: true });
  if ((await botao.count()) > 0 && (await botao.first().isVisible())) {
    return { acao: botao.first(), noMenu: false };
  }
  await mais(page).click();
  const itemDoMenu = page.getByRole('menuitem', { name: nome, exact: true });
  await expect(itemDoMenu).toBeVisible();
  return { acao: itemDoMenu, noMenu: true };
}

async function expectAcao(page: Page, nome: string, ligada: boolean): Promise<void> {
  const { acao, noMenu } = await acaoDoDetalhe(page, nome);
  if (ligada) {
    await expect(acao, nome).not.toHaveAttribute('aria-disabled', 'true');
    await expect(acao, nome).toBeEnabled();
  } else {
    await expect(acao, nome).toHaveAttribute('aria-disabled', 'true');
    await expect(acao, nome).toHaveAccessibleDescription(RAZAO);
  }
  if (noMenu) {
    await page.keyboard.press('Escape');
  }
}

/** Apaga a requisição aberta pelo `More` › "Delete request" (INBOX-20). */
async function apagarAAberta(page: Page): Promise<void> {
  await mais(page).click();
  await page.getByRole('menuitem', { name: 'Delete request' }).click();
}

const DESLIGADAS = [
  'Replay…',
  'Compare with…',
  'Share read-only link…',
  'Explain',
  'Send as new…',
  'Permalink',
  'Raw content',
  'Delete request',
];
const LIGADAS = ['Copy payload', 'Create rule from this request', 'Copy As'];

test.describe('Dado uma requisição apagada enquanto está aberta (UX-38; CA-5)', () => {
  test('deve manter a cópia carregada com o aviso, sem abrir outra, e desligar o que precisa do servidor', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/vizinha', data: 'vizinha' });
    const aberta = await tokens.send(tokenId, { path: '/aberta', data: 'corpo da aberta' });
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, aberta);
    await expect(avisoDaRequisicao(page)).toHaveText('');
    await limparAnuncios(page);

    await apagarAAberta(page);

    const aviso = avisoDaRequisicao(page);
    await expect(aviso).toContainText(
      /^You deleted this request at \d{1,2}:\d{2}.*\. You are seeing the copy this page had loaded\./,
    );
    await expect(aviso).toContainText('This copy goes away when you leave it.');
    await expect(
      detalhe(page).getByRole('button', { name: 'Open the newest request' }),
    ).toBeVisible();
    // Nunca outra requisição no lugar: o endereço e o #id do detalhe continuam os da apagada.
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${aberta}/1`));
    await expect(detalhes(page)).toContainText(aberta);
    await expect(detalhe(page)).toContainText('corpo da aberta');
    await expectUmAnuncio(page, /^You deleted this request at/, /^Request notice$/);

    for (const nome of DESLIGADAS) {
      await expectAcao(page, nome, false);
    }
    for (const nome of LIGADAS) {
      await expectAcao(page, nome, true);
    }
    await detalhe(page)
      .getByRole('tab', { name: /^Headers \(\d+\)$/ })
      .click();
    await expect(detalhe(page).getByRole('table', { name: 'Headers' })).toBeVisible();
  });

  test('deve tirar o item da lista sem selecionar outro', async ({ page, tokens }) => {
    test.skip(compacto(page), 'lista e detalhe lado a lado: só no desktop');
    const tokenId = await tokens.create();
    const vizinha = await tokens.send(tokenId, { path: '/vizinha' });
    const aberta = await tokens.send(tokenId, { path: '/aberta' });
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, aberta);
    await expect(abrirItem(page, aberta)).toHaveAttribute('aria-current', /.+/);

    await apagarAAberta(page);

    await expect(item(page, aberta)).toHaveCount(0);
    await expect(item(page, vizinha)).toBeVisible();
    await expect(lista(page).locator('[aria-current]')).toHaveCount(0);
    await expect(detalhes(page)).toContainText(aberta);
  });

  test('deve tirar o aviso e religar as ações com "Undo", anunciando uma vez', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/vizinha' });
    const aberta = await tokens.send(tokenId, { path: '/aberta' });
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, aberta);
    await apagarAAberta(page);
    await expect(avisoDaRequisicao(page)).toContainText('You deleted this request');
    await limparAnuncios(page);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();

    await expect(avisoDaRequisicao(page)).toHaveText('');
    await expectUmAnuncio(page, /^Request restored\.$/);
    await expectAcao(page, 'Replay…', true);
    await expect(detalhes(page)).toContainText(aberta);
    expect((await tokens.listed(tokenId)).map((r) => r.uuid)).toContain(aberta);
  });

  test('deve sair da cópia para a vizinha que existe, e não voltar para a apagada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const antiga = await tokens.send(tokenId, { path: '/antiga' });
    const aberta = await tokens.send(tokenId, { path: '/aberta' });
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, aberta);
    await apagarAAberta(page);
    await expect(avisoDaRequisicao(page)).toContainText('You deleted this request');

    await detalhe(page).getByRole('button', { name: 'Older', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${antiga}/1`));
    await expect(detalhes(page)).toContainText(antiga);
    await expect(avisoDaRequisicao(page)).toHaveText('');
    await expect(detalhe(page).getByRole('button', { name: 'Newer', exact: true })).toBeDisabled();
  });

  test('deve dizer que foi a limpeza automática, com o limite, Quando a requisição aberta é cortada', async ({
    page,
    tokens,
  }) => {
    test.setTimeout(120_000);
    const tokenId = await tokens.create({ auto_cleanup: 500 });
    await tokens.sendMany(tokenId, 500);
    const [antiga] = await tokens.listed(tokenId);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const stream = page.waitForResponse((r) => r.url().endsWith(`/token/${tokenId}/stream`));
    await page.goto(`/#/${tokenId}/${antiga.uuid}/1`);
    await stream;
    await expect(detalhes(page)).toContainText(antiga.uuid);
    await limparAnuncios(page);

    await tokens.send(tokenId, { path: '/nova' });

    await expect(avisoDaRequisicao(page)).toContainText(
      /^This request was deleted from the server by auto cleanup \(keeps the newest 500\), noticed at \d{1,2}:\d{2}/,
    );
    await expectUmAnuncio(page, /deleted from the server by auto cleanup/, /^Request notice$/);
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${antiga.uuid}/1`));
    await expect(detalhes(page)).toContainText(antiga.uuid);
    await expectAcao(page, 'Replay…', false);
  });

  test('deve pôr as ações desligadas no More e deixar na barra só o que funciona, no celular', async ({
    page,
    tokens,
  }) => {
    test.skip(!compacto(page), 'só no celular');
    const tokenId = await tokens.create();
    const aberta = await tokens.send(tokenId, { path: '/aberta', data: 'x' });
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, aberta);
    await apagarAAberta(page);
    await expect(avisoDaRequisicao(page)).toContainText('You deleted this request');

    await expect(acoes(page).getByRole('button', { name: 'Replay…' })).toHaveCount(0);
    await expect(
      acoes(page).getByRole('button', { name: 'Create rule from this request' }),
    ).toBeVisible();
    await mais(page).click();
    await expect(page.getByRole('menuitem', { name: 'Replay…', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

test.describe('Dado um link para uma requisição que não existe (UX-38; CA-5)', () => {
  async function comDuas(tokens: TokenTracker) {
    const tokenId = await tokens.create();
    const velha = await tokens.send(tokenId, { path: '/velha' });
    const nova = await tokens.send(tokenId, { path: '/nova' });
    return { tokenId, velha, nova };
  }

  test('deve mostrar o estado vazio, com o foco no título, e nunca outra requisição', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await comDuas(tokens);
    const falta = urlInexistente();
    await seedStorage(page, {});

    await page.goto(`/#/${tokenId}/${falta}/1`);

    const titulo = detalhe(page).getByText('This request no longer exists.', { exact: true });
    await expect(titulo).toBeVisible();
    await expect(titulo).toBeFocused();
    await expect(detalhe(page)).toContainText('It may have been deleted or cut by auto cleanup.');
    await expect(detalhe(page)).toContainText('No other request was opened in its place.');
    await expect(detalhe(page)).toContainText(`#${id5(falta)}`);
    expect(page.url().endsWith(`/#/${tokenId}/${falta}/1`), 'o endereço fica como veio').toBe(true);
    // O detalhe não tem os metadados de requisição nenhuma.
    await expect(detalhes(page)).toHaveCount(0);
    await expect(acoes(page)).toHaveCount(0);
    if (!compacto(page)) {
      await expect(itens(page)).toHaveCount(2);
      await expect(lista(page).locator('[aria-current]')).toHaveCount(0);
    }
  });

  test('deve abrir a mais nova só quando pedido, e buscar pelo identificador', async ({
    page,
    tokens,
  }) => {
    const { tokenId, nova } = await comDuas(tokens);
    const falta = urlInexistente();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/${falta}/1`);

    await detalhe(page).getByRole('button', { name: 'Search for this id' }).click();
    await mostrarListaSePreciso(page);
    await expect(campoDeBusca(page)).toHaveValue(falta);

    await page.goto(`/#/${tokenId}/${falta}/1`);
    await detalhe(page).getByRole('button', { name: 'Open the newest request' }).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${nova}/1`));
    await expect(detalhes(page)).toContainText(nova);
  });

  test('deve levar a data no link permanente e dizer de quando era a requisição', async ({
    page,
    request,
    tokens,
  }) => {
    const { tokenId, nova } = await comDuas(tokens);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, nova);
    await mais(page).click();
    const link = await page.getByRole('menuitem', { name: 'Permalink' }).getAttribute('href');
    expect(link).toMatch(new RegExp(`#/${tokenId}/${nova}/1\\?at=`));
    await page.keyboard.press('Escape');
    expect((await request.delete(`/token/${tokenId}/request/${nova}`)).status()).toBeLessThan(300);

    await page.goto(link!.replace(/^.*#/, '/#'));
    await page.reload();

    await expect(detalhe(page)).toContainText('This request no longer exists.');
    await expect(detalhe(page)).toContainText(
      /It was received on [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}/,
    );
    await expect(detalhes(page)).toHaveCount(0);
  });

  test('deve dizer que não carregou, e não que não existe, Quando o servidor não responde', async ({
    page,
    tokens,
  }) => {
    const { tokenId, nova } = await comDuas(tokens);
    await seedStorage(page, {});
    let falhar = true;
    await page.route(`**/token/${tokenId}/request/${nova}`, async (rota) => {
      if (falhar) {
        await rota.abort('failed');
        return;
      }
      await rota.continue();
    });

    await page.goto(`/#/${tokenId}/${nova}/1`);

    await expect(detalhe(page)).toContainText(
      'Could not load this request. The server did not answer.',
    );
    await expect(detalhe(page)).not.toContainText('no longer exists');
    falhar = false;
    await detalhe(page).getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(detalhes(page)).toContainText(nova);
  });

  test('não deve comparar com outra requisição Quando um lado da comparação não existe', async ({
    page,
    tokens,
  }) => {
    const { tokenId, nova } = await comDuas(tokens);
    const falta = urlInexistente();
    await seedStorage(page, {});

    await page.goto(`/#/${tokenId}/compare/${nova}/${falta}`);

    const principal = page.getByRole('main');
    await expect(principal).toContainText(
      `Request B (#${id5(falta)}) no longer exists. Nothing was compared.`,
    );
    await expect(principal.getByRole('button', { name: 'Choose another request' })).toBeVisible();
    await expect(principal.getByRole('table', { name: 'Checks' })).toHaveCount(0);
  });
});

/** No celular, a busca fica na lista: mostra a lista se o detalhe estiver por cima. */
async function mostrarListaSePreciso(page: Page): Promise<void> {
  if (compacto(page) && !(await campoDeBusca(page).isVisible())) {
    await mostrarLista(page);
  }
}

test.describe('Dado o status respondido no item e no detalhe (UX-02, UX-39; CA-7)', () => {
  /** URL com padrão 429 e Retry-After 5, a regra "Pedido pago" (201 em POST /pago) e uma de falha de rede. */
  async function urlComRespostas(tokens: TokenTracker, page: Page) {
    const tokenId = await tokens.create({ default_status: '429', retry_after: '5' });
    await gravarRegras(page.request, tokenId, [
      PIX,
      {
        name: 'Derruba',
        priority: 2,
        match: { path: { equals: '/cai' } },
        response: { fault: 'connection_reset' },
      },
    ]);
    const pelaRegra = await tokens.send(tokenId, { path: '/pago' });
    const peloPadrao = await tokens.send(tokenId, { method: 'GET', path: '/pago' });
    await page.request.post(`/${tokenId}/cai`).catch(() => undefined);
    await expect.poll(async () => (await tokens.listed(tokenId)).length).toBe(3);
    const comFalha = (await tokens.listed(tokenId))
      .map((r) => r.uuid)
      .find((uuid) => uuid !== pelaRegra && uuid !== peloPadrao)!;
    return { tokenId, pelaRegra, peloPadrao, comFalha };
  }

  test('deve mostrar no item o status e a origem, no selo e no nome acessível', async ({
    page,
    tokens,
  }) => {
    const { tokenId, pelaRegra, peloPadrao, comFalha } = await urlComRespostas(tokens, page);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    if (compacto(page)) {
      await expect(itens(page)).toHaveCount(3);
    }

    await expect(
      item(page, peloPadrao).getByText('429 · Default response', { exact: true }),
    ).toBeVisible();
    await expect(abrirItem(page, peloPadrao)).toHaveAccessibleName(/\bDefault response · 429\b/);
    await expect(
      item(page, pelaRegra).getByText('201 · Pedido pago', { exact: true }),
    ).toBeVisible();
    await expect(abrirItem(page, pelaRegra)).toHaveAccessibleName(
      /\bAnswered by rule · 201: Pedido pago\b/,
    );
    await expect(item(page, comFalha).getByText(/^— · Connection reset/)).toBeVisible();
    await expect(abrirItem(page, comFalha)).toHaveAccessibleName(
      /\bNetwork fault by rule: Connection reset.*: Derruba\b/,
    );
  });

  test('deve usar cor neutra de 2xx a 4xx e a de erro na falha de rede, sempre com o texto', async ({
    page,
    tokens,
  }) => {
    const { tokenId, pelaRegra, peloPadrao, comFalha } = await urlComRespostas(tokens, page);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    const fundo = (selo: Locator) =>
      selo.evaluate((el) => {
        for (let no: Element | null = el; no; no = no.parentElement) {
          const cor = getComputedStyle(no).backgroundColor;
          if (cor !== 'rgba(0, 0, 0, 0)' && cor !== 'transparent') {
            return cor;
          }
          if (no.classList.contains('item')) {
            break;
          }
        }
        return 'sem fundo';
      });

    const de201 = await fundo(
      item(page, pelaRegra).getByText('201 · Pedido pago', { exact: true }),
    );
    const de429 = await fundo(
      item(page, peloPadrao).getByText('429 · Default response', { exact: true }),
    );
    const deFalha = await fundo(item(page, comFalha).getByText(/^— · Connection reset/));

    expect(de429, '4xx tem a cor neutra do 2xx').toBe(de201);
    expect(deFalha, 'a falha de rede tem a cor de erro').not.toBe(de201);
  });

  test('deve dizer "not recorded" na requisição gravada antes do campo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, { path: '/antiga' });
    // Antes da rota: com ela ativa, a ida ao favicon.ico da semente é abortada.
    await seedStorage(page, {});
    await page.route(new RegExp(`/token/${tokenId}/requests?(/[^/]+)?(\\?.*)?$`), async (rota) => {
      if (rota.request().method() !== 'GET') {
        await rota.continue();
        return;
      }
      const resposta = await rota.fetch();
      const corpo = (await resposta.json()) as Record<string, unknown>;
      const tirar = (m: Record<string, unknown>) => delete m['response'];
      if (Array.isArray(corpo['data'])) {
        (corpo['data'] as Record<string, unknown>[]).forEach(tirar);
      } else {
        tirar(corpo);
      }
      await rota.fulfill({ response: resposta, json: corpo });
    });

    await page.goto(`/#/${tokenId}`);

    await expect(item(page, id).getByText('— · not recorded', { exact: true })).toBeVisible();
    await expect(abrirItem(page, id)).toHaveAccessibleName(/\bAnswer not recorded\b/);
  });

  test('não deve cortar o status do selo: quem encolhe é o nome da regra', async ({
    page,
    tokens,
  }) => {
    const nome = 'Regra com um nome bem comprido para não caber na linha do item da lista';
    const tokenId = await tokens.create();
    await gravarRegras(page.request, tokenId, [{ name: nome, response: { status: 202 } }]);
    const id = await tokens.send(tokenId, { path: '/x' });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);

    const linha = item(page, id);
    await expect(linha).toContainText('202 ·');
    const medida = await linha.evaluate((el) => {
      const caminhante = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let no = caminhante.nextNode(); no; no = caminhante.nextNode()) {
        const texto = no.textContent ?? '';
        const onde = texto.indexOf('202');
        if (onde >= 0) {
          const faixa = document.createRange();
          faixa.setStart(no, onde);
          faixa.setEnd(no, onde + 3);
          const numero = faixa.getBoundingClientRect();
          // O primeiro ancestral que corta: o número tem de caber inteiro dentro dele.
          let corta: Element | null = no.parentElement;
          while (corta && getComputedStyle(corta).overflowX === 'visible') {
            corta = corta.parentElement;
          }
          const caixa = (corta ?? el).getBoundingClientRect();
          return { esquerda: numero.left - caixa.left, direita: caixa.right - numero.right };
        }
      }
      return null;
    });
    expect(medida, 'o número 202 está no item').not.toBeNull();
    expect(medida!.esquerda).toBeGreaterThanOrEqual(0);
    expect(medida!.direita).toBeGreaterThanOrEqual(0);
    await expect(linha).toContainText(`#${id5(id)}`);
  });

  test('deve dizer no cartão o status e a origem, com a ressalva do Retry-After e a regra mais perto', async ({
    page,
    tokens,
  }) => {
    const { tokenId, pelaRegra, peloPadrao } = await urlComRespostas(tokens, page);
    await seedStorage(page, {});

    await abrirMensagem(page, tokenId, peloPadrao);
    const cartoes = verificacoes(page);
    await expect(cartoes).toContainText('Answered 429 · default response');
    await expect(cartoes).toContainText('Retry-After: 5 (as configured now)');
    await expect(cartoes).toContainText(
      /Closest rule: Pedido pago — method: expected POST, got GET/,
    );
    await expect(cartoes.getByRole('button', { name: 'Why not rule…?' })).toBeVisible();

    await abrirMensagem(page, tokenId, pelaRegra);
    await expect(cartoes).toContainText('Answered 201 · by rule');
    await expect(cartoes.getByRole('link', { name: 'Pedido pago', exact: true })).toBeVisible();
    await expect(cartoes).not.toContainText('Retry-After');
  });

  test('deve dizer que a regra mais perto veio das regras de agora Quando uma pega-tudo respondeu', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(page.request, tokenId, [
      PIX,
      { name: 'Tudo o resto', priority: 9, response: { status: 404 } },
    ]);
    const id = await tokens.send(tokenId, { method: 'GET', path: '/pago' });
    await seedStorage(page, {});

    await abrirMensagem(page, tokenId, id);

    const cartoes = verificacoes(page);
    await expect(cartoes).toContainText('Answered 404 · by rule');
    await expect(cartoes).toContainText(
      /Closest rule: Pedido pago — method: expected POST, got GET/,
    );
    await expect(cartoes).toContainText('Checked against the rules as they are now.');
  });

  test('deve mostrar o status da resposta padrão numa URL sem regras', async ({ page, tokens }) => {
    const tokenId = await tokens.create({ default_status: '202' });
    const id = await tokens.send(tokenId);
    await seedStorage(page, {});

    await abrirMensagem(page, tokenId, id);

    await expect(verificacoes(page)).toContainText('Answered 202 · default response');
    await mostrarListaSePreciso(page);
    await expect(item(page, id).getByText('202 · Default response', { exact: true })).toBeVisible();
  });
});

test.describe('Dado o filtro pela classe do status respondido (UX-02; CA-7)', () => {
  test('deve filtrar no navegador, dizer o alcance e anunciar o resultado uma vez', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_status: '429' });
    await gravarRegras(page.request, tokenId, [PIX]);
    await tokens.send(tokenId, { path: '/pago' });
    const a = await tokens.send(tokenId, { path: '/outra' });
    const b = await tokens.send(tokenId, { method: 'GET', path: '/pago' });
    await tokens.send(tokenId, { path: '/pago' });
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (4)' })).toBeVisible();

    await abrirFiltros(page);
    for (const classe of ['2xx', '3xx', '4xx', '5xx']) {
      await expect(filtro(page, `Answered ${classe}`)).toHaveAttribute('aria-pressed', 'false');
    }
    await limparAnuncios(page);
    await filtro(page, 'Answered 4xx').click();

    await expect(filtro(page, 'Answered 4xx')).toHaveAttribute('aria-pressed', 'true');
    await expectUmAnuncio(page, /^2 match among the newest 4\.?$/);
    await expectSemAnuncio(page, /Searching|Looking in/);
    await verResultado(page);
    await expect(itens(page)).toHaveCount(2);
    await expect(item(page, a)).toBeVisible();
    await expect(item(page, b)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Look in older requests' })).toHaveCount(0);
  });

  test('deve oferecer "Look in older requests" e nunca dizer zero sem dizer onde procurou', async ({
    page,
    tokens,
  }) => {
    test.setTimeout(120_000);
    const tokenId = await tokens.create({ default_status: '200' });
    await gravarRegras(page.request, tokenId, [
      { name: 'Recusa', match: { path: { equals: '/recusa' } }, response: { status: 503 } },
    ]);
    const antiga = await tokens.send(tokenId, { path: '/recusa' });
    await tokens.sendMany(tokenId, 504);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (505)' })).toBeVisible();

    await abrirFiltros(page);
    await filtro(page, 'Answered 5xx').click();
    await verResultado(page);

    const resultado = lista(page)
      .getByRole('status')
      .filter({ hasText: /among the newest/ });
    await expect(resultado).toContainText('0 match among the newest 500');
    await page.getByRole('button', { name: 'Look in older requests' }).click();
    await expect(resultado).toContainText('1 match among the newest 505');
    await expect(item(page, antiga)).toBeVisible();
  });
});

test.describe('Dado Métricas com respostas de status diferentes (UX-02; CA-7)', () => {
  test('deve contar as respostas por status exato, com a origem, e levar à Entrada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_status: '429' });
    await gravarRegras(page.request, tokenId, [PIX]);
    await tokens.send(tokenId, { path: '/pago' });
    await tokens.send(tokenId, { path: '/outra' });
    await tokens.send(tokenId, { method: 'GET', path: '/pago' });
    await seedStorage(page, {});

    await page.goto(`/#/${tokenId}/insights`);

    const bloco = page.getByRole('region', { name: 'Answers by status' });
    await expect(bloco).toContainText('Counted over the newest 3 requests.');
    const padrao = bloco.getByRole('link', {
      name: /^429 Too Many Requests · 2 · default response$/,
    });
    await expect(padrao).toBeVisible();
    await expect(bloco.getByRole('link', { name: /^201 Created · 1 · by rules$/ })).toBeVisible();
    await expect(padrao).toHaveAttribute('href', new RegExp(`#/${tokenId}(\\?|$)`));
  });

  test('deve dizer "No answers yet." numa URL sem requisições', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});

    await page.goto(`/#/${tokenId}/insights`);

    await expect(page.getByRole('region', { name: 'Answers by status' })).toContainText(
      'No answers yet.',
    );
  });
});

test.describe('Dado a comparação de duas requisições (UX-02; CA-7)', () => {
  test('deve ter a linha "Answer" com o status dos dois lados, no lugar de "Rule"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_status: '429' });
    await gravarRegras(page.request, tokenId, [PIX]);
    const a = await tokens.send(tokenId, { path: '/pago' });
    const b = await tokens.send(tokenId, { method: 'GET', path: '/pago' });
    await seedStorage(page, {});

    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);

    const tabela = page
      .getByRole('region', { name: 'Compare requests' })
      .getByRole('table', { name: 'Checks' });
    await expect(tabela.getByRole('rowheader', { name: 'Answer', exact: true })).toBeVisible();
    await expect(tabela.getByRole('rowheader', { name: 'Rule', exact: true })).toHaveCount(0);
    const linha = tabela
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: 'Answer', exact: true }) });
    await expect(linha.getByRole('cell').first()).toContainText('201');
    await expect(linha.getByRole('cell').nth(1)).toContainText('429');
  });
});
