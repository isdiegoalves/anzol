import assert from 'node:assert/strict';
import { after, afterEach, describe, test } from 'node:test';
import { SERVIDOR, pausa } from './support/ambiente.mjs';
import { iniciarCapturador } from './support/capturador.mjs';
import { LINHA_RECONEXAO, iniciarCli, linhaListening, saidaDosClis } from './support/cli.mjs';
import { limparTudo } from './support/limpeza.mjs';
import { iniciarProxy } from './support/proxy.mjs';
import {
  apagarMensagem, caminhoGravado, criarToken, enviarCru, maisNovas, mensagensPorSeq, rajada, uuidsNaOrdemDeChegada,
} from './support/servidor.mjs';

afterEach(limparTudo);
after(limparTudo);

// Ordem de reenvio = ordem de `seq` (a da gravação), lida pela API com `after=0` depois da rajada.
// O evento SSE sai fora dessa ordem quando as gravações são concorrentes: o CLI não pode seguir o
// SSE nem parar num cursor de paginação por página.

/** Espera `condicao()` ficar verdadeira; devolve false no prazo (quem chama confere e explica). */
async function esperarAte(condicao, prazo) {
  const limite = Date.now() + prazo;
  while (Date.now() < limite) {
    if (await condicao()) return true;
    await pausa(100);
  }
  return false;
}

/**
 * O app local recebeu cada caminho de `esperados` exatamente uma vez, na ordem dada, e nada mais.
 * Os de `opcionais` (apagados durante o teste) podem faltar, mas se chegarem é uma vez e no lugar.
 */
function conferirOrdem(app, esperados, { opcionais = [], contexto = '' } = {}) {
  const recebidos = app.recebidas.map((r) => r.url);
  const detalhe = () => `${contexto}\nesperados (ordem de seq): ${esperados.join(' ')}\nrecebidos: ${recebidos.join(' ')}\n${saidaDosClis()}`;
  const duplicados = [...new Set(recebidos.filter((u, i) => recebidos.indexOf(u) !== i))];
  assert.deepEqual(duplicados, [], `reenviados mais de uma vez\n${detalhe()}`);
  const estranhos = recebidos.filter((u) => !esperados.includes(u));
  assert.deepEqual(estranhos, [], `reenviados sem estar na URL\n${detalhe()}`);
  const perdidos = esperados.filter((c) => !recebidos.includes(c) && !opcionais.includes(c));
  assert.deepEqual(perdidos, [], `gravados e nunca reenviados\n${detalhe()}`);
  assert.deepEqual(recebidos, esperados.filter((c) => recebidos.includes(c)), `reenvio fora da ordem de seq\n${detalhe()}`);
}

describe('anzol listen: ordem de seq, sem perda, com gravação concorrente', () => {
  test('CA-10: rajada de 60 (30 em paralelo) e queda logo depois de um evento: todas chegam uma vez, em ordem de seq', { timeout: 180_000 }, async () => {
    const token = await criarToken();
    const entregues = []; // uuids que o SSE entregou ao CLI antes do corte
    let corte = null;
    const proxy = await iniciarProxy(SERVIDOR, {
      // Corta logo depois do primeiro evento que chega antes de outro mais antigo (no índice) ainda
      // não entregue; se a rajada não inverter nada até o 25º evento, corta depois dele.
      async aoEvento(evento) {
        if (corte || evento.request?.token_id !== token) return;
        entregues.push(evento.request.uuid);
        const indice = await uuidsNaOrdemDeChegada(token);
        const pos = indice.indexOf(evento.request.uuid);
        const pendentes = pos < 0 ? [] : indice.slice(0, pos).filter((u) => !entregues.includes(u));
        if (pendentes.length > 0 || entregues.length >= 25) {
          corte = { eventos: entregues.length, pendentes: pendentes.length };
          await proxy.derrubar();
        }
      },
    });
    const app = await iniciarCapturador();
    const cli = await iniciarCli(['listen', '--server', proxy.url, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(linhaListening(proxy.url, app.url, token));

    const disparo = rajada(token, 60, { paralelas: 30 });
    assert.ok(await esperarAte(() => corte !== null, 30_000), `o proxy não cortou o SSE durante a rajada (eventos entregues: ${entregues.length})\n${saidaDosClis()}`);
    await pausa(1_000);
    await proxy.religar();
    await disparo;
    await cli.esperarLinha(LINHA_RECONEXAO, { prazo: 60_000 });

    const esperados = (await mensagensPorSeq(token)).map(caminhoGravado);
    assert.equal(esperados.length, 60, 'mensagens gravadas');
    await esperarAte(() => app.recebidas.length >= esperados.length, 60_000);
    await pausa(1_500); // janela para uma duplicata tardia aparecer
    const contexto = `corte depois do ${corte.eventos}º evento, com ${corte.pendentes} mensagem(ns) mais antiga(s) ainda sem evento`;
    conferirOrdem(app, esperados, { contexto });
    assert.deepEqual(proxy.erros, [], 'erros nos ganchos do proxy');
  });

  test('CA-11: rajada de 60 (30 em paralelo) sem queda: reenvio na ordem de seq, cada uma uma vez', { timeout: 120_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarCapturador();
    const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(linhaListening(SERVIDOR, app.url, token));

    await rajada(token, 60, { paralelas: 30 });
    const esperados = (await mensagensPorSeq(token)).map(caminhoGravado);
    assert.equal(esperados.length, 60, 'mensagens gravadas');
    await esperarAte(() => app.recebidas.length >= esperados.length, 60_000);
    await pausa(1_500);
    conferirOrdem(app, esperados);
  });

  test('CA-12: as 3 mais novas apagadas durante a recuperação de 120: as demais chegam todas, uma vez, em ordem de seq', { timeout: 180_000 }, async () => {
    const token = await criarToken();
    let recuperando = false;
    let apagadas = null; // mensagens apagadas pelo gancho
    const proxy = await iniciarProxy(SERVIDOR, {
      // Na primeira listagem da recuperação: o servidor já respondeu, o CLI ainda não viu a
      // resposta; as 3 mais novas somem antes de o CLI pedir a próxima página.
      antesDaResposta(linha) {
        if (!recuperando || apagadas || !/^GET \/token\/[^/?]+\/requests(\?|$)/.test(linha)) return undefined;
        apagadas = [];
        return async () => {
          for (const m of await maisNovas(token, 3)) {
            await apagarMensagem(token, m.uuid);
            apagadas.push(m);
          }
        };
      },
    });
    const app = await iniciarCapturador();
    const cli = await iniciarCli(['listen', '--server', proxy.url, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(linhaListening(proxy.url, app.url, token));

    await proxy.derrubar();
    await rajada(token, 120, { paralelas: 10 });
    const todas = await mensagensPorSeq(token);
    assert.equal(todas.length, 120, 'mensagens gravadas na queda');
    recuperando = true;
    await proxy.religar();
    await cli.esperarLinha(LINHA_RECONEXAO, { prazo: 60_000 });

    const apagou = await esperarAte(() => apagadas?.length === 3, 30_000);
    assert.ok(apagou, `a recuperação não listou mensagens pela API (GET /token/{id}/requests)\n${saidaDosClis()}`);
    const esperados = todas.map(caminhoGravado);
    const restantes = new Set((await mensagensPorSeq(token)).map(caminhoGravado));
    assert.equal(restantes.size, 117, 'mensagens restantes depois de apagar as 3 mais novas');
    await esperarAte(() => app.recebidas.filter((r) => restantes.has(r.url)).length >= restantes.size, 60_000);
    await pausa(1_500);
    conferirOrdem(app, esperados, {
      opcionais: apagadas.map(caminhoGravado),
      contexto: `apagadas durante a recuperação: ${apagadas.map(caminhoGravado).join(' ')}`,
    });
    assert.deepEqual(proxy.erros, [], 'erros nos ganchos do proxy');
  });

  test('CA-13: a mensagem do cursor apagada durante a queda: nenhuma anterior ao listen é reenviada', { timeout: 150_000 }, async () => {
    const token = await criarToken();
    // Anteriores ao listen, no mesmo segundo (o corte por created_at não as separa da do cursor).
    for (const caminho of ['/antes-1', '/antes-2', '/antes-3']) {
      await enviarCru(token, caminho, { corpo: caminho, cabecalhos: [['Content-Type', 'text/plain']] });
    }
    const proxy = await iniciarProxy(SERVIDOR);
    const app = await iniciarCapturador();
    const cli = await iniciarCli(['listen', '--server', proxy.url, '--token', token, '--forward', app.url]);
    await cli.esperarLinha(linhaListening(proxy.url, app.url, token));

    await proxy.derrubar();
    const [cursor] = await maisNovas(token, 1);
    assert.equal(caminhoGravado(cursor), '/antes-3', 'a mais nova ao iniciar o listen');
    await apagarMensagem(token, cursor.uuid);
    await enviarCru(token, '/depois', { corpo: '/depois', cabecalhos: [['Content-Type', 'text/plain']] });
    await pausa(1_000);
    await proxy.religar();

    const [, n] = await cli.esperarLinha(LINHA_RECONEXAO, { prazo: 60_000 });
    await app.esperarCaminho('/depois', { prazo: 20_000 });
    await pausa(1_500);
    assert.deepEqual(app.recebidas.map((r) => r.url), ['/depois'], `só a mensagem gravada durante a queda é reenviada\n${saidaDosClis()}`);
    assert.equal(Number(n), 1, 'mensagens gravadas durante a queda');
  });
});
