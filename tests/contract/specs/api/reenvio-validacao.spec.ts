import { randomUUID } from 'node:crypto';
import { JSON_ACCEPT, enviarEGuardar, expect, expectErroJson } from '../../support/contrato.js';
import { chamarReplay, chamarSend, expect422, historico, send, test } from '../../support/reenvio.js';

// Erros de entrada de replay e send (§1 do plano "reenvio-servidor"): validação → 422 JSON `{chave: [mensagem]}`
// com a forma do Laravel; token inexistente → 410 `Token not found`; mensagem inexistente → 404
// `Request not found`, como o resto da API. Um erro não sai para o alvo nem entra no histórico.
//
// Os casos válidos usam 169.254.169.254 como alvo: bloqueado na hora (200 com error.kind=blocked), o que prova
// que a entrada passou pela validação sem depender de rede. Cada teste fica abaixo de 30 chamadas por URL, para
// não esbarrar no limite por minuto caso um 422 conte como disparo.

const BLOQUEADO = 'http://169.254.169.254/';

test.describe('send: validação (422)', () => {
  test('url ausente, vazia, que não é texto, sem esquema ou com mais de 2048 caracteres → 422 em url', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const casos: Array<[string, Record<string, unknown>]> = [
      ['ausente', { method: 'GET' }],
      ['vazia', { url: '', method: 'GET' }],
      ['número', { url: 42, method: 'GET' }],
      ['texto solto', { url: 'isto nao e uma url', method: 'GET' }],
      ['sem esquema', { url: 'www.exemplo.test/caminho', method: 'GET' }],
      ['relativa', { url: '/caminho/relativo', method: 'GET' }],
      ['2049 caracteres', { url: `http://exemplo.test/${'a'.repeat(2049 - 'http://exemplo.test/'.length)}`, method: 'GET' }],
    ];
    for (const [nome, corpo] of casos) await expect422(await chamarSend(request, t, corpo), /^url$/, `url ${nome}`);
    // 2048 caracteres passa pela validação.
    const limite = `http://169.254.169.254/${'a'.repeat(2048 - 'http://169.254.169.254/'.length)}`;
    expect(limite).toHaveLength(2048);
    expect((await send(request, t, { url: limite, method: 'GET' })).error?.kind).toBe('blocked');
    expect(await historico(request, t)).toHaveLength(1);
  });

  test('method fora de GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS → 422 em method', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const method of ['TRACE', 'CONNECT', 'FOO', '', 42, ['GET']]) {
      await expect422(await chamarSend(request, t, { url: BLOQUEADO, method }), /^method$/, `method ${JSON.stringify(method)}`);
    }
    expect(await historico(request, t)).toEqual([]);
  });

  test('timeout fora de 1000..30000 ms ou não inteiro → 422 em timeout; 1000 e 30000 passam', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const timeout of [0, 999, 30_001, -1, 60_000, 1500.5, 'abc', true]) {
      await expect422(await chamarSend(request, t, { url: BLOQUEADO, method: 'GET', timeout }), /^timeout$/, `timeout ${JSON.stringify(timeout)}`);
    }
    for (const timeout of [1_000, 30_000]) {
      expect((await send(request, t, { url: BLOQUEADO, method: 'GET', timeout })).error?.kind).toBe('blocked');
    }
    expect(await historico(request, t)).toHaveLength(2);
  });

  test('422 não sai para o alvo', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    await expect422(await chamarSend(request, t, { url: receptor.url, method: 'TRACE' }), /^method$/, 'TRACE');
    await expect422(await chamarSend(request, t, { url: receptor.url, method: 'GET', timeout: 0 }), /^timeout$/, 'timeout 0');
    expect(receptor.recebidas).toHaveLength(0);
  });
});

test.describe('replay: validação (422) e mensagem inexistente (404)', () => {
  test('url ausente, sem esquema ou com timeout fora de 1000..30000 → 422', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const { msg } = await enviarEGuardar(request, t, '', { method: 'POST', data: Buffer.from('{}') });
    await expect422(await chamarReplay(request, t, msg.uuid, {}), /^url$/, 'url ausente');
    await expect422(await chamarReplay(request, t, msg.uuid, { url: '' }), /^url$/, 'url vazia');
    await expect422(await chamarReplay(request, t, msg.uuid, { url: 'isto nao e uma url' }), /^url$/, 'url texto');
    await expect422(await chamarReplay(request, t, msg.uuid, { url: receptor.url, timeout: 999 }), /^timeout$/, 'timeout 999');
    await expect422(await chamarReplay(request, t, msg.uuid, { url: receptor.url, timeout: 30_001 }), /^timeout$/, 'timeout 30001');
    expect(receptor.recebidas).toHaveLength(0);
    expect(await historico(request, t)).toEqual([]);
  });

  test('mensagem que não existe (ou foi apagada) → 404 Request not found', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    await expectErroJson(await chamarReplay(request, t, randomUUID(), { url: receptor.url }), 404, 'Request not found');

    const { msg } = await enviarEGuardar(request, t, '', { method: 'POST', data: Buffer.from('{}') });
    expect((await request.delete(`/token/${t}/request/${msg.uuid}`, { headers: JSON_ACCEPT })).status()).toBeLessThan(300);
    await expectErroJson(await chamarReplay(request, t, msg.uuid, { url: receptor.url }), 404, 'Request not found');

    expect(receptor.recebidas).toHaveLength(0);
    expect(await historico(request, t)).toEqual([]);
  });
});

test.describe('token inexistente (410)', () => {
  test('replay e send num token que nunca existiu → 410 Token not found', async ({ request }) => {
    await expectErroJson(await chamarSend(request, randomUUID(), { url: BLOQUEADO, method: 'GET' }), 410, 'Token not found');
    await expectErroJson(await chamarReplay(request, randomUUID(), randomUUID(), { url: BLOQUEADO }), 410, 'Token not found');
  });
});
