import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { Webhook, expect, test } from './support/fixtures';
import {
  aba,
  abrirAba,
  abrirMensagem,
  acoes,
  busca,
  campoDeBusca,
  corpo,
  item,
  itens,
  lista,
  porque,
  verificacoes,
} from './support/inbox';
import { seedStorage } from './support/storage';

// Item 14.1, fase 2, fatia F1-2 (fidelidade ao protótipo C): os itens "discutir" da Inbox e do Compare que o dono
// decidiu adotar (`.docs-arquivo/fidelidade-prototipo/discutir-decididos.json`), com o ajuste do `porque` quando é
// "adotar-adaptado". Tipografia, cor, raio e espaçamento (INBOX-12/27/28, o painel e a altura da busca) ficam para a
// regressão visual. SUPOSIÇÕES (os textos do protótipo C quando ele os tem; os demais marcados aqui):
// - INBOX-05: o botão de copiar do cabeçalho da URL só tem ícone e continua com o nome "Copy";
// - INBOX-07: "N unread" fica ao lado do heading "Requests (…)", fora dele;
// - INBOX-08: placeholder "Search path, IP, header or body" e o `kbd` "/" dentro da busca;
// - INBOX-10: a linha de status só aparece com filtro: "N requests match · search runs on the server over all M" (no
//   singular, "1 request matches · …"); "Copy as anzol wait-for" continua à vista sem filtro (trava 11);
// - INBOX-13: o selo da lista diz o provedor ("GitHub") na assinatura válida, "Mismatch", "Stale timestamp" ou "No
//   signature" na inválida; "Schema", "Not JSON" ou "N schema error(s)" no schema; "{status} · {regra}" ou "Near
//   miss" na regra. Cada selo é um `app-check-chip` com `data-kind`;
// - INBOX-14: o item recém-chegado mostra a pílula "NEW";
// - INBOX-15: o aviso de chegada diz "Request received · {MÉTODO} {rota}" com a ação "View";
// - INBOX-16: "Previous page" e "Next page" sempre no rodapé; sem página, `aria-disabled="true"` e focáveis;
// - INBOX-18: o cartão da regra diz "Answered by rule · {status}"; no near miss com uma condição, a frase dela vai
//   no cartão ("Closest: {regra} · {condição}") e o "Why? (n)" só aparece com mais de uma; o cartão do schema diz o
//   dialeto do `$schema` ("2020-12"); o da assinatura Stripe diz "signed N s before arrival";
// - INBOX-19: rótulo visível curto ("Create rule"), com o nome acessível de hoje ("Create rule from this request");
//   Replay…, Create rule e Copy payload numa linha só a 1400 px;
// - INBOX-20: o menu "More" do detalhe tem `menuitem "Delete request"`, com o Undo de hoje;
// - INBOX-21: a aba Body mostra o tamanho ("36 B") ou "empty"; o switch "Pretty" fica na linha das abas;
// - INBOX-23: acima do corpo, a nota "N schema error(s) marked below · Open schema", com o link "Open schema" para
//   `#/{token}/checks?section=schema`;
// - INBOX-24: a tabela Headers tem os `columnheader` "Name" e "Value (as recorded)"; a linha da assinatura tem o
//   título "Verified signature header" (válida) ou "Expected header missing" (ausente) e o link "How {Provedor}
//   signatures are checked" para `#/{token}/checks?section=signature`;
// - INBOX-25: o estado vazio do filtro diz "No requests match these filters" e tem o único "Clear filters" à vista;
// - INBOX-26: corpo vazio em estado vazio ("No body content" + "A {MÉTODO} with an empty body.", e com schema
//   ligado "The schema check records it as “body is not JSON”."); Query e Form vazios com "No query string" e "No
//   form values";
// - INBOX-32/34 (390 px): o item não mostra o IP e esconde o selo de schema válido (fica o de assinatura e qualquer
//   selo com problema); acima da lista, a linha "N requests · newest first", com o heading "Requests (…)" no DOM;
// - Compare, RULES-29: "Only differences" ligado por padrão; RULES-33: a nota "N identical header(s) hidden" (ou "All
//   N headers" com o switch desligado); RULES-31: o ruído ("N difference(s) change(s) on every delivery") e "N other
//   difference(s)" recolhidos por padrão, abrindo pelo título; RULES-32: a seção com o heading "Request line", a nota
//   "method, path and query are the same" e os chips "Method POST", "Path /…" (sem o token) e "No query"; RULES-34:
//   as colunas do corpo "A · {type}" / "B · {type}" e a linha "⋯ N unchanged lines" como `button "N unchanged lines
//   hidden. Show them"`, que desliga o "Only differences".

const SECRET = 'segredo-da-fidelidade-2';
const IPV4 = /\b\d{1,3}(\.\d{1,3}){3}\b/;

function github(secret: string | null, body: string): Webhook {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) {
    headers['X-Hub-Signature-256'] =
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }
  return { headers, data: body };
}

function stripe(secret: string, body: string, t: number): Webhook {
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return {
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
    data: body,
  };
}

function json(body: string, headers: Record<string, string> = {}): Webhook {
  return { headers: { 'Content-Type': 'application/json', ...headers }, data: body };
}

/** O selo de uma verificação no item da lista. */
function selo(page: Page, uuid: string, tipo: 'signature' | 'schema' | 'rule'): Locator {
  return item(page, uuid).locator(`app-check-chip[data-kind="${tipo}"]`);
}

/** Texto visível de um botão, sem o ícone. */
function rotuloVisivel(botao: Locator): Promise<string> {
  return botao.evaluate((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
}

async function mesmaLinha(a: Locator, b: Locator): Promise<boolean> {
  const [ca, cb] = [await a.boundingBox(), await b.boundingBox()];
  return !!ca && !!cb && Math.abs(ca.y + ca.height / 2 - (cb.y + cb.height / 2)) <= 4;
}

test.describe('Dado o cabeçalho da URL e da lista (INBOX-05/07/08)', () => {
  test('deve ter o copiar só com ícone, "N unread" ao lado do heading e a busca com o atalho "/"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const lida = await tokens.send(tokenId, { data: 'um' });
    const dois = await tokens.send(tokenId, { data: 'dois' });
    const tres = await tokens.send(tokenId, { data: 'três' });
    // "Não lida" é o que chegou pelo SSE com a tela aberta (chave `unread`, por URL): semeada aqui.
    await seedStorage(page, { unread: JSON.stringify({ [tokenId]: [lida, dois, tres] }) });
    await abrirMensagem(page, tokenId, lida);

    const copiar = page.getByRole('button', { name: 'Copy', exact: true });
    await expect(copiar).toBeVisible();
    expect(await rotuloVisivel(copiar)).toBe('');

    const heading = lista(page).getByRole('heading', { name: /^Requests \(/ });
    await expect(heading).toHaveText(/^Requests \(3( \/ \d+)?\)$/);
    await expect(lista(page).getByText('2 unread', { exact: true })).toBeVisible();

    await expect(campoDeBusca(page)).toHaveAttribute(
      'placeholder',
      'Search path, IP, header or body',
    );
    await expect(busca(page).locator('kbd')).toHaveText('/');
  });
});

test.describe('Dado a busca com e sem filtro (INBOX-10/25)', () => {
  test('deve mostrar a linha de status só com filtro e o "Clear filters" dentro do estado vazio', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedido-1', data: 'a' });
    await tokens.send(tokenId, { path: '/pedido-2', data: 'b' });
    await tokens.send(tokenId, { path: '/outro', data: 'c' });
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(3);

    const status = busca(page).getByText(/match(es)? · search runs on the server/);
    await expect(status).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy as anzol wait-for' })).toBeVisible();

    await campoDeBusca(page).fill('pedido');
    await expect(itens(page)).toHaveCount(2);
    await expect(status).toHaveText('2 requests match · search runs on the server over all 3');
    await expect(page.getByRole('button', { name: 'Copy as anzol wait-for' })).toBeVisible();

    await campoDeBusca(page).fill('nada-casa-com-isto');
    await expect(page.getByText('No requests match these filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(itens(page)).toHaveCount(3);
    await expect(campoDeBusca(page)).toHaveValue('');
  });
});

test.describe('Dado os selos da lista (INBOX-13)', () => {
  test('deve dizer o provedor ou o motivo na assinatura e contar os erros de schema', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: SECRET },
      schema: { type: 'object', required: ['id', 'nome'] },
    });
    await request.put(`/token/${tokenId}/rules`, {
      data: [{ name: 'Pix', match: { path: { equals: '/pix' } }, response: { status: 201 } }],
    });
    const certa = await tokens.send(tokenId, github(SECRET, '{"id":1,"nome":"a"}'));
    const errada = await tokens.send(tokenId, github('outro', '{}'));
    const sem = await tokens.send(tokenId, { method: 'GET' });
    const pix = await tokens.send(tokenId, { ...github(SECRET, '{"id":2}'), path: '/pix' });
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(4);

    // O que passou é só o ícone, com o veredito no title; o texto vai para o que pede atenção.
    await expect(selo(page, certa, 'signature')).toHaveText('');
    await expect(selo(page, certa, 'signature')).toHaveAttribute(
      'title',
      'Signature valid: GitHub',
    );
    await expect(selo(page, errada, 'signature')).toHaveText('Mismatch');
    await expect(selo(page, sem, 'signature')).toHaveText('No signature');
    await expect(selo(page, certa, 'schema')).toHaveText('');
    await expect(selo(page, certa, 'schema')).toHaveAttribute('title', /^Schema valid/);
    await expect(selo(page, errada, 'schema')).toHaveText('2 schema errors');
    await expect(selo(page, pix, 'schema')).toHaveText('1 schema error');
    await expect(selo(page, sem, 'schema')).toHaveText('Not JSON');
    await expect(selo(page, pix, 'rule')).toHaveText('201 · Pix');
  });

  test('deve dizer "Stale timestamp" na assinatura Stripe fora da tolerância', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'stripe', secret: SECRET } });
    const velha = await tokens.send(
      tokenId,
      stripe(SECRET, '{"type":"x"}', Math.floor(Date.now() / 1000) - 1000),
    );
    await page.goto(`/#/${tokenId}`);
    await expect(selo(page, velha, 'signature')).toHaveText('Stale timestamp');
  });
});

test.describe('Dado uma mensagem que chega com a tela aberta (INBOX-14/15)', () => {
  test('deve marcar a nova com "NEW" e dizer o método e a rota no aviso de chegada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/primeira', data: 'x' });
    const stream = page.waitForResponse((r) => r.url().endsWith(`/token/${tokenId}/stream`));
    await page.goto(`/#/${tokenId}`);
    await stream;
    await expect(itens(page)).toHaveCount(1);

    const nova = await tokens.send(tokenId, { path: '/nova', data: 'y' });
    await expect(item(page, nova)).toContainText('NEW');

    // Com filtro, a chegada não fica à vista e o aviso aparece.
    await campoDeBusca(page).fill('nao-casa');
    await expect(itens(page)).toHaveCount(0);
    await tokens.send(tokenId, { path: '/pedidos', data: 'z' });
    const aviso = page.locator('.mat-mdc-snack-bar-container');
    await expect(aviso).toContainText('Request received · POST /pedidos');
    await expect(aviso.getByRole('button', { name: 'View' })).toBeVisible();
  });
});

test.describe('Dado uma página só de mensagens (INBOX-16)', () => {
  test('deve manter "Previous page" e "Next page" no rodapé, desabilitados e focáveis', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { data: 'a' });
    await tokens.send(tokenId, { data: 'b' });
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByText('1–2 of 2', { exact: true })).toBeVisible();

    for (const nome of ['Previous page', 'Next page']) {
      const botao = page.getByRole('button', { name: nome, exact: true });
      await expect(botao).toHaveAttribute('aria-disabled', 'true');
      await botao.focus();
      await expect(botao).toBeFocused();
    }
  });
});

test.describe('Dado os cartões de verificação do detalhe (INBOX-18)', () => {
  test('deve dizer o status da regra, a condição do near miss no cartão e o dialeto do schema', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
    });
    await request.put(`/token/${tokenId}/rules`, {
      data: [
        {
          name: 'Pix',
          match: { method: ['POST'], path: { equals: '/pix' } },
          response: { status: 201 },
        },
      ],
    });
    const respondida = await tokens.send(tokenId, { ...json('{}'), path: '/pix' });
    const perto = await tokens.send(tokenId, { ...json('{}'), method: 'PUT', path: '/pix' });

    await abrirMensagem(page, tokenId, respondida);
    await expect(verificacoes(page)).toContainText(/Answered 201 · by rule\s*Pix/);
    await expect(verificacoes(page)).toContainText(/Schema valid\s*.*2020-12/);

    await abrirMensagem(page, tokenId, perto);
    await expect(verificacoes(page)).toContainText(
      /No rule matched\. The closest is “Pix” — method: expected POST, got PUT/,
    );
    await expect(porque(page)).toHaveCount(0);
  });

  test('deve dizer há quanto tempo a assinatura Stripe foi feita', async ({ page, tokens }) => {
    const tokenId = await tokens.create({ signature: { provider: 'stripe', secret: SECRET } });
    const certa = await tokens.send(
      tokenId,
      stripe(SECRET, '{"type":"x"}', Math.floor(Date.now() / 1000)),
    );
    await abrirMensagem(page, tokenId, certa);
    await expect(verificacoes(page)).toContainText(
      /Signature valid\s*Stripe\b.*signed \d+ s before arrival/,
    );
  });
});

test.describe('Dado a barra de ações e o menu More do detalhe (INBOX-19/20)', () => {
  test('deve mostrar rótulos curtos numa linha e apagar a mensagem pelo menu More', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const fica = await tokens.send(tokenId, json('{"a":1}'));
    const apaga = await tokens.send(tokenId, json('{"a":2}'));
    await abrirMensagem(page, tokenId, apaga);

    const criar = acoes(page).getByRole('button', { name: 'Create rule from this request' });
    expect(await rotuloVisivel(criar)).toBe('Create rule');
    const replay = acoes(page).getByRole('button', { name: 'Replay…' });
    const copiar = acoes(page).getByRole('button', { name: 'Copy payload' });
    expect(await mesmaLinha(replay, criar)).toBe(true);
    expect(await mesmaLinha(criar, copiar)).toBe(true);

    await page.getByRole('button', { name: /^More(:|$)/ }).click();
    await page.getByRole('menuitem', { name: 'Delete request' }).click();
    await expect(item(page, apaga)).toHaveCount(0);
    await expect(item(page, fica)).toBeVisible();
    await expect
      .poll(async () => (await tokens.listed(tokenId)).map((r) => r.uuid))
      .toEqual([fica]);
  });
});

test.describe('Dado as abas do detalhe (INBOX-21/26)', () => {
  test('deve mostrar o tamanho na aba Body, o Pretty na linha das abas e estados vazios', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ schema: { type: 'object' } });
    const cheia = await tokens.send(tokenId, json('{"pedido":"ped-42","valor":10}'));
    const vazia = await tokens.send(tokenId, { method: 'GET' });
    await seedStorage(page, { formatJsonEnable: 'true' });

    await abrirMensagem(page, tokenId, cheia);
    await expect(aba(page, 'Body')).toContainText('30 B');
    const pretty = page.getByRole('switch', { name: 'Pretty', exact: true });
    // Só a do detalhe (o onboarding também tem uma `tablist`).
    const abas = page
      .getByRole('region', { name: 'Request detail' })
      .getByRole('tablist')
      .filter({ has: aba(page, 'Body') });
    expect(await mesmaLinha(pretty, abas)).toBe(true);

    await abrirMensagem(page, tokenId, vazia);
    await expect(aba(page, 'Body')).toContainText('empty');
    await expect(page.getByText('No body content', { exact: true })).toBeVisible();
    await expect(page.getByText(/^A GET with an empty body\./)).toContainText(
      'The schema check records it as “body is not JSON”.',
    );
    await expect(corpo(page)).toHaveCount(0);
    await abrirAba(page, 'Query');
    await expect(page.getByText('No query string', { exact: true })).toBeVisible();
    await abrirAba(page, 'Form');
    await expect(page.getByText('No form values', { exact: true })).toBeVisible();
  });
});

test.describe('Dado um corpo com erros de schema (INBOX-23)', () => {
  test('deve avisar acima do corpo quantos erros estão marcados, com o link para o schema', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      schema: {
        type: 'object',
        properties: { id: { type: 'integer' }, nome: { type: 'string' } },
      },
    });
    const errada = await tokens.send(tokenId, json('{"id":"x","nome":1}'));
    await abrirMensagem(page, tokenId, errada);

    await expect(page.getByText(/^2 schema errors marked below · Open schema$/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open schema' })).toHaveAttribute(
      'href',
      `#/${tokenId}/checks?section=schema`,
    );
  });
});

test.describe('Dado a tabela de headers com a assinatura (INBOX-24)', () => {
  test('deve ter o cabeçalho das colunas, o título da nota e o link para Checks', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const certa = await tokens.send(tokenId, github(SECRET, '{"a":1}'));
    const sem = await tokens.send(tokenId, github(null, '{"a":1}'));

    await abrirMensagem(page, tokenId, certa);
    await abrirAba(page, 'Headers');
    const tabela = page.getByRole('table', { name: 'Headers' });
    await expect(tabela.getByRole('columnheader', { name: 'Name', exact: true })).toBeVisible();
    await expect(
      tabela.getByRole('columnheader', { name: 'Value (as recorded)', exact: true }),
    ).toBeVisible();
    const linha = tabela.getByRole('row', { name: /^x-hub-signature-256 / });
    await expect(linha).toContainText('Verified signature header');
    await expect(
      linha.getByRole('link', { name: 'How GitHub signatures are checked' }),
    ).toHaveAttribute('href', `#/${tokenId}/checks?section=signature`);

    await abrirMensagem(page, tokenId, sem);
    await abrirAba(page, 'Headers');
    await expect(
      page.getByRole('table', { name: 'Headers' }).locator('tbody tr').first(),
    ).toContainText(/\(not received\)[\s\S]*Expected header missing/);
  });
});

test.describe('Dado a lista no celular a 390×844 (INBOX-32/34)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('deve mostrar a contagem e a ordem acima da lista, e itens sem IP nem selo de schema válido', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: SECRET },
      schema: { type: 'object', required: ['id'] },
    });
    const valida = await tokens.send(tokenId, github(SECRET, '{"id":1}'));
    const invalida = await tokens.send(tokenId, github(SECRET, '{}'));
    await page.goto(`/#/${tokenId}`);

    await expect(page.getByText('2 requests · newest first', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Requests \(2( \/ \d+)?\)$/ })).toBeAttached();

    await expect(item(page, valida)).toBeVisible();
    expect(await item(page, valida).innerText()).not.toMatch(IPV4);
    await expect(selo(page, valida, 'signature')).toBeVisible();
    await expect(selo(page, valida, 'schema')).toBeHidden();
    await expect(selo(page, invalida, 'schema')).toBeVisible();
  });
});

/** A seção do Compare com o heading `nome`. */
function secaoDoCompare(view: Locator, nome: string | RegExp): Locator {
  return view.locator('section', { has: view.page().getByRole('heading', { name: nome }) });
}

test.describe('Dado o Compare aberto pela rota (RULES-29/31/32/33/34)', () => {
  test('deve abrir só com as diferenças, contar os headers iguais e resumir a linha da requisição', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const a = await tokens.send(tokenId, {
      ...json('{"type":"pedido.criado","id":1}', { 'X-Lado': 'a' }),
      path: '/pedidos',
    });
    const b = await tokens.send(tokenId, {
      ...json('{"type":"pedido.pago","id":1}', { 'X-Lado': 'b' }),
      path: '/pedidos',
    });
    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);
    const view = page.getByRole('region', { name: 'Compare requests' });

    const so = view.getByRole('switch', { name: 'Only differences' });
    await expect(so).toBeChecked();
    await expect(view.getByText(/^\d+ identical headers? hidden$/)).toBeVisible();
    await so.setChecked(false);
    await expect(view.getByText(/^All \d+ headers$/)).toBeVisible();

    const linha = secaoDoCompare(view, 'Request line');
    await expect(linha).toContainText('method, path and query are the same');
    await expect(linha).toContainText('Method POST');
    await expect(linha).toContainText('Path /pedidos');
    await expect(linha).toContainText('No query');
    await expect(linha).not.toContainText(tokenId);
    await expect(view.getByRole('table', { name: 'Request' })).toHaveCount(0);
  });

  test('deve recolher o ruído e as outras diferenças, deixando à vista o que explica o desfecho', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const corpoJson = '{"action":"opened"}';
    const assinada = (segredo: string, entrega: string, lado: string) => {
      const webhook = github(segredo, corpoJson);
      return {
        ...webhook,
        headers: { ...webhook.headers, 'X-GitHub-Delivery': entrega, 'X-Lado': lado },
      };
    };
    const a = await tokens.send(tokenId, assinada('outro', 'entrega-a', 'a'));
    const b = await tokens.send(tokenId, assinada(SECRET, 'entrega-b', 'b'));
    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);
    const view = page.getByRole('region', { name: 'Compare requests' });

    await expect(view.getByText(/signature mismatch/).first()).toBeVisible();
    for (const titulo of [
      /\d+ differences? changes?\s+on every delivery/,
      /\d+ other differences?/,
    ]) {
      // A mais interna que contém o título (a região do Compare também é uma `section`).
      const secao = view
        .locator('section, details')
        .filter({ has: page.getByText(titulo) })
        .last();
      // Com o `details` fechado, os itens saem da árvore de acessibilidade: conta pelo `li`.
      await expect(secao.locator('li')).not.toHaveCount(0);
      await expect(secao.locator('li').first()).toBeHidden();
      await secao.getByText(titulo).click();
      await expect(secao.getByRole('listitem').first()).toBeVisible();
    }
  });

  test('deve pôr o tipo do evento nas colunas do corpo e mostrar as linhas iguais pelo botão', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const comum = '"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7';
    const a = await tokens.send(tokenId, json(`{${comum},"type":"pedido.criado"}`));
    const b = await tokens.send(tokenId, json(`{${comum},"type":"pedido.pago"}`));
    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);
    const view = page.getByRole('region', { name: 'Compare requests' });

    const tabela = view.getByRole('table', { name: 'Body' });
    await expect(tabela.getByRole('columnheader', { name: 'A · pedido.criado' })).toBeVisible();
    await expect(tabela.getByRole('columnheader', { name: 'B · pedido.pago' })).toBeVisible();
    await expect(tabela).not.toContainText('"d": 4');
    // Um botão por trecho recolhido (acima e abaixo da linha que mudou).
    const recolhidas = tabela.getByRole('button', {
      name: /^\d+ unchanged lines? hidden\. Show them$/,
    });
    await expect(recolhidas).not.toHaveCount(0);
    await recolhidas.first().click();
    await expect(view.getByRole('switch', { name: 'Only differences' })).not.toBeChecked();
    await expect(tabela).toContainText('"d": 4');
  });
});
