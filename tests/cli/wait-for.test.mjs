import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { CLI, SERVIDOR, UUID, pausa } from './support/ambiente.mjs';
import { iniciarCli } from './support/cli.mjs';
import { aoFinal, limparTudo } from './support/limpeza.mjs';
import { buscarMensagem, criarToken, enviarCru } from './support/servidor.mjs';

// Aceite do `anzol wait-for` (CA-6, §1 do plano "wait-for"): o CLI espera, com prazo, até o servidor
// ter `--count` mensagens que casam o `match` montado pelos atalhos e/ou pelo `--match`. stdout = JSON
// das mensagens que casaram (um array); stderr = resumo; saída 0 casou, 1 prazo acabou, 2 uso inválido,
// 422, token inexistente ou servidor fora. Os atalhos são conferidos pelo efeito: mensagens gravadas
// que só um `match` montado certo separa.

afterEach(limparTudo);
after(limparTudo);

/**
 * `ANZOL_SERVER` que o CLI herda: porta fechada. Só o `--server` depois do subcomando leva ao app,
 * então um CLI que o ignore falha em todos.
 */
const SERVIDOR_MORTO = 'http://127.0.0.1:9';

/** Opção ou comando que não existe: o CLI sob teste não tem `wait-for` (ou alguma opção dele). */
const SEM_COMANDO = /no such (sub)?command|no such option|unknown (command|option)/i;

// ---- formato do resumo no stderr (§1: "Saída") ----
const LINHA_CASOU = /^matched (\d+)\/(\d+) in (\d+) ms$/;
const LINHA_PRAZO = /^timed out after (\d+) ms: (\d+)\/(\d+) matched$/;
const LINHA_CLOSEST = new RegExp(`^closest: #(\\d+) (${UUID.source})$`);
const LINHA_FRASE = /^ {2}- (.+)$/;

/**
 * Roda `anzol wait-for <args> --server <servidor>` até o fim e devolve código, stdout, stderr e o
 * tempo de parede. Erro de uso por comando/opção inexistente vira falha com mensagem clara.
 */
async function waitFor(args, { servidor = SERVIDOR, prazo = 60_000 } = {}) {
  const anterior = process.env.ANZOL_SERVER;
  process.env.ANZOL_SERVER = SERVIDOR_MORTO;
  let cli;
  const inicio = Date.now();
  try {
    cli = await iniciarCli(['wait-for', ...args, '--server', servidor]);
  } finally {
    if (anterior === undefined) delete process.env.ANZOL_SERVER;
    else process.env.ANZOL_SERVER = anterior;
  }
  const { codigo } = await cli.esperarSaida(prazo);
  const ms = Date.now() - inicio;
  const fluxo = (f) => cli.linhas.filter((l) => l.fluxo === f).map((l) => l.texto);
  const r = { cli, codigo, ms, stdout: fluxo('stdout').join('\n'), stderr: fluxo('stderr') };
  if (SEM_COMANDO.test(r.stderr.join('\n'))) {
    throw new Error(`o CLI em ${CLI} recusou a linha de comando; falta \`anzol wait-for\` ou alguma opção dele (${args.filter((a) => a.startsWith('--')).join(' ')})?\n${cli.descricao()}`);
  }
  return r;
}

/** stdout inteiro como JSON; tem de ser um array. */
function mensagensDoStdout(r) {
  let valor;
  try {
    valor = JSON.parse(r.stdout);
  } catch (e) {
    assert.fail(`stdout não é JSON válido (${e.message})\n${r.cli.descricao()}`);
  }
  assert.ok(Array.isArray(valor), `stdout deve ser um array JSON, veio ${typeof valor}\n${r.cli.descricao()}`);
  return valor;
}

/** Linha do stderr que casa com a regex (exatamente uma). */
function linhaDoStderr(r, regex) {
  const achadas = r.stderr.map((t) => regex.exec(t)).filter(Boolean);
  assert.equal(achadas.length, 1, `esperada uma linha ${regex} no stderr\n${r.cli.descricao()}`);
  return achadas[0];
}

/** Saída 0: stdout = as mensagens esperadas (completas, como a API as grava), resumo `matched n/n`. */
async function conferirCasou(r, token, esperadas, count = esperadas.length) {
  assert.equal(r.codigo, 0, `código de saída (casou)\n${r.cli.descricao()}`);
  const msgs = mensagensDoStdout(r);
  assert.deepEqual(msgs.map((m) => m.uuid), esperadas.map((m) => m.uuid), `mensagens no stdout\n${r.cli.descricao()}`);
  for (const m of msgs) assert.deepEqual(m, await buscarMensagem(token, m.uuid), `mensagem ${m.uuid} incompleta no stdout`);
  const [, n, total] = linhaDoStderr(r, LINHA_CASOU);
  assert.deepEqual([Number(n), Number(total)], [esperadas.length, count], `resumo: ${r.stderr.join(' | ')}`);
  return msgs;
}

/** Saída 1: stdout = as que casaram (array), resumo `timed out after <ms> ms: n/count matched`. */
function conferirPrazo(r, casaram, count) {
  assert.equal(r.codigo, 1, `código de saída (prazo acabou)\n${r.cli.descricao()}`);
  const msgs = mensagensDoStdout(r);
  assert.deepEqual(msgs.map((m) => m.uuid), casaram.map((m) => m.uuid), `stdout no prazo esgotado\n${r.cli.descricao()}`);
  const [, ms, n, total] = linhaDoStderr(r, LINHA_PRAZO);
  assert.deepEqual([Number(n), Number(total)], [casaram.length, count], `resumo: ${r.stderr.join(' | ')}`);
  return { ms: Number(ms) };
}

/** Saída 2 com mensagem no stderr. */
function conferirErro(r, oque) {
  assert.equal(r.codigo, 2, `${oque}: código de saída\n${r.cli.descricao()}`);
  assert.ok(r.stderr.join('').trim().length > 0, `${oque}: sem mensagem no stderr\n${r.cli.descricao()}`);
}

/** Webhook gravado no token; devolve a mensagem como a API a guarda. */
async function enviar(token, caminho, { metodo = 'POST', cabecalhos = [], corpo } = {}) {
  const { requestId } = await enviarCru(token, caminho, { metodo, cabecalhos, corpo });
  return buscarMensagem(token, requestId);
}

const JSON_CT = [['Content-Type', 'application/json']];
const json = (token, caminho, valor) => enviar(token, caminho, { cabecalhos: JSON_CT, corpo: JSON.stringify(valor) });

function pastaTemporaria() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aceite-wait-for-'));
  aoFinal(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('anzol wait-for: atalhos montam o match', () => {
  test('--method é lista: casa qualquer um dos métodos, em ordem de seq', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await enviar(token, '/m', { metodo: 'POST' });
    const put = await enviar(token, '/m', { metodo: 'PUT' });
    const get = await enviar(token, '/m', { metodo: 'GET' });

    const r = await waitFor(['--token', token, '--method', 'PUT', '--method', 'GET', '--count', '2', '--timeout', '0']);
    await conferirCasou(r, token, [put, get]);
  });

  test('--path é prefixo do caminho (não trecho nem caminho exato)', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const filho = await enviar(token, '/pedidos/1');
    await enviar(token, '/x/pedidos');
    const exato = await enviar(token, '/pedidos');
    await enviar(token, '/outra');

    const r = await waitFor(['--token', token, '--path', '/pedidos', '--count', '2', '--timeout', '0']);
    await conferirCasou(r, token, [filho, exato]);
  });

  test('--header "Nome: valor" é igualdade, nome sem caixa, vários em E', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await enviar(token, '/h', { cabecalhos: [['X-Evento', 'pago-parcial'], ['X-Conta', '7']] });
    await enviar(token, '/h', { cabecalhos: [['X-Evento', 'pago']] });
    const certa = await enviar(token, '/h', { cabecalhos: [['X-Evento', 'pago'], ['X-Conta', '7']] });

    const r = await waitFor(['--token', token, '--header', 'x-evento: pago', '--header', 'X-Conta: 7', '--timeout', '0']);
    await conferirCasou(r, token, [certa]);
  });

  test('--body-contains é "contém" no corpo', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await enviar(token, '/b', { corpo: 'pedido-4' });
    const certa = await enviar(token, '/b', { corpo: 'o pedido-42 chegou' });

    const r = await waitFor(['--token', token, '--body-contains', 'pedido-42', '--timeout', '0']);
    await conferirCasou(r, token, [certa]);
  });

  test('--json-path sem = : o caminho existe no corpo JSON', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await enviar(token, '/j', { corpo: 'status' });
    await json(token, '/j', { outro: 1 });
    const certa = await json(token, '/j', { status: 'x' });

    const r = await waitFor(['--token', token, '--json-path', '$.status', '--timeout', '0']);
    await conferirCasou(r, token, [certa]);
  });

  test('--json-path com = : o valor depois do = é JSON (número 10 não casa o texto "10")', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await json(token, '/j', { valor: '10' });
    const numero = await json(token, '/j', { valor: 10 });

    const r = await waitFor(['--token', token, '--json-path', '$.valor=10', '--timeout', '0']);
    await conferirCasou(r, token, [numero]);
  });

  test('--json-path com = : valor que não é JSON vale como texto; "texto" JSON dá o mesmo', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await json(token, '/j', { status: 'pendente' });
    const pago = await json(token, '/j', { status: 'pago' });

    await conferirCasou(await waitFor(['--token', token, '--json-path', '$.status=pago', '--timeout', '0']), token, [pago]);
    await conferirCasou(await waitFor(['--token', token, '--json-path', '$.status="pago"', '--timeout', '0']), token, [pago]);
  });

  test('--json-path corta no primeiro = (o resto é o valor)', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await json(token, '/j', { expr: 'a' });
    const certa = await json(token, '/j', { expr: 'a=b' });

    const r = await waitFor(['--token', token, '--json-path', '$.expr=a=b', '--timeout', '0']);
    await conferirCasou(r, token, [certa]);
  });

  test('--json-path repetido e --body-contains somam condições de corpo em E', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await json(token, '/j', { status: 'pago', valor: 9, nota: 'pedido-7' });
    await json(token, '/j', { status: 'pendente', valor: 10, nota: 'pedido-7' });
    await json(token, '/j', { status: 'pago', valor: 10 });
    const certa = await json(token, '/j', { status: 'pago', valor: 10, nota: 'pedido-7' });

    const r = await waitFor([
      '--token', token, '--json-path', '$.status=pago', '--json-path', '$.valor=10', '--body-contains', 'pedido', '--timeout', '0',
    ]);
    await conferirCasou(r, token, [certa]);
  });
});

describe('anzol wait-for: --match e --match-file', () => {
  const MATCH = { method: ['POST'], query: { tipo: { equals: 'pix' } } };

  async function gravarTres(token) {
    await enviar(token, '/q?tipo=pix', { metodo: 'GET' });
    await enviar(token, '/q?tipo=boleto', { metodo: 'POST' });
    return enviar(token, '/q?tipo=pix', { metodo: 'POST' });
  }

  test('--match <json> casa como o match de uma regra', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const certa = await gravarTres(token);
    const r = await waitFor(['--token', token, '--match', JSON.stringify(MATCH), '--timeout', '0']);
    await conferirCasou(r, token, [certa]);
  });

  test('--match-file <arquivo> lê o mesmo match do arquivo', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const certa = await gravarTres(token);
    const arquivo = path.join(pastaTemporaria(), 'match.json');
    fs.writeFileSync(arquivo, JSON.stringify(MATCH, null, 2));
    const r = await waitFor(['--token', token, '--match-file', arquivo, '--timeout', '0']);
    await conferirCasou(r, token, [certa]);
  });

  test('atalhos se somam ao --match; atalho de mesma chave substitui a do --match', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await enviar(token, '/a', { metodo: 'POST' });
    await enviar(token, '/b/1', { metodo: 'GET' });
    const certa = await enviar(token, '/b/2', { metodo: 'POST' });

    const r = await waitFor(['--token', token, '--match', JSON.stringify({ method: ['POST'], path: { equals: '/a' } }), '--path', '/b', '--timeout', '0']);
    await conferirCasou(r, token, [certa]);
  });
});

describe('anzol wait-for: saída e códigos', () => {
  test('prazo sem casar → saída 1, stdout [], resumo com closest e uma linha por condição falhada', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const perto = await enviar(token, '/pagamentos', { metodo: 'PUT' });

    const r = await waitFor(['--token', token, '--method', 'POST', '--path', '/pagamentos', '--timeout', '1500']);
    const { ms } = conferirPrazo(r, [], 1);
    assert.ok(ms >= 1_400, `resumo diz ${ms} ms; o prazo era 1500`);
    assert.ok(r.ms >= 1_400, `o CLI terminou em ${r.ms} ms, antes do prazo de 1500`);
    const [, seq, uuid] = linhaDoStderr(r, LINHA_CLOSEST);
    assert.deepEqual([Number(seq), uuid], [perto.seq, perto.uuid], `closest: ${r.stderr.join(' | ')}`);
    const frases = r.stderr.map((t) => LINHA_FRASE.exec(t)?.[1]).filter(Boolean);
    assert.equal(frases.length, 1, `uma frase por condição falhada (só o método)\n${r.cli.descricao()}`);
    assert.match(frases[0], /^method\b.*POST.*PUT/);
  });

  test('menos que o --count → saída 1 com as que casaram no stdout e n/count no resumo', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const m1 = await enviar(token, '/item/1');
    const m2 = await enviar(token, '/item/2');

    const r = await waitFor(['--token', token, '--path', '/item', '--count', '3', '--timeout', '0']);
    conferirPrazo(r, [m1, m2], 3);
    assert.equal(r.stderr.filter((t) => LINHA_CLOSEST.test(t)).length, 0, `nenhuma avaliada deixou de casar: sem closest\n${r.cli.descricao()}`);
  });

  test('--count pega as de menor seq, em ordem', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const msgs = [];
    for (let i = 1; i <= 4; i++) msgs.push(await enviar(token, `/item/${i}`));
    const r = await waitFor(['--token', token, '--path', '/item', '--count', '3', '--timeout', '0']);
    await conferirCasou(r, token, msgs.slice(0, 3), 3);
  });

  test('URL vazia: espera o --timeout inteiro (o prazo HTTP tem folga) e sai com 1, sem closest', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const r = await waitFor(['--token', token, '--method', 'POST', '--timeout', '2500']);
    const { ms } = conferirPrazo(r, [], 1);
    assert.ok(ms >= 2_400 && r.ms >= 2_400, `terminou antes do prazo: resumo ${ms} ms, parede ${r.ms} ms`);
    assert.equal(r.stderr.filter((t) => LINHA_CLOSEST.test(t)).length, 0, `nada avaliado: sem closest\n${r.cli.descricao()}`);
  });

  test('uso inválido → saída 2 (sem --token, --after com --new, --match inválido, arquivo inexistente, --count fora)', { timeout: 120_000 }, async () => {
    const token = await criarToken();
    await enviar(token, '/a');
    const dir = pastaTemporaria();
    const ruim = path.join(dir, 'ruim.json');
    fs.writeFileSync(ruim, '{"method": [');

    conferirErro(await waitFor(['--method', 'POST', '--timeout', '0']), 'sem --token');
    conferirErro(await waitFor(['--token', token, '--after', '0', '--new', '--timeout', '0']), '--after com --new');
    conferirErro(await waitFor(['--token', token, '--match', '{"method": [', '--timeout', '0']), '--match que não é JSON');
    conferirErro(await waitFor(['--token', token, '--match-file', ruim, '--timeout', '0']), '--match-file que não é JSON');
    conferirErro(await waitFor(['--token', token, '--match-file', path.join(dir, 'nao-existe.json'), '--timeout', '0']), '--match-file inexistente');
    conferirErro(await waitFor(['--token', token, '--count', '0', '--timeout', '0']), '--count 0');
    conferirErro(await waitFor(['--token', token, '--count', '101', '--timeout', '0']), '--count 101');
  });

  test('422 da API (regex inválida no --match) → saída 2', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await enviar(token, '/a');
    const r = await waitFor(['--token', token, '--match', JSON.stringify({ path: { regex: '([a-z' } }), '--timeout', '0']);
    conferirErro(r, '422');
  });

  test('token inexistente → saída 2', { timeout: 60_000 }, async () => {
    const r = await waitFor(['--token', randomUUID(), '--timeout', '0']);
    conferirErro(r, 'token inexistente');
  });

  test('servidor fora → saída 2', { timeout: 60_000 }, async () => {
    const r = await waitFor(['--token', randomUUID(), '--timeout', '0'], { servidor: SERVIDOR_MORTO });
    conferirErro(r, 'servidor fora');
  });
});

describe('anzol wait-for: --new e --after', () => {
  test('--new ignora o histórico: só com a antiga, --timeout 0 → saída 1 e stdout []', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await enviar(token, '/evento');
    const r = await waitFor(['--token', token, '--new', '--path', '/evento', '--timeout', '0']);
    conferirPrazo(r, [], 1);
  });

  test('--new: a mensagem que chega durante a espera casa e o CLI sai logo com 0', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const antiga = await enviar(token, '/evento');

    const inicio = Date.now();
    const execucao = waitFor(['--token', token, '--new', '--path', '/evento', '--timeout', '20000']);
    let terminou = false;
    execucao.then(() => { terminou = true; }, () => { terminou = true; });
    // Sem sinal de "pronto", manda uma nova a cada 400 ms: toda mensagem depois de o CLI ler o seq
    // mais novo conta; a antiga, não.
    const novas = [];
    for (let i = 0; i < 40 && !terminou; i++) {
      await pausa(400);
      if (!terminou) novas.push(await enviar(token, `/evento/novo-${i}`));
    }
    const r = await execucao;
    assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
    const [msg] = mensagensDoStdout(r);
    assert.notEqual(msg?.uuid, antiga.uuid, '--new devolveu a mensagem do histórico');
    assert.ok(novas.some((n) => n.uuid === msg.uuid), `stdout não é uma das novas\n${r.cli.descricao()}`);
    await conferirCasou(r, token, [msg]);
    assert.ok(Date.now() - inicio < 18_000, 'saiu bem antes do prazo de 20 s');
  });

  test('--after <seq> só considera as de seq maior', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    const m1 = await enviar(token, '/a/1');
    const m2 = await enviar(token, '/a/2');
    const m3 = await enviar(token, '/a/3');

    await conferirCasou(await waitFor(['--token', token, '--after', String(m1.seq), '--path', '/a', '--count', '2', '--timeout', '0']), token, [m2, m3]);
    conferirPrazo(await waitFor(['--token', token, '--after', String(m3.seq), '--path', '/a', '--timeout', '0']), [], 1);
  });
});
