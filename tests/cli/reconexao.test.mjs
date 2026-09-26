import assert from 'node:assert/strict';
import { after, afterEach, describe, test } from 'node:test';
import { SERVIDOR, pausa } from './support/ambiente.mjs';
import { iniciarCapturador } from './support/capturador.mjs';
import { LINHA_RECONEXAO, iniciarCli, linhaListening, linhaMensagem } from './support/cli.mjs';
import { limparTudo } from './support/limpeza.mjs';
import { criarToken, enviarCru } from './support/servidor.mjs';
import { iniciarProxy } from './support/proxy.mjs';

afterEach(limparTudo);
after(limparTudo);

describe('webhook listen: queda da conexão com o servidor', () => {
  test('CA-5: reconecta e reenvia as mensagens da janela, em ordem, sem duplicar', { timeout: 150_000 }, async () => {
    const token = await criarToken();
    const proxy = await iniciarProxy(SERVIDOR);
    const app = await iniciarCapturador();
    const cli = await iniciarCli(['listen', '--server', proxy.url, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(linhaListening(proxy.url, app.url, token));

    await enviarCru(token, '/antes', { metodo: 'GET' });
    await app.esperarCaminho('/antes');
    await cli.esperarLinha(linhaMensagem('GET', '/antes', 200));

    // Queda: o SSE do CLI cai e o servidor fica inalcançável por ~3 s, com mensagens chegando nele.
    await proxy.derrubar();
    const faltaram = ['/faltou-1', '/faltou-2', '/faltou-3'];
    for (const caminho of faltaram) {
      await enviarCru(token, caminho, { metodo: 'POST', corpo: caminho, cabecalhos: [['Content-Type', 'text/plain']] });
      await pausa(300);
    }
    await pausa(2_000);
    await proxy.religar();

    const [, n] = await cli.esperarLinha(LINHA_RECONEXAO, { prazo: 60_000 });
    assert.equal(Number(n), faltaram.length, 'quantidade de mensagens recuperadas');
    for (const caminho of faltaram) {
      await app.esperarCaminho(caminho, { prazo: 20_000 });
      await cli.esperarLinha(linhaMensagem('POST', caminho, 200));
    }

    // Depois de reconectado, o fluxo normal segue.
    await enviarCru(token, '/depois', { metodo: 'GET' });
    await app.esperarCaminho('/depois');
    await cli.esperarLinha(linhaMensagem('GET', '/depois', 200));

    await pausa(1_500); // janela para uma duplicata tardia aparecer
    assert.deepEqual(
      app.recebidas.map((r) => r.url),
      ['/antes', ...faltaram, '/depois'],
      'o app local recebe cada mensagem uma vez, na ordem de chegada',
    );
    for (const r of app.recebidas.filter((x) => x.url.startsWith('/faltou'))) {
      assert.equal(r.corpo.toString(), r.url, `corpo de ${r.url}`);
    }
  });
});
