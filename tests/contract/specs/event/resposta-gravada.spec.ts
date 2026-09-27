import net from 'node:net';
import { BASE_URL, buscarMensagem, expect, listar, test, type Token } from '../../support/contrato.js';
import { ADAPTADOR, assinar, type Assinatura } from '../../support/eventos.js';
import { salvarRegras } from '../../support/regras.js';

// UX de Regras, C3 (E-06): o `request` do evento `request.created` é a mensagem gravada, com a chave `response`
// (`{status}` ou `{fault}`). O corte de 1.000.000 caracteres tira `content`, `headers` e `user_agent`, não a
// `response`.

const HOST = new URL(BASE_URL);

test.describe(`evento request.created com response (adaptador ${ADAPTADOR})`, () => {
  let assinaturas: Assinatura[] = [];

  async function abrir(token: Token): Promise<Assinatura> {
    const a = await assinar(token.uuid);
    assinaturas.push(a);
    return a;
  }

  test.afterEach(async () => {
    for (const a of assinaturas) await a.fechar();
    assinaturas = [];
  });

  test('resposta padrão: request.response = {status: default_status}, igual à mensagem gravada', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_status: 226 });
    const canal = await abrir(token);
    const res = await request.post(`/${token.uuid}`, { data: Buffer.from('x') });
    expect(res.status()).toBe(226);
    const evento = await canal.proximo();
    expect(evento.request.response).toEqual({ status: 226 });
    expect(evento.request).toEqual(await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!));
  });

  test('regra que respondeu: request.response = {status} da regra', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [{ name: 'criado', response: { status: 201 } }]);
    const canal = await abrir(token);
    const res = await request.post(`/${token.uuid}/pedidos`, { data: Buffer.from('{}') });
    expect(res.status()).toBe(201);
    const evento = await canal.proximo();
    expect(evento.request.response).toEqual({ status: 201 });
    expect(evento.request).toEqual(await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!));
  });

  test('regra com fault: request.response = {fault}', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [{ name: 'vazia', response: { fault: 'empty_response' } }]);
    const canal = await abrir(token);
    await new Promise<void>((resolve) => {
      const socket = net.connect(Number(HOST.port || 80), HOST.hostname, () =>
        socket.write(`GET /${token.uuid}/falha HTTP/1.1\r\nHost: ${HOST.host}\r\nConnection: close\r\n\r\n`));
      socket.on('data', () => undefined);
      socket.on('error', () => undefined);
      socket.setTimeout(10_000, () => socket.destroy());
      socket.on('close', () => resolve());
    });
    const evento = await canal.proximo();
    expect(evento.request.response).toEqual({ fault: 'empty_response' });
    const [gravada] = (await listar(request, token.uuid)).data;
    expect(evento.request).toEqual(gravada);
  });

  test('evento truncated também leva a response', async ({ request, tokens }) => {
    // SUPOSIÇÃO: o evento cortado mantém `response`, como mantém `schema` (specs/event/schema.spec.ts): o
    // api-contrato diz "aparece no evento SSE request.created" sem excluir o evento cortado.
    const token = await tokens.criar({ default_status: 202 });
    const canal = await abrir(token);
    await request.post(`/${token.uuid}`, { data: Buffer.from('/'.repeat(600_000)), headers: { 'Content-Type': 'text/plain' } });
    const evento = await canal.proximo();
    expect(evento.truncated).toBe(true);
    expect(evento.request.response).toEqual({ status: 202 });
  });
});
