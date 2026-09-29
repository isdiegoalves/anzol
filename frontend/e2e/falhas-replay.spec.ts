import { Server, createServer } from 'node:http';
import {
  AddressInfo,
  Server as ServidorTcp,
  Socket,
  createServer as createTcpServer,
} from 'node:net';
import { Locator, Page } from '@playwright/test';
import { escutarAnuncios, expectSoEstaFala, limparAnuncios } from './support/anuncios';
import { TokenTracker, expect, test } from './support/fixtures';
import { abrirMensagem, acoes } from './support/inbox';
import { compacto } from './support/shell';
import { seedStorage } from './support/storage';

const RECEIVER_HOST = process.env['E2E_RECEIVER_HOST'] ?? 'host.docker.internal';

/** Receptor HTTP no host: responde 201 com um JSON e guarda o que chegou. */
async function receptor(): Promise<{ porta: number; recebidas: string[]; server: Server }> {
  const recebidas: string[] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      recebidas.push(`${req.method} ${req.url}`);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end('{"recebido":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  return { porta: (server.address() as AddressInfo).port, recebidas, server };
}

/** Receptor TCP que só lê e nunca responde. */
async function receptorMudo(): Promise<{ porta: number; server: ServidorTcp; sockets: Socket[] }> {
  const sockets: Socket[] = [];
  const server = createTcpServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => undefined);
    socket.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  return { porta: (server.address() as AddressInfo).port, server, sockets };
}

function painel(page: Page): Locator {
  return compacto(page)
    ? page.getByRole('dialog', { name: 'Actions on this request' })
    : page.getByRole('region', { name: 'Action panel' });
}

function resultado(page: Page): Locator {
  return painel(page).getByRole('group', { name: 'Action result' }).locator('[role="status"]');
}

function falhasAInjetar(page: Page): Locator {
  return painel(page).getByRole('group', { name: 'Failures to inject' });
}

async function pedido(tokens: TokenTracker, tokenId: string): Promise<string> {
  return tokens.send(tokenId, {
    path: '/pedidos',
    headers: { 'Content-Type': 'application/json' },
    data: '{"id":"evt_ped48001","status":"pago"}',
  });
}

/** Abre a mensagem, o Replay do painel e preenche o destino. */
async function abrirReplay(
  page: Page,
  tokenId: string,
  id: string,
  destino: string,
): Promise<void> {
  await seedStorage(page, {});
  await abrirMensagem(page, tokenId, id);
  await acoes(page).getByRole('button', { name: 'Replay…' }).click();
  await painel(page).getByRole('textbox', { name: 'Target URL' }).fill(destino);
}

test.describe('Dado a aba Replay do painel com "Inject failure"', () => {
  let destino: Awaited<ReturnType<typeof receptor>>;

  test.beforeEach(async () => {
    destino = await receptor();
  });

  test.afterEach(async () => {
    await new Promise((resolve) => destino.server.close(resolve));
  });

  test('deve vir desligado e reenviar sem caos enquanto estiver desligado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await abrirReplay(page, tokenId, id, `${RECEIVER_HOST}:${destino.porta}/webhooks`);

    const chave = painel(page).getByRole('switch', { name: 'Inject failure' });
    await expect(chave).not.toBeChecked();
    await expect(falhasAInjetar(page)).toBeHidden();
    const enviado = page.waitForRequest((r) => r.url().endsWith(`/request/${id}/replay`));
    await painel(page).getByRole('button', { name: 'Replay', exact: true }).click();

    expect((await enviado).postDataJSON()).not.toHaveProperty('chaos');
    await expect(resultado(page)).toContainText(/^Replay result: 201 Created in \d+ ms/);
    await expect(resultado(page)).not.toContainText('Injected');
  });

  test('deve reenviar com atraso e em dobro, dizer o que foi injetado e anunciar uma vez', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await escutarAnuncios(page);
    await abrirReplay(page, tokenId, id, `${RECEIVER_HOST}:${destino.porta}/webhooks`);

    await painel(page).getByRole('switch', { name: 'Inject failure' }).click();
    const falhas = falhasAInjetar(page);
    await expect(falhas).toBeVisible();
    await falhas.getByRole('spinbutton', { name: 'Delay before sending (ms)' }).fill('300');
    await falhas.getByRole('checkbox', { name: 'Send twice' }).check();
    await limparAnuncios(page);
    const enviado = page.waitForRequest((r) => r.url().endsWith(`/request/${id}/replay`));
    await painel(page).getByRole('button', { name: 'Replay', exact: true }).click();

    expect((await enviado).postDataJSON()).toMatchObject({
      chaos: { delay_ms: 300, duplicate: true },
    });
    const texto =
      /^Replay result: 201 Created in \d+ ms\. Injected: delay 300 ms, sent twice \(second: 201 Created\)\./;
    await expect(resultado(page)).toContainText(texto);
    await expectSoEstaFala(page, texto, /^Action result$/);
    expect(destino.recebidas).toEqual(['POST /webhooks/pedidos', 'POST /webhooks/pedidos']);
  });

  test('deve oferecer corpo lento e desistência, e desabilitar o corte numa requisição sem corpo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, { method: 'GET', path: '/status' });
    await abrirReplay(page, tokenId, id, `${RECEIVER_HOST}:${destino.porta}`);

    await painel(page).getByRole('switch', { name: 'Inject failure' }).click();
    const falhas = falhasAInjetar(page);
    await expect(falhas.getByRole('spinbutton', { name: 'Slow body (bytes/s)' })).toBeVisible();
    await expect(falhas.getByRole('spinbutton', { name: 'Give up after (ms)' })).toBeVisible();
    await expect(falhas.getByRole('checkbox', { name: 'Cut the body in half' })).toBeDisabled();
    await expect(falhas).toContainText('This request has no body.');
  });

  test('deve mostrar em pt-BR o switch e as falhas a injetar', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, { language: '"pt-BR"' });
    await page.goto(`/#/${tokenId}/${id}/1`);
    await page
      .getByRole('toolbar', { name: 'Ações da requisição' })
      .getByRole('button', { name: 'Reenviar…' })
      .click();
    const painelPt = compacto(page)
      ? page.getByRole('dialog', { name: 'Ações sobre esta requisição' })
      : page.getByRole('region', { name: 'Painel de ação' });

    await painelPt.getByRole('switch', { name: 'Injetar falha' }).click();
    const falhas = painelPt.getByRole('group', { name: 'Falhas a injetar' });
    await expect(
      falhas.getByRole('spinbutton', { name: 'Atraso antes de enviar (ms)' }),
    ).toBeVisible();
    await expect(falhas.getByRole('checkbox', { name: 'Enviar duas vezes' })).toBeVisible();
    await expect(falhas.getByRole('checkbox', { name: 'Cortar o corpo ao meio' })).toBeVisible();
    await expect(falhas.getByRole('spinbutton', { name: 'Corpo lento (bytes/s)' })).toBeVisible();
    await expect(falhas.getByRole('spinbutton', { name: 'Desistir depois de (ms)' })).toBeVisible();
  });
});

test.describe('Dado um receptor que lê e não responde', () => {
  let mudo: Awaited<ReturnType<typeof receptorMudo>>;

  test.beforeEach(async () => {
    mudo = await receptorMudo();
  });

  test.afterEach(async () => {
    for (const socket of mudo.sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => mudo.server.close(resolve));
  });

  test('deve dizer que não leu resposta quando o corpo é cortado ao meio', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await abrirReplay(page, tokenId, id, `${RECEIVER_HOST}:${mudo.porta}`);

    await painel(page).getByRole('switch', { name: 'Inject failure' }).click();
    await falhasAInjetar(page).getByRole('checkbox', { name: 'Cut the body in half' }).check();
    await painel(page).getByRole('button', { name: 'Replay', exact: true }).click();

    await expect(resultado(page)).toContainText(
      /^Replay result: no answer read\. Injected: body cut after \d+ bytes\./,
    );
  });
});

test.describe('Dado um replay com caos feito pela API', () => {
  let destino: Awaited<ReturnType<typeof receptor>>;

  test.beforeEach(async () => {
    destino = await receptor();
  });

  test.afterEach(async () => {
    await new Promise((resolve) => destino.server.close(resolve));
  });

  test('deve mostrar no detalhe da página Outbound o que foi injetado', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    const resposta = await request.post(`/token/${tokenId}/request/${id}/replay`, {
      data: { url: `http://${RECEIVER_HOST}:${destino.porta}`, chaos: { delay_ms: 200 } },
    });
    expect(resposta.status(), await resposta.text()).toBe(200);

    await page.goto(`/#/${tokenId}/outbound`);

    await expect(page.getByRole('region', { name: 'Outbound detail' })).toContainText(
      'Injected: delay 200 ms',
    );
  });

  test('deve repetir com o mesmo caos Quando "Run again" é clicado no histórico', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    const resposta = await request.post(`/token/${tokenId}/request/${id}/replay`, {
      data: {
        url: `http://${RECEIVER_HOST}:${destino.porta}`,
        chaos: { delay_ms: 200, duplicate: true },
      },
    });
    expect(resposta.status(), await resposta.text()).toBe(200);
    await page.goto(`/#/${tokenId}/outbound`);
    const detalhe = page.getByRole('region', { name: 'Outbound detail' });
    await expect(detalhe).toContainText('Injected: delay 200 ms');

    const enviado = page.waitForRequest((r) => r.url().endsWith(`/request/${id}/replay`));
    await detalhe.getByRole('button', { name: 'Run again' }).click();

    expect((await enviado).postDataJSON()).toMatchObject({
      chaos: { delay_ms: 200, duplicate: true },
    });
    await expect(
      page.getByRole('table', { name: 'Outbound history' }).locator('tbody tr'),
    ).toHaveCount(2);
    await expect(detalhe).toContainText('Injected: delay 200 ms, sent twice (second: 201 Created)');
    expect(destino.recebidas).toHaveLength(4);
  });
});
