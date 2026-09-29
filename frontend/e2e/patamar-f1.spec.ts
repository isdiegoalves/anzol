import { createHmac } from 'node:crypto';
import { Locator, Page, Request } from '@playwright/test';
import { escutarAnuncios, expectUmAnuncio, limparAnuncios } from './support/anuncios';
import { abrirChecks } from './support/checks';
import { TokenTracker, Webhook, expect, test } from './support/fixtures';
import {
  abrirAba,
  abrirItem,
  abrirMensagem,
  detalhes,
  item,
  itens,
  lista,
  mostrarLista,
  verificacoes,
} from './support/inbox';
import { botaoDeFiltros, filtrosLigados } from './support/patamar';
import { gravarRegras } from './support/regras';
import { compacto } from './support/shell';
import { seedStorage } from './support/storage';

// Patamar (a combinação), fatia F1 — clicar num valor vira filtro; os números de Saúde e de Métricas levam ao mesmo
// filtro (variação 4; guia-combinacao §3.6; CA-12). Sem sintaxe de consulta: todo filtro novo é um chip da `list
// "Active filters"`, criado por clique, com o `match` que o servidor já aceita. SUPOSIÇÕES (o guia não fixa):
// - SUPOSIÇÃO: o {label} do valor clicável é o nome do cabeçalho ou do parâmetro como a requisição gravou; no corpo,
//   o JSONPath ("$.status"); no cabeçalho do detalhe e nos cartões, um rótulo que o teste não fixa (o nome acessível
//   acaba em "{valor}. Value actions").
// - SUPOSIÇÃO: o {value} do corpo vem como o valor escalar, com ou sem as aspas do JSON.
// - SUPOSIÇÃO: o rascunho dos filtros por valor fica no `sessionStorage` da aba (o guia não dá a chave); o teste só
//   exige que o valor não esteja no endereço.
// - SUPOSIÇÃO: o aviso "This link does not carry 1 filter by value." aparece ao abrir, noutra aba, o endereço que a
//   tela mostrava com o filtro por valor ligado.
// - SUPOSIÇÃO: o link de contagem de um motivo de assinatura usa a frase crua do servidor em inglês ("timestamp
//   outside tolerance"), que é o texto-fonte; a tradução é só do pt-BR.
// - Sem teste: a nota "Counted over the newest 500, as in Insights." (pede mais de 500 requisições).

const SECRET = 'segredo-do-patamar-f1';
const CHAVE = 'x-loja-event-id';
const esc = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Cenario {
  tokenId: string;
  pixPago: string;
  boletoPendente: string;
  outroPago: string;
  saude: string;
}

/** Quatro requisições com cabeçalho, query e corpo diferentes; a URL responde 429 por padrão. */
async function cenario(tokens: TokenTracker): Promise<Cenario> {
  const tokenId = await tokens.create({ default_status: '429' });
  const json = { 'Content-Type': 'application/json' };
  return {
    tokenId,
    pixPago: await tokens.send(tokenId, {
      path: '/pedidos?tipo=pix',
      headers: { ...json, [CHAVE]: 'evt_1' },
      data: '{"status":"pago","valor":10}',
    }),
    boletoPendente: await tokens.send(tokenId, {
      path: '/pedidos?tipo=boleto',
      headers: { ...json, [CHAVE]: 'evt_1' },
      data: '{"status":"pendente","valor":10}',
    }),
    outroPago: await tokens.send(tokenId, {
      method: 'PUT',
      path: '/outros',
      headers: { ...json, [CHAVE]: 'evt_2' },
      data: '{"status":"pago"}',
    }),
    saude: await tokens.send(tokenId, { method: 'GET', path: '/saude' }),
  };
}

/** O valor clicável: `button "{label}: {value}. Value actions"`. */
function valor(page: Page, nome: RegExp): Locator {
  return page.getByRole('region', { name: 'Request detail' }).getByRole('button', { name: nome });
}

/** Clica no valor e escolhe um item do `menu "Value actions"`. */
async function acaoDoValor(page: Page, alvo: Locator, acao: string): Promise<void> {
  await alvo.click();
  await page.getByRole('menuitem', { name: acao, exact: true }).click();
}

/** Espera a busca do servidor que o filtro dispara e devolve o corpo dela. */
function busca(page: Page, tokenId: string): Promise<Request> {
  return page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith(`/token/${tokenId}/requests/search`),
  );
}

/**
 * Mostra a lista e devolve os chips dos filtros ligados. No celular, depois de filtrar pelo valor o
 * detalhe fica por cima; chegando por um link de contagem, a lista já está à frente.
 */
async function chips(page: Page, detalhePorCima = true): Promise<Locator> {
  if (compacto(page) && detalhePorCima) {
    await mostrarLista(page);
  }
  return filtrosLigados(page);
}

test.describe('Dado um valor da requisição aberta (CA-12)', () => {
  test('deve virar chip o valor de um cabeçalho, filtrar no servidor e anunciar uma vez', async ({
    page,
    tokens,
  }) => {
    const c = await cenario(tokens);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirMensagem(page, c.tokenId, c.pixPago);
    await abrirAba(page, 'Headers');
    const evento = valor(page, new RegExp(`^${esc(CHAVE)}: evt_1\\. Value actions$`, 'i'));

    await evento.click();
    const menu = page.getByRole('menu', { name: 'Value actions' });
    for (const acao of ['Filter by this value', 'Copy value', 'Copy path', 'Group by this field']) {
      await expect(menu.getByRole('menuitem', { name: acao, exact: true })).toBeVisible();
    }
    // Negar só existe onde o match do servidor nega: não num cabeçalho.
    await expect(menu.getByRole('menuitem', { name: 'Exclude this value' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Filter by this value' })).toBeFocused();
    await limparAnuncios(page);
    const pedido = busca(page, c.tokenId);
    await page.keyboard.press('Enter');

    expect((await pedido).postDataJSON()).toMatchObject({
      match: { headers: { [CHAVE]: { equals: 'evt_1' } } },
    });
    await expectUmAnuncio(
      page,
      new RegExp(`^Filtered by header ${esc(CHAVE)} = evt_1\\. 2 requests match`),
    );
    if (!compacto(page)) {
      await expect(evento, 'o foco fica no valor').toBeFocused();
    }
    const ligados = await chips(page);
    await expect(ligados).toContainText(`header ${CHAVE} = evt_1`);
    await expect(
      ligados.getByRole('button', { name: `Remove this filter: header ${CHAVE} = evt_1` }),
    ).toBeVisible();
    await expect(botaoDeFiltros(page)).toHaveAccessibleName('Filters, 1 active');
    await expect(itens(page)).toHaveCount(2);
    await expect(item(page, c.pixPago)).toBeVisible();
    await expect(item(page, c.boletoPendente)).toBeVisible();
    // O dado da requisição não vai para o endereço (nem para o histórico do navegador).
    expect(decodeURIComponent(page.url())).not.toContain('evt_1');
  });

  test('deve virar chip o valor de um campo do corpo e o de um parâmetro da query, somando os filtros', async ({
    page,
    tokens,
  }) => {
    const c = await cenario(tokens);
    await seedStorage(page, {});
    await abrirMensagem(page, c.tokenId, c.pixPago);

    await abrirAba(page, 'Body');
    let pedido = busca(page, c.tokenId);
    await acaoDoValor(
      page,
      valor(page, /^\$\.status: "?pago"?\. Value actions$/),
      'Filter by this value',
    );
    expect((await pedido).postDataJSON()).toMatchObject({
      match: { body: [{ jsonPath: { path: '$.status', equals: 'pago' } }] },
    });

    await abrirAba(page, 'Query');
    pedido = busca(page, c.tokenId);
    await acaoDoValor(page, valor(page, /^tipo: pix\. Value actions$/), 'Filter by this value');
    expect((await pedido).postDataJSON()).toMatchObject({
      match: {
        query: { tipo: { equals: 'pix' } },
        body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
      },
    });

    const ligados = await chips(page);
    await expect(ligados).toContainText('body $.status = pago');
    await expect(ligados).toContainText('query tipo = pix');
    await expect(itens(page)).toHaveCount(1);
    await expect(item(page, c.pixPago)).toBeVisible();

    await ligados.getByRole('button', { name: 'Remove this filter: query tipo = pix' }).click();
    await expect(itens(page)).toHaveCount(2);
    await expect(item(page, c.outroPago)).toBeVisible();
  });

  test('deve filtrar pelo método e pelo caminho do cabeçalho do detalhe, com "Exclude" só no método', async ({
    page,
    tokens,
  }) => {
    const c = await cenario(tokens);
    await seedStorage(page, {});
    await abrirMensagem(page, c.tokenId, c.pixPago);

    await valor(page, /\/pedidos\. Value actions$/).click();
    await expect(page.getByRole('menuitem', { name: 'Exclude this value' })).toHaveCount(0);
    let pedido = busca(page, c.tokenId);
    await page.getByRole('menuitem', { name: 'Filter by this value', exact: true }).click();
    expect((await pedido).postDataJSON()).toMatchObject({
      match: { path: { equals: '/pedidos' } },
    });

    await valor(page, /POST\. Value actions$/).click();
    await expect(page.getByRole('menuitem', { name: 'Exclude this value' })).toBeVisible();
    pedido = busca(page, c.tokenId);
    await page.getByRole('menuitem', { name: 'Filter by this value', exact: true }).click();
    expect((await pedido).postDataJSON()).toMatchObject({ match: { method: ['POST'] } });

    const ligados = await chips(page);
    await expect(ligados).toContainText('path = /pedidos');
    await expect(ligados).toContainText('method POST');
    await expect(itens(page)).toHaveCount(2);
  });

  test('deve filtrar pelo status respondido clicado no cartão, no navegador', async ({
    page,
    tokens,
  }) => {
    const c = await cenario(tokens);
    await gravarRegras(page.request, c.tokenId, [
      { name: 'Aceita', match: { path: { equals: '/aceita' } }, response: { status: 201 } },
    ]);
    const aceita = await tokens.send(c.tokenId, { path: '/aceita' });
    await seedStorage(page, {});
    await abrirMensagem(page, c.tokenId, c.pixPago);

    await acaoDoValor(
      page,
      verificacoes(page).getByRole('button', { name: /429\. Value actions$/ }),
      'Filter by this value',
    );

    const ligados = await chips(page);
    await expect(ligados).toContainText('answered 429');
    await expect(itens(page)).toHaveCount(4);
    await expect(item(page, aceita)).toHaveCount(0);
    await expect(
      lista(page)
        .getByRole('status')
        .filter({ hasText: /among the newest/ }),
    ).toContainText('4 match among the newest 5');
  });

  test('deve copiar o valor e o caminho, anunciando uma vez', async ({ page, tokens }) => {
    const c = await cenario(tokens);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirMensagem(page, c.tokenId, c.pixPago);
    await abrirAba(page, 'Body');
    const status = valor(page, /^\$\.status: "?pago"?\. Value actions$/);
    await limparAnuncios(page);

    await acaoDoValor(page, status, 'Copy value');
    await expectUmAnuncio(page, /^Value copied\.$/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('pago');

    await limparAnuncios(page);
    await acaoDoValor(page, status, 'Copy path');
    await expectUmAnuncio(page, /^Path copied\.$/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('$.status');
    await expect(filtrosLigados(page)).toHaveCount(0);
  });

  test('deve fechar o menu com Esc e devolver o foco ao valor', async ({ page, tokens }) => {
    test.skip(compacto(page), 'teclado: só no desktop');
    const c = await cenario(tokens);
    await seedStorage(page, {});
    await abrirMensagem(page, c.tokenId, c.pixPago);
    await abrirAba(page, 'Headers');
    const evento = valor(page, new RegExp(`^${esc(CHAVE)}: evt_1\\. Value actions$`, 'i'));

    await evento.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Value actions' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('menu', { name: 'Value actions' })).toBeHidden();
    await expect(evento).toBeFocused();
    await expect(filtrosLigados(page)).toHaveCount(0);
  });

  test('não deve oferecer o filtro num valor com mais de 200 caracteres; copiar continua', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const comprido = 'v'.repeat(250);
    const id = await tokens.send(tokenId, { headers: { 'X-Comprido': comprido }, data: 'x' });
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    await abrirAba(page, 'Headers');

    await valor(page, /^x-comprido: v+\. Value actions$/i).click();

    await expect(page.getByRole('menuitem', { name: 'Copy value', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Filter by this value' })).toHaveCount(0);
  });

  test('deve oferecer "Filter by a field…" no lugar do clique por linha Quando o corpo passa de 100 KB', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const corpo = JSON.stringify({ status: 'pago', enchimento: 'x'.repeat(110 * 1024) });
    const id = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: corpo,
    });
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    await abrirAba(page, 'Body');

    await expect(valor(page, /^\$\.status: /)).toHaveCount(0);
    await page
      .getByRole('region', { name: 'Request detail' })
      .getByRole('button', { name: 'Filter by a field…' })
      .click();
    await page.getByRole('searchbox', { name: 'Filter fields' }).fill('status');
    await page
      .getByRole('button', { name: /\$\.status/ })
      .first()
      .click();

    await expect(await chips(page)).toContainText('body $.status = pago');
  });

  test('deve marcar o chip como "not accepted" e voltar ao filtro anterior Quando o servidor recusa o match', async ({
    page,
    tokens,
  }) => {
    const c = await cenario(tokens);
    await seedStorage(page, {});
    await abrirMensagem(page, c.tokenId, c.pixPago);
    await page.route(`**/token/${c.tokenId}/requests/search`, (rota) =>
      rota.fulfill({
        status: 422,
        json: { 'match.headers.x-loja-event-id': ['The match is invalid.'] },
      }),
    );
    await abrirAba(page, 'Headers');

    await acaoDoValor(
      page,
      valor(page, new RegExp(`^${esc(CHAVE)}: evt_1\\. Value actions$`, 'i')),
      'Filter by this value',
    );

    const ligados = await chips(page);
    await expect(ligados).toContainText('not accepted');
    await expect(itens(page)).toHaveCount(4);
  });
});

test.describe('Dado os selos do item da lista (CA-12)', () => {
  test('deve filtrar direto, sem menu, pelo selo do status', async ({ page, tokens }) => {
    test.skip(compacto(page), 'no toque os selos da lista não são clicáveis');
    const c = await cenario(tokens);
    await seedStorage(page, {});
    await page.goto(`/#/${c.tokenId}/${c.saude}/1`);
    await expect(detalhes(page)).toContainText(c.saude);

    const selo = item(page, c.pixPago).getByRole('button', { name: 'Filter by answered 429' });
    const caixa = (await selo.boundingBox())!;
    expect(Math.min(caixa.width, caixa.height)).toBeGreaterThanOrEqual(24);
    await selo.click();

    await expect(page.getByRole('menu', { name: 'Value actions' })).toHaveCount(0);
    await expect(filtrosLigados(page)).toContainText('answered 429');
    // Filtrar não abre nem troca a requisição aberta.
    await expect(detalhes(page)).toContainText(c.saude);
  });

  test('não deve ter selo clicável na lista no toque: o item inteiro abre a requisição', async ({
    page,
    tokens,
  }) => {
    test.skip(!compacto(page), 'só no celular');
    const c = await cenario(tokens);
    await seedStorage(page, {});
    await page.goto(`/#/${c.tokenId}`);
    await expect(item(page, c.pixPago)).toBeVisible();

    await expect(lista(page).getByRole('button', { name: /^Filter by / })).toHaveCount(0);
    await abrirItem(page, c.pixPago).click();
    await expect(detalhes(page)).toContainText(c.pixPago);
  });
});

test.describe('Dado um filtro por valor ligado (CA-12)', () => {
  test('não deve levar o valor no link: outra aba abre sem o filtro e avisa', async ({
    page,
    context,
    tokens,
  }) => {
    const c = await cenario(tokens);
    await seedStorage(page, {});
    await abrirMensagem(page, c.tokenId, c.pixPago);
    await abrirAba(page, 'Headers');
    await acaoDoValor(
      page,
      valor(page, new RegExp(`^${esc(CHAVE)}: evt_1\\. Value actions$`, 'i')),
      'Filter by this value',
    );
    await expect(await chips(page)).toContainText(`header ${CHAVE} = evt_1`);
    const endereco = page.url();
    expect(decodeURIComponent(endereco)).not.toContain('evt_1');

    // Recarregar a mesma aba mantém o filtro (fica no sessionStorage da aba).
    await page.reload();
    await expect(await chips(page)).toContainText(`header ${CHAVE} = evt_1`);

    const outra = await context.newPage();
    await outra.goto(endereco);
    await expect(outra.getByText('This link does not carry 1 filter by value.')).toBeVisible();
    await expect(outra.getByRole('list', { name: 'Active filters' })).toHaveCount(0);
    await outra.close();
  });

  test('deve levar os filtros por valor no --match do "Copy as anzol wait-for"', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'no celular a linha do cabeçalho não leva o wait-for');
    const c = await cenario(tokens);
    await seedStorage(page, {});
    await abrirMensagem(page, c.tokenId, c.pixPago);
    await abrirAba(page, 'Headers');
    await acaoDoValor(
      page,
      valor(page, new RegExp(`^${esc(CHAVE)}: evt_1\\. Value actions$`, 'i')),
      'Filter by this value',
    );
    await expect(filtrosLigados(page)).toContainText(`header ${CHAVE} = evt_1`);

    await lista(page).getByRole('button', { name: 'Copy as anzol wait-for' }).click();

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/^anzol wait-for .*--match '.*"x-loja-event-id":\{"equals":"evt_1"\}/);
  });
});

test.describe('Dado os números de Saúde e de Métricas (CA-12, UX-18)', () => {
  function stripe(secret: string, body: string, t: number): Webhook {
    const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    return {
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
      data: body,
    };
  }

  /** Duas fora da tolerância, uma com o segredo errado, uma sem assinatura e uma válida. */
  async function comFalhas(tokens: TokenTracker): Promise<string> {
    const tokenId = await tokens.create({ signature: { provider: 'stripe', secret: SECRET } });
    const agora = Math.floor(Date.now() / 1000);
    await tokens.send(tokenId, stripe(SECRET, '{"id":1}', agora - 1000));
    await tokens.send(tokenId, stripe(SECRET, '{"id":2}', agora - 2000));
    await tokens.send(tokenId, stripe('outro-segredo', '{"id":3}', agora));
    await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"id":4}',
    });
    await tokens.send(tokenId, stripe(SECRET, '{"id":5}', agora));
    return tokenId;
  }

  test('deve levar o motivo de Métricas ao mesmo filtro exato que o de Saúde', async ({
    page,
    tokens,
  }) => {
    const tokenId = await comFalhas(tokens);
    await seedStorage(page, {});
    const saude = await abrirChecks(page, tokenId, 'Health');
    const mostrar = saude.getByRole('button', { name: 'Show health' });
    if ((await mostrar.count()) > 0 && (await mostrar.getAttribute('aria-expanded')) === 'false') {
      await mostrar.click();
    }
    const deSaude = await saude
      .getByRole('link', { name: /timestamp outside tolerance/ })
      .getAttribute('href');

    await page.goto(`/#/${tokenId}/insights`);
    const deMetricas = page
      .getByRole('region', { name: 'Signature', exact: true })
      .getByRole('link', {
        name: /^timestamp outside tolerance, 2 requests\. Open in the Inbox$/,
      });

    await expect(deMetricas).toHaveAttribute('href', /[?&]signatureReason=/);
    expect(await deMetricas.getAttribute('href')).toBe(deSaude);
  });

  test('deve mostrar na Entrada tantas requisições quantas o número dizia, e anunciar o filtro uma vez', async ({
    page,
    tokens,
  }) => {
    const tokenId = await comFalhas(tokens);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/insights`);
    const assinatura = page.getByRole('region', { name: 'Signature', exact: true });
    const links = assinatura.getByRole('link', { name: /, \d+ requests?\. Open in the Inbox$/ });
    await expect(links.first()).toBeVisible();
    const contagens = await links.evaluateAll((nos) =>
      nos.map((no) => ({
        nome: (no.getAttribute('aria-label') ?? no.textContent ?? '').replace(/\s+/g, ' ').trim(),
        href: no.getAttribute('href') ?? '',
      })),
    );
    expect(contagens.length, 'todo número que conta requisições é um link').toBeGreaterThanOrEqual(
      3,
    );

    for (const { nome, href } of contagens) {
      const n = Number(/, (\d+) requests?\. Open in the Inbox$/.exec(nome)![1]);
      await page.goto(href.replace(/^.*#/, '/#'));
      await expect(page.getByRole('heading', { name: `Requests (${n} of 5)` })).toBeVisible();
      await expect(itens(page), nome).toHaveCount(n);
    }

    await page.goto(`/#/${tokenId}/insights`);
    await limparAnuncios(page);
    await assinatura
      .getByRole('link', { name: /^timestamp outside tolerance, 2 requests\. Open in the Inbox$/ })
      .click();
    await expectUmAnuncio(
      page,
      /^Inbox\. Filtered by signature: timestamp outside tolerance\. 2 requests match/,
    );
    await expect(await chips(page, false)).toContainText('signature: timestamp outside tolerance');
  });

  test('deve levar cada linha de "Answers by status" à Entrada com o filtro daquele status', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_status: '429' });
    await gravarRegras(page.request, tokenId, [
      { name: 'Aceita', match: { path: { equals: '/aceita' } }, response: { status: 201 } },
    ]);
    await tokens.send(tokenId, { path: '/aceita' });
    await tokens.send(tokenId, { path: '/a' });
    await tokens.send(tokenId, { path: '/b' });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/insights`);

    await page
      .getByRole('region', { name: 'Answers by status' })
      .getByRole('link', { name: /^429 Too Many Requests · 2 · default response/ })
      .click();

    await expect(await chips(page, false)).toContainText('answered 429');
    await expect(itens(page)).toHaveCount(2);
  });
});

test.describe('Dado as horas de Métricas (UX-19)', () => {
  test.use({ timezoneId: 'America/Sao_Paulo' });

  test('deve mostrar a hora local, com o UTC no title, e dizer o fuso na legenda do gráfico', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/insights`);

    const porHora = page.getByRole('region', { name: 'Requests per hour' });
    await expect(porHora).toContainText('local time (UTC−3)');
    const hora = porHora
      .getByRole('table', { name: 'Requests per hour data' })
      .locator('tbody tr')
      .first()
      .locator('th, td')
      .first();
    // Por extenso e no fuso do navegador; o UTC fica no title.
    await expect(hora).not.toContainText(/\d{4}-\d{2}-\d{2}T|\bUTC\b|Z$/);
    await expect(hora.locator('xpath=descendant-or-self::*[@title]').first()).toHaveAttribute(
      'title',
      /UTC/,
    );
  });
});
