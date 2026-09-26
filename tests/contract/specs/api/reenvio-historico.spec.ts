import { randomUUID } from 'node:crypto';
import { JSON_ACCEPT, enviarEGuardar, expect, expectErroJson } from '../../support/contrato.js';
import { chamarHistorico, chamarReplay, chamarSend, historico, replay, send, test } from '../../support/reenvio.js';

// Histórico de saída da URL (CA-1 e CA-4 do plano "reenvio-servidor", §1): `GET /token/{id}/outbound` devolve
// a lista dos resultados de replay e send, mais novo primeiro, cada item igual ao que a chamada devolveu.
// Apagar a URL apaga o histórico: depois do DELETE a API responde 410 (a chave do Redis não é observável).

test.describe('histórico de saída (CA-1, CA-4)', () => {
  test('URL nova → lista vazia', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    expect(await historico(request, t)).toEqual([]);
  });

  test('replay e send entram no histórico, mais novo primeiro, cada um igual ao resultado da chamada', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir({ body: 'ok' });
    const { msg } = await enviarEGuardar(request, t, '/origem', { method: 'POST', data: Buffer.from('{}') });

    const primeiro = await send(request, t, { url: `${receptor.url}/1`, method: 'GET' });
    const segundo = await replay(request, t, msg.uuid, { url: `${receptor.url}/2`, keep_path: false });
    const terceiro = await send(request, t, { url: 'http://169.254.169.254/', method: 'GET' });

    expect(await historico(request, t)).toEqual([terceiro, segundo, primeiro]);
    expect(new Set([primeiro.id, segundo.id, terceiro.id]).size).toBe(3);
  });

  test('o histórico é por URL', async ({ request, tokens, receptores }) => {
    const a = (await tokens.criar()).uuid;
    const b = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const r = await send(request, a, { url: receptor.url, method: 'GET' });
    expect(await historico(request, a)).toEqual([r]);
    expect(await historico(request, b)).toEqual([]);
  });

  test('apagar a URL → 410 no histórico, no replay e no send', async ({ request, tokens, receptores }) => {
    const token = await tokens.criar();
    const t = token.uuid;
    const receptor = await receptores.subir();
    const { msg } = await enviarEGuardar(request, t, '', { method: 'POST', data: Buffer.from('{}') });
    const r = await replay(request, t, msg.uuid, { url: receptor.url });

    expect(await historico(request, t)).toEqual([r]);

    expect((await request.delete(`/token/${t}`, { headers: JSON_ACCEPT })).status()).toBe(204);
    await expectErroJson(await chamarHistorico(request, t), 410, 'Token not found');
    await expectErroJson(await chamarSend(request, t, { url: receptor.url, method: 'GET' }), 410, 'Token not found');
    await expectErroJson(await chamarReplay(request, t, msg.uuid, { url: receptor.url }), 410, 'Token not found');
    expect(receptor.recebidas).toHaveLength(1);
  });

  test('URL que nunca existiu → 410 no histórico', async ({ request }) => {
    await expectErroJson(await chamarHistorico(request, randomUUID()), 410, 'Token not found');
  });
});
