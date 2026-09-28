import { createHmac } from 'node:crypto';
import { IncomingHttpHeaders, Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Locator, Page } from '@playwright/test';
import { abrirChecks, escolherProvedor, secao, botaoSalvar } from './support/checks';
import { TokenTracker, expect, test } from './support/fixtures';
import { filtro, itens, abrirFiltros } from './support/inbox';
import { seedStorage } from './support/storage';

// Patamar, B3 (guia-combinacao §3.3 e §7; CA-6): os quatro botões Save dos cartões somem; salvar é o `button "Save
// changes"` da `region "Unsaved changes"`, que só aparece com alteração pendente e grava tudo num PUT só.

// Patamar, B1 (guia-combinacao §3.1 e §7): os chips ficam recolhidos atrás do `button "Filters"`; `abrirFiltros()`
// abre o painel antes de usar um chip.

// Item 14.1, fatia F2 (fidelidade ao protótipo C): Checks e Outbound. Cada teste cobre um item de
// `.docs-arquivo/fidelidade-prototipo/desvios.json` (decisão "corrigir") e respeita as Travas do 00-STATUS.
// SUPOSIÇÕES (nomes do protótipo C quando ele os tem; os demais marcados aqui):
// - CHECKS-01 (trava 6): a 1400×900, Health e Response ficam na coluna da direita, com ~400 px, e as colunas rolam por
//   dentro: a página de Checks cabe na altura da tela;
// - CHECKS-06: com um provedor salvo, o cabeçalho do cartão tem `button "Turn off"`, que escolhe "sem verificação"
//   (o Save signature manda `signature: null`);
// - CHECKS-11: o exemplo do header é o elemento com o nome "Example header", com cada parte num elemento próprio
//   (no Stripe, `t=…` e `v1=…`); a linha "Expected header: …" continua;
// - CHECKS-12 (trava 7): o formulário do provedor abre com o heading "{Provedor} settings" e "* required";
//   "Signature header" e "Secret" lado a lado; a ajuda da tolerância é "1 to 86400. Older or future timestamps are
//   rejected (replay protection).";
// - CHECKS-15: o editor do schema tem altura limitada (rola por dentro) e o cabeçalho diz "… of 64 KB · valid" (ou
//   "· invalid");
// - CHECKS-17: cada linha de motivo ou caminho do Health é um `link` com o motivo no nome e o texto "Show in Inbox":
//   "header … absent" → `#/{token}?signature=absent`, outros motivos → `?signature=invalid`, caminho de schema →
//   `?schema=invalid`; o rodapé diz "Click a line to see those requests in the Inbox.";
// - CHECKS-20: o subtítulo do Response diz "When no rule matches · N rules answer first", com o `link` "N rules
//   answer first" para `#/{token}/rules`;
// - OUTBOUND-01: `separator "Resize history and request"` entre o histórico e o trabalho, ajustável pelo teclado; a
//   página de Outbound cabe na altura da tela a 1400×900;
// - OUTBOUND-03: o histórico continua `table "Outbound history"`, com o alvo numa linha só;
// - OUTBOUND-05: o seletor da mensagem é `button "Request to replay: {#xxxxx}, {MÉTODO} {rota}. Change"`, e ao lado do
//   "Keep path" vai "Sends to {URL efetiva}";
// - OUTBOUND-07: o switch de assinar diz qual header entra ("Adds X-Hub-Signature-256 …"); Timeout e Send na linha do
//   Method; Headers e Body lado a lado;
// - OUTBOUND-08: no resultado, `button "Run again"` (repete o envio) e `button "Copy as curl"`;
// - OUTBOUND-09: o resultado tem as abas "Response body", "Response headers (n)" e "Sent headers (n)", e o meta diz
//   "Replay · #xxxxx" da mensagem de origem.

const SECRET = 'segredo-da-fidelidade';
const RECEIVER_HOST = process.env['E2E_RECEIVER_HOST'] ?? 'host.docker.internal';

interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

async function startReceiver(): Promise<{ url: string; received: Received[]; server: Server }> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(201, { 'Content-Type': 'application/json', 'X-Receptor': 'e2e' });
      res.end('{"recebido":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://${RECEIVER_HOST}:${port}`, received, server };
}

function github(secret: string, body: string) {
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    data: body,
  };
}

/** A página (o `main`) cabe na altura da janela? */
async function cabeNaAltura(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    return !!main && main.getBoundingClientRect().height <= window.innerHeight + 1;
  });
}

test.describe('Dado a página Checks a 1400×900 (CHECKS-01)', () => {
  test('deve pôr Health e Response numa coluna de ~400 px e caber na altura da tela', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: SECRET },
      schema: { type: 'object', required: ['id'] },
    });
    await abrirChecks(page, tokenId, 'Health');

    const health = (await secao(page, 'Health').boundingBox())!;
    const resposta = (await secao(page, 'Response').boundingBox())!;
    const assinatura = (await secao(page, 'Signature verification').boundingBox())!;
    expect(health.width).toBeGreaterThanOrEqual(380);
    expect(health.width).toBeLessThanOrEqual(420);
    expect(Math.round(resposta.x)).toBe(Math.round(health.x));
    expect(assinatura.x).toBeLessThan(health.x);
    expect(await cabeNaAltura(page), 'colunas rolam por dentro').toBe(true);
  });
});

test.describe('Dado o cartão Signature com um provedor salvo (CHECKS-06, 11, 12)', () => {
  test('deve desligar a verificação pelo "Turn off" do cabeçalho', async ({ page, tokens }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');

    await assinatura.getByRole('button', { name: 'Turn off' }).click();
    const put = page.waitForRequest(
      (sent) => sent.method() === 'PUT' && sent.url().endsWith(`/token/${tokenId}`),
    );
    await botaoSalvar(page).click();

    expect((await put).postDataJSON()).toMatchObject({ signature: null });
  });

  test('deve mostrar o header de exemplo em partes e o formulário do provedor com o título', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'stripe', secret: SECRET } });
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');

    const exemplo = assinatura.getByLabel('Example header');
    await expect(exemplo.getByText(/^t=\d+,?$/)).toBeVisible();
    await expect(exemplo.getByText(/^v1=[0-9a-f…]+$/)).toBeVisible();
    await expect(assinatura.getByText(/^Expected header:/)).toBeVisible();
    await expect(assinatura.getByRole('heading', { name: 'Stripe settings' })).toBeVisible();
    await expect(
      assinatura.getByText(
        '1 to 86400. Older or future timestamps are rejected (replay protection).',
      ),
    ).toBeVisible();

    await escolherProvedor(assinatura, 'Generic');
    await expect(assinatura.getByRole('heading', { name: 'Generic settings' })).toBeVisible();
    await expect(assinatura.getByText('* required')).toBeVisible();
    const header = (await assinatura
      .getByRole('textbox', { name: 'Signature header' })
      .boundingBox())!;
    const segredo = (await assinatura.getByLabel('Secret', { exact: true }).boundingBox())!;
    expect(Math.abs(header.y - segredo.y), 'Signature header e Secret lado a lado').toBeLessThan(8);
  });
});

test.describe('Dado o cartão Schema (CHECKS-15)', () => {
  test('deve limitar a altura do editor e dizer se o schema é válido', async ({ page, tokens }) => {
    const propriedades = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`campo${i}`, { type: 'string' }]),
    );
    const tokenId = await tokens.create({ schema: { type: 'object', properties: propriedades } });
    const schema = await abrirChecks(page, tokenId, 'Schema validation');

    await expect(schema.getByText(/of 64 KB · valid$/)).toBeVisible();
    const editor = (await schema.getByRole('textbox', { name: 'JSON Schema' }).boundingBox())!;
    expect(editor.height, 'editor com altura limitada').toBeLessThanOrEqual(300);

    await schema.getByRole('textbox', { name: 'JSON Schema' }).fill('{"type": ');
    await expect(schema.getByText(/of 64 KB · invalid$/)).toBeVisible();
  });
});

test.describe('Dado o Health com motivos e caminhos (CHECKS-17)', () => {
  async function urlComFalhas(page: Page, tokens: TokenTracker) {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: SECRET },
      schema: { type: 'object', properties: { id: { type: 'integer' } } },
    });
    await tokens.send(tokenId, github('outro-segredo', '{"id":1}'));
    await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"id":2}',
    });
    await tokens.send(tokenId, github(SECRET, '{"id":"3"}'));
    const health = await abrirChecks(page, tokenId, 'Health');
    await expect(health).toContainText('Click a line to see those requests in the Inbox.');
    return { tokenId, health };
  }

  const casos: [string, RegExp, string, string][] = [
    ['motivo de assinatura', /signature mismatch/, 'signature=invalid', 'Signature invalid'],
    ['header ausente', /header X-Hub-Signature-256 absent/, 'signature=absent', 'Signature absent'],
    ['caminho de schema', /\/id/, 'schema=invalid', 'Schema invalid'],
  ];
  for (const [caso, motivo, parametro, chip] of casos) {
    test(`deve abrir a Inbox filtrada Quando a linha do ${caso} é clicada`, async ({
      page,
      tokens,
    }) => {
      const { tokenId, health } = await urlComFalhas(page, tokens);
      const link = health.getByRole('link', { name: motivo });
      await expect(link).toContainText('Show in Inbox');
      // Decisões do Anzol, M1: o link leva também o motivo ou o caminho exato, num parâmetro a mais.
      await expect(link).toHaveAttribute('href', new RegExp(`#/${tokenId}\\?${parametro}(&|$)`));

      await link.click();

      // Na janela larga a Inbox abre a primeira mensagem que casa, e o filtro segue na rota.
      await expect(page).toHaveURL(
        new RegExp(`#/${tokenId}(/[0-9a-f-]{36}/\\d+)?\\?${parametro}(&|$)`),
      );
      await abrirFiltros(page);
      await expect(filtro(page, chip)).toHaveAttribute('aria-pressed', 'true');
      await expect(itens(page)).toHaveCount(1);
    });
  }
});

test.describe('Dado o cartão Response com regras (CHECKS-20)', () => {
  test('deve dizer quantas regras respondem antes e levar a Rules', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const put = await request.put(`/token/${tokenId}/rules`, {
      data: [
        { name: 'Um', response: { status: 201 } },
        { name: 'Dois', response: { status: 202 } },
      ],
    });
    expect(put.status()).toBe(200);
    const resposta = await abrirChecks(page, tokenId, 'Response');

    await expect(resposta).toContainText(/When no rule matches · 2 rules answer first/);
    await resposta.getByRole('link', { name: '2 rules answer first' }).click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules$`));
  });
});

test.describe('Dado a página Outbound', () => {
  let receiver: Awaited<ReturnType<typeof startReceiver>>;

  test.beforeEach(async () => {
    receiver = await startReceiver();
  });

  test.afterEach(async () => {
    await new Promise((resolve) => receiver.server.close(resolve));
  });

  async function replayFeito(page: Page, tokens: TokenTracker) {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, {
      path: '/pedidos?x=1',
      headers: { 'Content-Type': 'application/json' },
      data: '{"pedido":7}',
    });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/outbound?replay=${requestId}`);
    const replay = page.getByRole('region', { name: 'Replay request' });
    await expect(replay).toBeVisible();
    return { tokenId, requestId, replay };
  }

  test('deve ter o separador ajustável e caber na altura da tela (OUTBOUND-01)', async ({
    page,
    tokens,
  }) => {
    await replayFeito(page, tokens);
    const separador = page.getByRole('separator', { name: 'Resize history and request' });
    const antes = Number(await separador.getAttribute('aria-valuenow'));

    await separador.focus();
    await page.keyboard.press('ArrowRight');

    await expect(separador).not.toHaveAttribute('aria-valuenow', String(antes));
    expect(await cabeNaAltura(page)).toBe(true);
  });

  test('deve mostrar a mensagem escolhida como botão e a URL efetiva (OUTBOUND-05)', async ({
    page,
    tokens,
  }) => {
    const { requestId, replay } = await replayFeito(page, tokens);

    await expect(
      replay.getByRole('button', {
        name: `Request to replay: #${requestId.substring(0, 5)}, POST /pedidos?x=1. Change`,
      }),
    ).toBeVisible();
    await replay.getByRole('textbox', { name: 'Target URL' }).fill('http://destino.example/app');
    await expect(replay.getByText('Sends to http://destino.example/app/pedidos?x=1')).toBeVisible();
  });

  test('deve repetir pelo "Run again", copiar como curl e mostrar o resultado em abas (OUTBOUND-03, 08, 09)', async ({
    page,
    tokens,
  }) => {
    const { requestId, replay } = await replayFeito(page, tokens);
    await replay.getByRole('textbox', { name: 'Target URL' }).fill(`${receiver.url}/app`);
    await replay.getByRole('button', { name: 'Replay', exact: true }).click();
    const detail = page.getByRole('region', { name: 'Outbound detail' });
    await expect(detail.getByText('201', { exact: true })).toBeVisible();

    await expect(detail).toContainText(`Replay · #${requestId.substring(0, 5)}`);
    await expect(detail.getByRole('tab', { name: 'Response body' })).toBeVisible();
    await expect(detail.getByRole('tab', { name: /^Response headers \(\d+\)$/ })).toBeVisible();
    await expect(detail.getByRole('tab', { name: /^Sent headers \(\d+\)$/ })).toBeVisible();

    await detail.getByRole('button', { name: 'Copy as curl' }).click();
    const curl = await page.evaluate(() => navigator.clipboard.readText());
    expect(curl).toMatch(/^curl /);
    expect(curl).toContain(`${receiver.url}/app/pedidos?x=1`);

    await detail.getByRole('button', { name: 'Run again' }).click();
    await expect.poll(() => receiver.received.length).toBe(2);
    const linhas = page.getByRole('table', { name: 'Outbound history' }).locator('tbody tr');
    await expect(linhas).toHaveCount(2);
    expect((await linhas.first().boundingBox())!.height, 'alvo numa linha só').toBeLessThanOrEqual(
      64,
    );
  });

  test('deve dizer qual header a assinatura acrescenta e alinhar o compositor Send (OUTBOUND-07)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/outbound?send=new`);
    const send: Locator = page.getByRole('region', { name: 'Send request' });
    await expect(send).toBeVisible();

    await expect(send).toContainText(/Adds X-Hub-Signature-256/);
    const metodo = (await send.getByRole('combobox', { name: 'Method' }).boundingBox())!;
    const enviar = (await send.getByRole('button', { name: 'Send', exact: true }).boundingBox())!;
    expect(Math.abs(enviar.y + enviar.height / 2 - (metodo.y + metodo.height / 2))).toBeLessThan(
      24,
    );
    await send.getByRole('button', { name: 'Add header' }).click();
    const nome = (await send.getByRole('textbox', { name: 'Header 1 name' }).boundingBox())!;
    const corpo = (await send.getByRole('textbox', { name: 'Body' }).boundingBox())!;
    expect(corpo.x, 'Body ao lado dos Headers').toBeGreaterThan(nome.x + nome.width);
  });
});
