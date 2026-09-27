import assert from 'node:assert/strict';
import { after, afterEach, describe, test } from 'node:test';
import { SERVIDOR } from './support/ambiente.mjs';
import { iniciarCapturador, lerMultipart, valores } from './support/capturador.mjs';
import { AVISO_MULTIPART, iniciarCli, linhaErro, linhaListening, linhaMensagem } from './support/cli.mjs';
import { limparTudo } from './support/limpeza.mjs';
import { assinarEventos, buscarMensagem, caminhoGravado, criarToken, enviarCru } from './support/servidor.mjs';

afterEach(limparTudo);
after(limparTudo);

/** ~1 MB em UTF-8 (abaixo do teto de 1 MiB do webhook) com `/` e não-ASCII, que o json_encode expande. */
function corpoGrande() {
  const linhas = [];
  let bytes = 0;
  for (let i = 0; bytes < 1_030_000; i++) {
    const l = `linha ${String(i).padStart(6, '0')} /caminho/ção ✓\n`;
    linhas.push(l);
    bytes += Buffer.byteLength(l);
  }
  linhas.push('FIM-DO-CORPO');
  return linhas.join('');
}

describe('anzol listen: robustez', () => {
  test('CA-3: mensagem > 1 MB (evento truncado) chega ao app local com o corpo inteiro', { timeout: 90_000 }, async () => {
    const token = await criarToken();
    const eventos = await assinarEventos(token);
    const app = await iniciarCapturador();
    const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(linhaListening(SERVIDOR, app.url, token));

    const corpo = corpoGrande();
    assert.ok(Buffer.byteLength(corpo) < 1_048_576, 'pré-condição: abaixo do teto de 1 MiB do webhook');
    const { requestId } = await enviarCru(token, '/grande', { corpo, cabecalhos: [['Content-Type', 'text/plain; charset=utf-8']] });
    const evento = await eventos.evento(requestId);
    assert.equal(evento.truncated, true, 'pré-condição: o evento SSE desta mensagem veio truncado');

    const rec = await app.esperarCaminho('/grande', { prazo: 30_000 });
    const esperado = Buffer.from(corpo, 'utf8');
    assert.ok(rec.corpo.equals(esperado), `corpo reenviado difere: ${rec.corpo.length} bytes, esperados ${esperado.length}; termina em ${JSON.stringify(rec.corpo.subarray(-20).toString('utf8'))}`);
    assert.deepEqual(valores(rec, 'content-length'), [String(esperado.length)]);
    assert.deepEqual(valores(rec, 'content-type'), ['text/plain; charset=utf-8'], 'cabeçalhos da mensagem inteira, não do evento truncado');
    await cli.esperarLinha(linhaMensagem('POST', '/grande', 200));
  });

  test('CA-4: app local fora do ar → linha "error:" e o CLI segue; a próxima mensagem é reenviada', { timeout: 90_000 }, async () => {
    const token = await criarToken();
    const reservado = await iniciarCapturador();
    const porta = reservado.porta;
    const forward = reservado.url;
    await reservado.fechar(); // porta livre: conexão recusada

    const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', forward]);
    await cli.esperarLinha(linhaListening(SERVIDOR, forward, token));

    await enviarCru(token, '/primeira', { corpo: 'um', cabecalhos: [['Content-Type', 'text/plain']] });
    await cli.esperarLinha(linhaErro('POST', '/primeira'));
    assert.ok(cli.rodando, `o CLI deveria continuar ouvindo após o erro\n${cli.descricao()}`);

    const app = await iniciarCapturador({ porta });
    const { requestId } = await enviarCru(token, '/segunda', { corpo: 'dois', cabecalhos: [['Content-Type', 'text/plain']] });
    const msg = await buscarMensagem(token, requestId);
    const rec = await app.esperarCaminho('/segunda');
    assert.equal(rec.corpo.toString(), 'dois');
    await cli.esperarLinha(linhaMensagem('POST', caminhoGravado(msg), 200));
  });

  test('CA-7: multipart → campos de texto reenviados e aviso de arquivos na linha', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarCapturador();
    const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(linhaListening(SERVIDOR, app.url, token));

    const f = 'FronteiraAceite';
    const corpo = [
      `--${f}\r\nContent-Disposition: form-data; name="campo"\r\n\r\nvalor\r\n`,
      `--${f}\r\nContent-Disposition: form-data; name="texto"\r\n\r\nolá ✓\r\n`,
      `--${f}\r\nContent-Disposition: form-data; name="arq"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nconteudo do arquivo\r\n`,
      `--${f}--\r\n`,
    ].join('');
    const { requestId } = await enviarCru(token, '/upload', { corpo, cabecalhos: [['Content-Type', `multipart/form-data; boundary=${f}`]] });
    const msg = await buscarMensagem(token, requestId);
    assert.deepEqual(msg.request, { campo: 'valor', texto: 'olá ✓' }, 'pré-condição: campos de texto gravados');
    assert.equal(msg.content, '', 'pré-condição: o servidor não guarda o corpo multipart');

    const rec = await app.esperarCaminho('/upload');
    assert.equal(rec.metodo, 'POST');
    const [tipo] = valores(rec, 'content-type');
    assert.match(tipo ?? '', /^multipart\/form-data;\s*boundary=/i, 'Content-Type multipart com boundary');
    const campos = lerMultipart(rec.corpo, tipo);
    assert.deepEqual(
      campos.filter((c) => !c.arquivo).map((c) => [c.nome, c.valor]).sort(),
      [['campo', 'valor'], ['texto', 'olá ✓']],
      'campos de texto reenviados',
    );
    assert.deepEqual(campos.filter((c) => c.arquivo), [], 'nenhum arquivo reenviado');
    assert.deepEqual(valores(rec, 'content-length'), [String(rec.corpo.length)]);
    await cli.esperarLinha(linhaMensagem('POST', caminhoGravado(msg), 200, AVISO_MULTIPART));
  });
});
