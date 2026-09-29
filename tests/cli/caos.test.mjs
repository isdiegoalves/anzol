import assert from 'node:assert/strict';
import { after, afterEach, describe, test } from 'node:test';
import { SERVIDOR, literal } from './support/ambiente.mjs';
import { iniciarCli, linhaListening } from './support/cli.mjs';
import { limparTudo } from './support/limpeza.mjs';
import { iniciarReceptor } from './support/receptor.mjs';
import { criarToken, enviarCru } from './support/servidor.mjs';

afterEach(limparTudo);
after(limparTudo);

const HORA = String.raw`\d{2}:\d{2}:\d{2}`;

/** Linha inteira de uma entrega do caminho `caminho` (após o token): `HH:mm:ss MÉTODO …caminho resto`. */
function linha(metodo, caminho, resto) {
  return new RegExp(`^${HORA} ${metodo} \\S*${literal(caminho)} ${resto}$`);
}

/** POST em `/{token}{caminho}` com corpo e `X-Request-Id` próprios; devolve o id gravado. */
async function webhook(token, caminho, corpo = `corpo de ${caminho}`) {
  const { requestId } = await enviarCru(token, caminho, {
    corpo,
    cabecalhos: [
      ['Content-Type', 'text/plain; charset=utf-8'],
      ['X-Request-Id', `evt${caminho}`],
    ],
  });
  return requestId;
}

async function escutar(token, app, caos) {
  const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', app.url, ...caos]);
  await cli.esperarLinha(linhaListening(SERVIDOR, app.url, token));
  return cli;
}

/** Cabeçalhos sem os que o cliente HTTP escolhe por conexão. */
function essenciais(requisicao) {
  return requisicao.cabecalhos.filter(([n]) => n !== 'connection').sort();
}

/**
 * Manda `/caos/1..n` e mais uma sentinela, espera a linha de cada uma e devolve, por mensagem, o que o caos fez:
 * `descartada`, `duplicada` ou `normal`. As entregas são em série: quando a linha da sentinela sai, a duplicata da
 * última mensagem já saiu.
 */
async function rodada(token, app, caos, n) {
  const cli = await escutar(token, app, caos);
  const caminhos = Array.from({ length: n }, (_, i) => `/caos/${i + 1}`);
  for (const caminho of [...caminhos, '/caos/sentinela']) {
    await webhook(token, caminho);
    await cli.esperarLinha(linha('POST', caminho, String.raw`-> (dropped \[chaos: drop\]|200 \(\d+ ms\))`));
  }
  const textos = cli.linhas.map((l) => l.texto);
  const destinos = caminhos.map((caminho) => {
    const deste = textos.filter((t) => t.includes(` ${caminho} -> `));
    if (deste.some((t) => t.endsWith('-> dropped [chaos: drop]'))) return 'descartada';
    return deste.some((t) => t.endsWith('[chaos: duplicate]')) ? 'duplicada' : 'normal';
  });
  return { cli, destinos };
}

describe('anzol listen com caos', () => {
  test('--chaos-duplicate 50 --chaos-seed 7: as sorteadas chegam duas vezes, em seguida, com os mesmos bytes; a semente repete', { timeout: 120_000 }, async () => {
    const caos = ['--chaos-duplicate', '50', '--chaos-seed', '7'];
    const primeiro = await iniciarReceptor();
    const a = await rodada(await criarToken(), primeiro, caos, 8);
    await a.cli.esperarLinha(/^Chaos: duplicate 50%; seed 7$/);
    assert.ok(a.destinos.includes('duplicada') && a.destinos.includes('normal'), `a semente 7 deveria misturar: ${a.destinos}`);

    const esperado = a.destinos.flatMap((d, i) => (d === 'duplicada' ? [`/caos/${i + 1}`, `/caos/${i + 1}`] : [`/caos/${i + 1}`]));
    const chegadas = primeiro.recebidas.filter((r) => r.url !== '/caos/sentinela');
    assert.deepEqual(chegadas.map((r) => r.url), esperado, 'a duplicata chega logo depois da original');
    for (let i = 0; i + 1 < chegadas.length; i++) {
      if (chegadas[i].url !== chegadas[i + 1].url) continue;
      assert.deepEqual(essenciais(chegadas[i + 1]), essenciais(chegadas[i]), `cabeçalhos da duplicata de ${chegadas[i].url}`);
      assert.ok(chegadas[i + 1].corpo.equals(chegadas[i].corpo), `corpo da duplicata de ${chegadas[i].url}`);
      assert.deepEqual(chegadas[i].cabecalhos.find(([n]) => n === 'x-request-id'), ['x-request-id', `evt${chegadas[i].url}`]);
    }

    const b = await rodada(await criarToken(), await iniciarReceptor(), caos, 8);
    assert.deepEqual(b.destinos, a.destinos, 'mesma semente, mesmas mensagens duplicadas');
  });

  test('--chaos-drop 50 --chaos-seed 11: as sorteadas não chegam, a linha diz dropped, e a semente repete', { timeout: 120_000 }, async () => {
    const caos = ['--chaos-drop', '50', '--chaos-seed', '11'];
    const app = await iniciarReceptor();
    const a = await rodada(await criarToken(), app, caos, 6);
    assert.ok(a.destinos.includes('descartada') && a.destinos.includes('normal'), `a semente 11 deveria misturar: ${a.destinos}`);
    const entregues = a.destinos.flatMap((d, i) => (d === 'descartada' ? [] : [`/caos/${i + 1}`]));
    assert.deepEqual(app.recebidas.map((r) => r.url).filter((u) => u !== '/caos/sentinela'), entregues);

    const b = await rodada(await criarToken(), await iniciarReceptor(), caos, 6);
    assert.deepEqual(b.destinos, a.destinos, 'mesma semente, mesmas mensagens descartadas');
  });

  test('--chaos-delay 300..0.6s: a entrega sai depois do atraso sorteado, que a linha mostra', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarReceptor();
    const cli = await escutar(token, app, ['--chaos-delay', '300..0.6s']);

    const enviado = Date.now();
    await webhook(token, '/atraso');

    const [, atraso] = await cli.esperarLinha(linha('POST', '/atraso', String.raw`-> 200 \(\d+ ms\) \[chaos: delay (\d+) ms\]`));
    assert.ok(Number(atraso) >= 300 && Number(atraso) <= 600, `atraso sorteado ${atraso} fora de 300..600`);
    const [chegada] = await app.esperarQuantas(1);
    assert.ok(chegada.inicio - enviado >= Number(atraso), `chegou ${chegada.inicio - enviado} ms depois do envio, antes do atraso de ${atraso} ms`);
  });

  test('--chaos-reorder 3: segura 3 e entrega noutra ordem; a linha diz a posição de chegada', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarReceptor();
    const cli = await escutar(token, app, ['--chaos-reorder', '3', '--chaos-seed', '5']);

    for (let i = 1; i <= 3; i++) {
      await webhook(token, `/ordem/${i}`);
      await cli.esperarLinha(linha('POST', `/ordem/${i}`, String.raw`-> held ${i} of 3 \[chaos: reorder\]`));
    }

    const ordem = (await app.esperarQuantas(3)).map((r) => r.url);
    assert.deepEqual([...ordem].sort(), ['/ordem/1', '/ordem/2', '/ordem/3']);
    assert.notDeepEqual(ordem, ['/ordem/1', '/ordem/2', '/ordem/3'], 'a leva não sai na ordem de chegada');
    for (const url of ordem) {
      const chegou = url.split('/').pop();
      await cli.esperarLinha(linha('POST', url, String.raw`-> 200 \(\d+ ms\) \[chaos: reordered \(arrived ${chegou} of 3\)\]`));
    }
  });

  test('--chaos-reorder 3 com só 2: a leva incompleta sai trocada 2 s depois da última', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarReceptor();
    const cli = await escutar(token, app, ['--chaos-reorder', '3']);

    await webhook(token, '/par/1');
    await webhook(token, '/par/2');
    await cli.esperarLinha(linha('POST', '/par/2', String.raw`-> held 2 of 3 \[chaos: reorder\]`));
    const segura = Date.now();

    const chegadas = await app.esperarQuantas(2);
    assert.deepEqual(chegadas.map((r) => r.url), ['/par/2', '/par/1']);
    assert.ok(chegadas[0].inicio - segura >= 1_500, `saiu ${chegadas[0].inicio - segura} ms depois de segurar; esperado ~2 s`);
  });

  test('--chaos-abort 100: o app recebe cabeçalhos com o Content-Length inteiro, metade do corpo, e a conexão fecha', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarReceptor();
    const cli = await escutar(token, app, ['--chaos-abort', '100']);
    const corpo = 'x'.repeat(600) + 'ç'.repeat(200);

    await webhook(token, '/corte', corpo);

    await cli.esperarLinha(linha('POST', '/corte', String.raw`-> cut after 500 of 1000 bytes \[chaos: abort\]`));
    const [chegada] = await app.esperarQuantas(1);
    assert.equal(chegada.completa, false, 'o app vê a requisição incompleta');
    assert.equal(chegada.declarado, 1000);
    assert.ok(chegada.corpo.equals(Buffer.from(corpo, 'utf8').subarray(0, 500)), `chegaram ${chegada.corpo.length} bytes`);
    assert.deepEqual(chegada.cabecalhos.find(([n]) => n === 'x-request-id'), ['x-request-id', 'evt/corte']);
  });

  test('--chaos-slow 50: o corpo pinga aos pedaços por ~2 s e chega inteiro', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarReceptor();
    const cli = await escutar(token, app, ['--chaos-slow', '50']);
    const corpo = 'abcdefghij'.repeat(10);

    await webhook(token, '/lento', corpo);

    const [, ms] = await cli.esperarLinha(linha('POST', '/lento', String.raw`-> 200 \((\d+) ms\) \[chaos: slow 50 B/s\]`));
    const [chegada] = await app.esperarQuantas(1);
    assert.equal(chegada.corpo.toString(), corpo);
    assert.ok(chegada.pedacos.length >= 5, `${chegada.pedacos.length} pedaços`);
    assert.ok(chegada.pedacos.at(-1) - chegada.inicio >= 1_500, `o corpo levou ${chegada.pedacos.at(-1) - chegada.inicio} ms`);
    assert.ok(Number(ms) >= 1_500, `a linha diz ${ms} ms`);
  });

  test('--chaos-timeout 500ms: desiste do app que demora 5 s e diz na linha', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarReceptor({ responder: () => ({ atraso: 5_000 }) });
    const cli = await escutar(token, app, ['--chaos-timeout', '500ms']);

    const enviado = Date.now();
    await webhook(token, '/demora');

    await cli.esperarLinha(linha('POST', '/demora', String.raw`-> error: timed out after 500 ms \[chaos: timeout\]`));
    assert.ok(Date.now() - enviado < 4_000, `a linha saiu ${Date.now() - enviado} ms depois do envio`);
    const [chegada] = await app.esperarQuantas(1);
    assert.equal(chegada.completa, true);
  });

  test('--retries 2 com 503, 503, 200: três tentativas iguais, backoff com jitter e a linha de cada uma', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarReceptor({ responder: (_, i) => ({ status: i < 2 ? 503 : 200 }) });
    const cli = await escutar(token, app, ['--retries', '2']);

    await webhook(token, '/retenta');

    const [, primeira] = await cli.esperarLinha(linha('POST', '/retenta', String.raw`attempt 1/3 -> 503 \(\d+ ms\), retrying in (\d+) ms`));
    const [, segunda] = await cli.esperarLinha(linha('POST', '/retenta', String.raw`attempt 2/3 -> 503 \(\d+ ms\), retrying in (\d+) ms`));
    await cli.esperarLinha(linha('POST', '/retenta', String.raw`attempt 3/3 -> 200 \(\d+ ms\)`));
    assert.ok(Number(primeira) >= 500 && Number(primeira) <= 1_000, `1ª espera ${primeira} fora de 500..1000`);
    assert.ok(Number(segunda) >= 1_000 && Number(segunda) <= 2_000, `2ª espera ${segunda} fora de 1000..2000`);

    const chegadas = await app.esperarQuantas(3);
    for (const outra of chegadas.slice(1)) {
      assert.deepEqual(essenciais(outra), essenciais(chegadas[0]), 'a retentativa repete os cabeçalhos');
      assert.ok(outra.corpo.equals(chegadas[0].corpo), 'a retentativa repete o corpo');
    }
    assert.ok(chegadas[1].inicio - chegadas[0].inicio >= Number(primeira) - 20);
    assert.ok(chegadas[2].inicio - chegadas[1].inicio >= Number(segunda) - 20);
  });

  test('--retries com 429 e Retry-After: 1: espera 1000 ms, como o app pediu', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarReceptor({ responder: (_, i) => (i === 0 ? { status: 429, cabecalhos: { 'Retry-After': '1' } } : {}) });
    const cli = await escutar(token, app, ['--retries', '3']);

    await webhook(token, '/limite');

    await cli.esperarLinha(linha('POST', '/limite', String.raw`attempt 1/4 -> 429 \(\d+ ms\), retrying in 1000 ms \(Retry-After\)`));
    await cli.esperarLinha(linha('POST', '/limite', String.raw`attempt 2/4 -> 200 \(\d+ ms\)`));
    const chegadas = await app.esperarQuantas(2);
    assert.ok(chegadas[1].inicio - chegadas[0].inicio >= 980, `esperou ${chegadas[1].inicio - chegadas[0].inicio} ms`);
  });

  test('opção de caos inválida: saída 2, a opção citada no stderr e nada entregue', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const app = await iniciarReceptor();
    for (const caos of [['--chaos-drop', '150'], ['--chaos-delay', '5..1'], ['--chaos-reorder', '1'], ['--retries', '11'], ['--chaos-timeout', '0']]) {
      const cli = await iniciarCli(['listen', '--server', SERVIDOR, '--token', token, '--forward', app.url, ...caos]);
      const { codigo } = await cli.esperarSaida();
      assert.equal(codigo, 2, `${caos.join(' ')}: código de saída\n${cli.descricao()}`);
      assert.ok(cli.linhasQueCasam(new RegExp(literal(caos[0]))).length > 0, `${caos[0]} não aparece na saída\n${cli.descricao()}`);
    }
    await webhook(token, '/nada');
    assert.equal(app.recebidas.length, 0);
  });
});

describe('anzol replay com caos', () => {
  test('vários ids com --chaos-reorder 3: entrega os três noutra ordem e sai com 0', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const ids = [];
    for (let i = 1; i <= 3; i++) ids.push(await webhook(token, `/replay/${i}`));
    const app = await iniciarReceptor();

    const cli = await iniciarCli(['replay', token, ...ids, '--to', app.url, '--server', SERVIDOR, '--chaos-reorder', '3', '--chaos-seed', '9']);
    const { codigo } = await cli.esperarSaida(30_000);

    assert.equal(codigo, 0, cli.descricao());
    const ordem = app.recebidas.map((r) => r.url);
    assert.deepEqual([...ordem].sort(), ['/replay/1', '/replay/2', '/replay/3']);
    assert.notDeepEqual(ordem, ['/replay/1', '/replay/2', '/replay/3']);
  });

  test('--chaos-duplicate 100: a mensagem chega duas vezes com os mesmos bytes; --chaos-abort 100: sai com 1', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const id = await webhook(token, '/replay/dup');

    const dobro = await iniciarReceptor();
    const duplicando = await iniciarCli(['replay', token, id, '--to', dobro.url, '--server', SERVIDOR, '--chaos-duplicate', '100']);
    assert.equal((await duplicando.esperarSaida(30_000)).codigo, 0, duplicando.descricao());
    const [original, copia] = dobro.recebidas;
    assert.equal(dobro.recebidas.length, 2);
    assert.deepEqual(essenciais(copia), essenciais(original));
    assert.ok(copia.corpo.equals(original.corpo));

    const corte = await iniciarReceptor();
    const cortando = await iniciarCli(['replay', token, id, '--to', corte.url, '--server', SERVIDOR, '--chaos-abort', '100']);
    assert.equal((await cortando.esperarSaida(30_000)).codigo, 1, cortando.descricao());
    assert.equal(corte.recebidas[0].completa, false);
  });
});
