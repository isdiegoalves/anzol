import net from 'node:net';
import type { APIRequestContext } from '@playwright/test';
import { BASE_URL, enviarEGuardar, listar, type Mensagem } from '../../support/contrato.js';
import { buscar } from '../../support/busca.js';
import { comSegredo, compartilhar, expect, http, lerLink, test } from '../../support/privacidade.js';
import { salvarRegras, type Falha } from '../../support/regras.js';

// UX de Regras, C3 (E-06, `.docs-arquivo/regras-ux/api-contrato.md`): toda mensagem nova grava a chave `response`, o
// que a captura respondeu, conhecido antes de responder: `{status}` para a resposta de uma regra e para a resposta
// padrão da URL, `{fault}` para regra com falha de rede. Aparece no `GET` da mensagem, na listagem, na busca, no
// evento SSE (`specs/event/resposta-gravada.spec.ts`) e no link só-leitura (onde `rule` e `near_miss` aparecem).
// A chave entrou em `CHAVES_MENSAGEM`, então os testes de forma de `mensagem.spec.ts`, `assinatura-config.spec.ts` e
// `privacidade-share.spec.ts` também a exigem.
//
// Formato antigo: mensagem gravada antes do campo existir não tem `response` (ou tem `null`) e continua abrindo. O
// contrato não lê nem escreve o Redis e nenhuma rota da API grava mensagem sem passar pela captura, então não há
// como semear uma mensagem antiga por aqui: essa leitura fica com os testes do backend.

const HOST = new URL(BASE_URL);
const PORTA = Number(HOST.port || 80);

/** Os três lugares da API que devolvem a mensagem gravada: `GET`, listagem e busca. */
async function expectRespostaEmTodaParte(request: APIRequestContext, tokenId: string, msg: Mensagem, esperada: unknown): Promise<void> {
  expect(msg.response, 'GET /token/{id}/request/{rid}').toEqual(esperada);
  const { data } = await listar(request, tokenId, 'per_page=100');
  expect(data.find((m) => m.uuid === msg.uuid)?.response, 'GET /token/{id}/requests').toEqual(esperada);
  const busca = await buscar(request, tokenId, { per_page: 100 });
  expect(busca.data.find((m) => m.uuid === msg.uuid)?.response, 'POST /token/{id}/requests/search').toEqual(esperada);
}

/**
 * Manda um POST cru e espera a conexão fechar (ou 10 s), sem interpretar nada: as falhas de rede não deixam um
 * cliente HTTP comum terminar direito. `regras-falhas.spec.ts` confere o que chega no fio.
 */
function dispararCru(caminho: string, corpo = '{"id":1}'): Promise<void> {
  const pedido = [
    `POST ${caminho} HTTP/1.1`, `Host: ${HOST.host}`, 'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(corpo)}`, 'Connection: close', '', corpo,
  ].join('\r\n');
  return new Promise((resolve) => {
    const socket = net.connect(PORTA, HOST.hostname, () => socket.write(pedido));
    socket.on('data', () => undefined);
    socket.on('error', () => undefined);
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on('close', () => resolve());
  });
}

test.describe('C3: response gravado na mensagem', () => {
  test('resposta padrão da URL: response = {status: default_status} no GET, na listagem e na busca', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_status: 226 });
    const { res, msg } = await enviarEGuardar(request, token.uuid, '/a', { method: 'POST', data: Buffer.from('x') });
    expect(res.status()).toBe(226);
    // Exatamente `{status}`: o api-contrato mostra só essa chave.
    await expectRespostaEmTodaParte(request, token.uuid, msg, { status: 226 });
  });

  test('URL sem nada configurado: response = {status: 200}', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { res, msg } = await enviarEGuardar(request, token.uuid);
    expect(res.status()).toBe(200);
    expect(msg.response).toEqual({ status: 200 });
  });

  test('status pelo caminho (/404, /500): response traz o status realmente respondido', async ({ request, tokens }) => {
    // SUPOSIÇÃO: "status padrão da URL" inclui o status pelo caminho — o selo da tela mostra "o status realmente
    // respondido" (CA-9 do STATUS), e o que a captura respondeu em `/404` é 404.
    const token = await tokens.criar({ default_status: 226 });
    for (const status of [404, 500]) {
      const { res, msg } = await enviarEGuardar(request, token.uuid, `/${status}`);
      expect(res.status()).toBe(status);
      expect(msg.response, `/${status}`).toEqual({ status });
    }
  });

  test('default_status 429 com retry_after: response = {status: 429}', async ({ request, tokens }) => {
    // SUPOSIÇÃO: "o 429/Retry-After quando for o caso" só pede que o 429 seja gravado; o api-contrato não põe o
    // `Retry-After` dentro de `response`, então o formato fica `{status}` como nos outros casos.
    const token = await tokens.criar({ default_status: 429, retry_after: 7 });
    const { res, msg } = await enviarEGuardar(request, token.uuid, '/limite', { method: 'POST' });
    expect(res.status()).toBe(429);
    expect(res.headers()['retry-after']).toBe('7');
    expect(msg.response).toEqual({ status: 429 });
  });

  test('regra que respondeu: response = {status} da regra, inclusive em /404; near miss fica com o status padrão', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_status: 226 });
    const [regra] = await salvarRegras(request, token.uuid, [
      { name: 'criado', match: { method: ['POST'] }, response: { status: 201, body: 'ok' } },
    ]);

    const casou = await enviarEGuardar(request, token.uuid, '/pedidos', { method: 'POST', data: Buffer.from('{}') });
    expect(casou.res.status()).toBe(201);
    expect(casou.msg.rule).toEqual({ id: regra.id, name: 'criado' });
    await expectRespostaEmTodaParte(request, token.uuid, casou.msg, { status: 201 });

    // O status da regra vale em /404 (regras-webhook.spec.ts); o gravado é o respondido.
    const noCaminho = await enviarEGuardar(request, token.uuid, '/404', { method: 'POST' });
    expect(noCaminho.res.status()).toBe(201);
    expect(noCaminho.msg.response).toEqual({ status: 201 });

    // Nenhuma casou (near miss): a resposta padrão da URL.
    const quase = await enviarEGuardar(request, token.uuid, '/pedidos', { method: 'GET' });
    expect(quase.res.status()).toBe(226);
    expect(quase.msg.rule).toBeNull();
    expect(quase.msg.near_miss).toMatchObject({ id: regra.id });
    expect(quase.msg.response).toEqual({ status: 226 });
  });

  test('regra com atraso: o status é gravado como o da regra', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [{ name: 'lenta', response: { status: 503, delay: { fixed: 300 } } }]);
    const { res, msg } = await enviarEGuardar(request, token.uuid, '/lento', { method: 'POST' });
    expect(res.status()).toBe(503);
    expect(msg.response).toEqual({ status: 503 });
  });

  // Resolução 9 do api-contrato (achado da revisão): o template que passa dos tetos ao responder vira 500 para o
  // cliente; o gravado é o 500 respondido, não o status da regra. Tetos de hoje: corpo renderizado de 1 MiB e valor de
  // cabeçalho de 8 KiB (`TemplateLimits`); os envios passam deles com folga e ficam abaixo do 1 MiB do webhook.
  const ESTOUROS: Array<[string, { headers?: Record<string, string>; body?: string }, number]> = [
    ['corpo {{request.body}}{{request.body}} com 600 KiB', { body: '{{request.body}}{{request.body}}' }, 600 * 1024],
    ['cabeçalho {{request.body}} com 9 KiB', { headers: { 'X-Eco': '{{request.body}}' }, body: 'ok' }, 9 * 1024],
  ];
  for (const [caso, resposta, tamanho] of ESTOUROS) {
    test(`template que estoura ao responder (${caso}): o cliente recebe 500 e a mensagem grava {status: 500}`, async ({ request, tokens }) => {
      const token = await tokens.criar({ default_status: 226 });
      const [regra] = await salvarRegras(request, token.uuid, [
        { name: 'estoura', match: { method: ['POST'] }, response: { status: 201, ...resposta, template: true } },
      ]);
      const res = await request.post(`/${token.uuid}/grande`, { headers: { 'Content-Type': 'text/plain' }, data: Buffer.from('a'.repeat(tamanho)) });
      expect(res.status(), 'o cliente recebe 500').toBe(500);
      // O 500 do estouro pode vir sem `X-Request-Id` (o api-contrato não o exige aqui): a mensagem vem da listagem.
      const { data, total } = await listar(request, token.uuid);
      expect(total, 'a mensagem foi gravada').toBe(1);
      const msg = data[0];
      expect(msg.content).toHaveLength(tamanho);
      expect(msg.rule).toEqual({ id: regra.id, name: 'estoura' });
      await expectRespostaEmTodaParte(request, token.uuid, msg, { status: 500 });
    });
  }

  const FALHAS: Falha[] =['connection_reset', 'empty_response', 'malformed_chunk', 'random_data_then_close'];
  for (const fault of FALHAS) {
    test(`regra com fault ${fault}: response = {fault: "${fault}"}, sem status`, async ({ request, tokens }) => {
      const token = await tokens.criar();
      const [regra] = await salvarRegras(request, token.uuid, [
        // Status, corpo e atraso são ignorados com `fault` (regras-falhas.spec.ts): o gravado é só a falha.
        { name: `falha ${fault}`, match: { path: { equals: '/falha' } }, response: { status: 201, body: 'nunca sai', fault } },
      ]);
      await dispararCru(`/${token.uuid}/falha`);
      const { data, total } = await listar(request, token.uuid);
      expect(total).toBe(1);
      expect(data[0].rule).toEqual({ id: regra.id, name: `falha ${fault}` });
      await expectRespostaEmTodaParte(request, token.uuid, data[0], { fault });
    });
  }

  test('link só-leitura: response aparece junto com rule, com e sem redact', async ({ request, urls }) => {
    const url = await urls.proteger();
    const h = comSegredo(url.segredo);
    const regras = await http('PUT', `/token/${url.uuid}/rules`, {
      headers: h, corpo: [{ name: 'aceito', match: { method: ['POST'] }, response: { status: 202 } }],
    });
    expect(regras.status, regras.texto.slice(0, 300)).toBe(200);
    const captura = await request.post(`/${url.uuid}/pedido`, { data: Buffer.from('{"ok":true}'), headers: { 'Content-Type': 'application/json' } });
    expect(captura.status()).toBe(202);
    const rid = captura.headers()['x-request-id']!;
    const gravada = await http('GET', `/token/${url.uuid}/request/${rid}`, { headers: h });
    expect(gravada.json<Mensagem>().response).toEqual({ status: 202 });

    for (const redact of [true, false]) {
      const link = await compartilhar(url.uuid, rid, { redact }, h);
      const publico = await lerLink(link.id);
      expect(publico.status, publico.texto.slice(0, 300)).toBe(200);
      const msg = publico.json<Mensagem>();
      expect(msg.rule, `redact ${redact}: rule no link`).toMatchObject({ name: 'aceito' });
      expect(msg.response, `redact ${redact}: response no link`).toEqual({ status: 202 });
    }
  });

  test('a chave existe em toda mensagem nova (GET, POST JSON, formulário)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const pedidos = [
      { method: 'GET' },
      { method: 'POST', data: Buffer.from('{"a":1}'), headers: { 'Content-Type': 'application/json' } },
      { method: 'POST', form: { a: 'b' } },
    ];
    for (const pedido of pedidos) {
      const { msg } = await enviarEGuardar(request, token.uuid, '', pedido);
      expect(msg, JSON.stringify(pedido)).toHaveProperty('response', { status: 200 });
    }
  });
});
