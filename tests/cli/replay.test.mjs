import assert from 'node:assert/strict';
import { after, afterEach, describe, test } from 'node:test';
import { SERVIDOR } from './support/ambiente.mjs';
import { iniciarCapturador } from './support/capturador.mjs';
import { iniciarCli, linhaListening, linhaMensagem } from './support/cli.mjs';
import { conferirReenvio, descartado } from './support/conferencia.mjs';
import { limparTudo } from './support/limpeza.mjs';
import { buscarMensagem, caminhoGravado, criarToken, enviarCru } from './support/servidor.mjs';

afterEach(limparTudo);
after(limparTudo);

/** O que vem da mensagem gravada (sem os cabeçalhos que o cliente HTTP do CLI põe por conta própria). */
function essencia(rec) {
  return {
    metodo: rec.metodo,
    url: rec.url,
    corpo: rec.corpo.toString('base64'),
    cabecalhos: rec.cabecalhos.filter(([n]) => !descartado(n) && n !== 'http2-settings').sort(),
  };
}

describe('anzol replay', () => {
  test('CA-6: replay reenvia uma mensagem gravada igual ao listen', { timeout: 90_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarCapturador({ status: 202 });
    const forward = `${app.url}/destino`;

    // Referência: o que o listen entrega para esta mensagem.
    const listen = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', forward]);
    await listen.esperarLinha(linhaListening(SERVIDOR, forward, token));
    const { requestId } = await enviarCru(token, '/replay/alvo?k=v&b=2', {
      metodo: 'PUT',
      corpo: '{"replay":true,"texto":"olá ✓"}',
      cabecalhos: [
        ['Content-Type', 'application/json'],
        ['User-Agent', 'aceite-cli/replay'],
        ['X-Dup', 'a'],
        ['X-Dup', 'b'],
        ['X_Custom_Under', 'v1'],
        ['Keep-Alive', 'timeout=77'],
      ],
    });
    const msg = await buscarMensagem(token, requestId);
    const pelaEscuta = await app.esperarCaminho('/replay/alvo');
    await listen.esperarLinha(linhaMensagem('PUT', caminhoGravado(msg), 202));
    await listen.encerrar();

    const replay = await iniciarCli(['replay', token, requestId, '--to', forward, '--server', SERVIDOR]);
    const peloReplay = await app.esperarCaminho('/replay/alvo');
    await replay.esperarLinha(linhaMensagem('PUT', caminhoGravado(msg), 202));
    const { codigo } = await replay.esperarSaida(30_000);
    assert.equal(codigo, 0, `código de saída do replay\n${replay.descricao()}`);

    conferirReenvio(msg, peloReplay, forward);
    assert.deepEqual(essencia(peloReplay), essencia(pelaEscuta), 'replay e listen entregam a mesma requisição');
    assert.equal(app.recebidas.length, 2, 'uma entrega do listen e uma do replay');
  });
});
