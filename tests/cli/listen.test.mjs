import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, describe, test } from 'node:test';
import { SERVIDOR } from './support/ambiente.mjs';
import { iniciarCapturador, valores } from './support/capturador.mjs';
import { iniciarCli, linhaListening, linhaMensagem } from './support/cli.mjs';
import { conferirReenvio } from './support/conferencia.mjs';
import { limparTudo } from './support/limpeza.mjs';
import { buscarMensagem, caminhoGravado, criarToken, enviarCru, statusDoToken } from './support/servidor.mjs';

afterEach(limparTudo);
after(limparTudo);

describe('webhook listen', () => {
  test('CA-1: sem --token cria URL nova; o POST chega ao app local como gravado e a linha traz status e ms', { timeout: 90_000 }, async () => {
    const app = await iniciarCapturador({ status: 201, atraso: 250 });
    const forward = `${app.url}/base`;
    const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--forward', forward]);
    const [, token] = await cli.esperarLinha(linhaListening(SERVIDOR, forward));
    assert.equal(await statusDoToken(token), 200, 'a URL impressa deve existir no servidor');

    const corpo = '{"pedido":42,"texto":"olá ✓ / fim"}';
    const { requestId } = await enviarCru(token, '/pedidos/novo/?z=9&a=1&a=2&sp=a+b', {
      metodo: 'POST',
      chunked: true,
      corpo,
      cabecalhos: [
        ['Content-Type', 'application/json'],
        ['User-Agent', 'aceite-cli/1'],
        ['X-Aceite', 'um'],
        ['Connection', 'keep-alive, marca-conexao'],
        ['Keep-Alive', 'timeout=77'],
        ['TE', 'trailers'],
        ['Trailer', 'X-Marca-Trailer'],
        ['Upgrade', 'marca-upgrade/1'],
        ['Proxy-Authorization', 'Basic bWFyY2E='],
        ['Proxy-Marca', 'p1'],
      ],
    });
    const msg = await buscarMensagem(token, requestId);
    // Pré-condição: o servidor gravou os cabeçalhos que o CLI tem de descartar.
    for (const nome of ['connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-marca', 'host', 'content-length']) {
      assert.ok(msg.headers[nome], `pré-condição: o servidor deveria ter gravado ${nome}; gravados: ${Object.keys(msg.headers).join(', ')}`);
    }
    assert.equal(msg.content, corpo);

    const rec = await app.esperarCaminho('/pedidos/novo');
    conferirReenvio(msg, rec, forward);
    assert.match(rec.url, /^\/base\/pedidos\/novo\?.*z=9/, 'caminho após o token e query');

    const linha = await cli.esperarLinha(linhaMensagem('POST', caminhoGravado(msg), 201));
    assert.ok(Number(linha[5]) >= 250, `latência impressa (${linha[5]} ms) deve incluir os 250 ms do app local`);
  });

  test('CA-2: com --token usa a URL existente', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarCapturador();
    const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(linhaListening(SERVIDOR, app.url, token));

    const { requestId } = await enviarCru(token, '/ping?x=1', { metodo: 'GET', cabecalhos: [['X-Aceite', 'dois']] });
    const msg = await buscarMensagem(token, requestId);
    const rec = await app.esperarCaminho('/ping');
    assert.equal(rec.metodo, 'GET');
    assert.equal(rec.url, '/ping?x=1');
    assert.deepEqual(valores(rec, 'x-aceite'), ['dois']);
    await cli.esperarLinha(linhaMensagem('GET', caminhoGravado(msg), 200));
  });

  test('CA-2: token inexistente → "Token not found" no stderr e saída 1', { timeout: 60_000 }, async () => {
    const token = randomUUID();
    assert.equal(await statusDoToken(token), 410, 'pré-condição: o token não existe');
    const app = await iniciarCapturador();
    const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(/Token not found/, { fluxo: 'stderr' });
    const { codigo } = await cli.esperarSaida();
    assert.equal(codigo, 1, `código de saída\n${cli.descricao()}`);
    assert.equal(app.recebidas.length, 0);
  });

  test('CA-8: GET, PUT, PATCH, DELETE e HEAD com o método certo; cabeçalho repetido e com underscore como gravados', { timeout: 120_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarCapturador({ status: 404 });
    const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(linhaListening(SERVIDOR, app.url, token));

    for (const metodo of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      const comCorpo = ['PUT', 'PATCH', 'DELETE'].includes(metodo);
      const caminho = `/metodo/${metodo.toLowerCase()}`;
      const { requestId } = await enviarCru(token, `${caminho}?m=${metodo}`, {
        metodo,
        corpo: comCorpo ? `corpo de ${metodo} ✓` : undefined,
        cabecalhos: [
          ...(comCorpo ? [['Content-Type', 'text/plain; charset=utf-8']] : []),
          ['X-Dup', 'a'],
          ['X-Dup', 'b'],
          ['X_Custom_Under', 'v1'],
        ],
      });
      const msg = await buscarMensagem(token, requestId);
      // Como o servidor grava (contrato): repetido fica com o último valor; underscore vira hífen.
      assert.deepEqual(msg.headers['x-dup'], ['b'], 'pré-condição: x-dup gravado');
      assert.deepEqual(msg.headers['x-custom-under'], ['v1'], 'pré-condição: x-custom-under gravado');

      const rec = await app.esperarCaminho(caminho, { descricao: `o ${metodo} em ${caminho}` });
      assert.equal(rec.metodo, metodo, `método reenviado para ${caminho}`);
      assert.equal(rec.url, `${caminho}?m=${metodo}`);
      assert.deepEqual(valores(rec, 'x-dup'), msg.headers['x-dup'], `${metodo}: x-dup como gravado`);
      assert.deepEqual(valores(rec, 'x-custom-under'), msg.headers['x-custom-under'], `${metodo}: x-custom-under como gravado`);
      assert.deepEqual(valores(rec, 'x_custom_under'), [], `${metodo}: nome com underscore não volta`);
      if (comCorpo) assert.equal(rec.corpo.toString('utf8'), msg.content, `${metodo}: corpo`);
      await cli.esperarLinha(linhaMensagem(metodo, caminhoGravado(msg), 404));
    }
  });

  test('Ctrl+C (SIGINT) sai com 0', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarCapturador();
    const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(linhaListening(SERVIDOR, app.url, token));
    cli.interromper();
    const { codigo, sinal } = await cli.esperarSaida(15_000);
    assert.equal(codigo, 0, `código de saída após SIGINT (sinal ${sinal})\n${cli.descricao()}`);
  });
});
