import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, afterEach, describe, test } from 'node:test';
import { CLI, SERVIDOR } from './support/ambiente.mjs';
import { iniciarCli } from './support/cli.mjs';
import { limparTudo } from './support/limpeza.mjs';
import { buscarMensagem, criarToken, criarTokenProtegido, statusDoToken } from './support/servidor.mjs';

// Patamar, fatia D1, DX-14 (`.docs-arquivo/patamar/api-defeitos.md`, item 4): `anzol cursor <token>` imprime a
// posição da fila (o `seq` da mensagem mais nova; `0` sem mensagens) para o teste de CI lê-la ANTES do disparo e
// esperar a partir dela com `anzol wait-for --after <seq>`. É o roteiro sem corrida: o `--new` lê a posição quando o
// `wait-for` começa, e perde o disparo que chegou antes.

afterEach(limparTudo);
after(limparTudo);

/** `WEBHOOK_SERVER` que o CLI herda: porta fechada. Só o `--server` depois dos argumentos leva ao app. */
const SERVIDOR_MORTO = 'http://127.0.0.1:9';
const SEM_COMANDO = /^Usage:|no such (sub)?command|no such option|unknown (command|option)|unexpected extra argument|missing argument/im;
const JSON_ACCEPT = { Accept: 'application/json' };

/** Roda o CLI até o fim; comando ou opção que não existe vira falha com mensagem clara. */
async function rodar(args, prazo = 60_000) {
  const anterior = process.env.WEBHOOK_SERVER;
  process.env.WEBHOOK_SERVER = SERVIDOR_MORTO;
  let cli;
  try {
    cli = await iniciarCli(args);
  } finally {
    if (anterior === undefined) delete process.env.WEBHOOK_SERVER;
    else process.env.WEBHOOK_SERVER = anterior;
  }
  const { codigo } = await cli.esperarSaida(prazo);
  const fluxo = (f) => cli.linhas.filter((l) => l.fluxo === f).map((l) => l.texto);
  const r = { cli, codigo, stdout: fluxo('stdout'), stderr: fluxo('stderr') };
  if (SEM_COMANDO.test(r.stderr.join('\n'))) {
    throw new Error(`o CLI em ${CLI} recusou a linha de comando; falta \`anzol ${args[0]}\` ou alguma opção dele?\n${cli.descricao()}`);
  }
  return r;
}

const cursor = (token, ...extra) => rodar(['cursor', token, ...extra, '--server', SERVIDOR]);

/** POST na URL de captura; devolve a mensagem gravada (com o `seq`). */
async function disparar(token, caminho, corpo = '{}') {
  const res = await fetch(`${SERVIDOR}/${token}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
  await res.arrayBuffer();
  const id = res.headers.get('x-request-id');
  assert.ok(id, `a captura de ${caminho} respondeu ${res.status} sem X-Request-Id`);
  return buscarMensagem(token, id);
}

/** O `seq` da mensagem mais nova pela API (0 sem mensagens): o que o comando tem de imprimir. */
async function cursorPelaApi(token, cabecalhos = {}) {
  const res = await fetch(`${SERVIDOR}/token/${token}/requests?sorting=newest&per_page=1`, { headers: { ...JSON_ACCEPT, ...cabecalhos } });
  assert.equal(res.status, 200, `GET /token/${token}/requests respondeu ${res.status}`);
  const { data, total } = await res.json();
  return { seq: data[0]?.seq ?? 0, total };
}

/** Saída 0 e stdout com uma linha só, de dígitos. */
function numeroImpresso(r) {
  assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
  assert.equal(r.stdout.length, 1, `stdout deve ter só o número\n${r.cli.descricao()}`);
  assert.match(r.stdout[0], /^\d+$/, `stdout deve ser só o número\n${r.cli.descricao()}`);
  return Number(r.stdout[0]);
}

describe('anzol cursor', () => {
  test('URL sem mensagens: imprime 0 e sai com 0', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    assert.equal(numeroImpresso(await cursor(token)), 0);
  });

  test('imprime só o seq da mensagem mais nova, e não grava nada', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await disparar(token, '/a');
    await disparar(token, '/b');
    const nova = await disparar(token, '/c');

    assert.equal(numeroImpresso(await cursor(token)), nova.seq);
    assert.deepEqual(await cursorPelaApi(token), { seq: nova.seq, total: 3 }, 'o comando só lê');

    const depois = await disparar(token, '/d');
    assert.equal(numeroImpresso(await cursor(token)), depois.seq, 'o cursor acompanha a fila');
  });

  test('token inexistente → "Token not found" no stderr, stdout vazio, saída diferente de 0', { timeout: 60_000 }, async () => {
    const token = randomUUID();
    assert.equal(await statusDoToken(token), 410, 'pré-condição: o token não existe');
    const r = await cursor(token);
    assert.match(r.stderr.join('\n'), /Token not found/, `stderr\n${r.cli.descricao()}`);
    assert.deepEqual(r.stdout, [], `stdout vazio\n${r.cli.descricao()}`);
    assert.notEqual(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
    assert.equal(await statusDoToken(token), 410, 'o comando não cria o token');
  });

  test('URL protegida: com --read-secret imprime o cursor; sem ele, falha sem imprimir número nem o segredo', { timeout: 60_000 }, async () => {
    const segredo = `cli-${randomBytes(12).toString('hex')}`;
    const token = await criarTokenProtegido(segredo);
    const res = await fetch(`${SERVIDOR}/${token}/protegida`, { method: 'POST', body: 'x' });
    await res.arrayBuffer();
    const esperado = await cursorPelaApi(token, { 'X-Webhook-Secret': segredo });
    assert.ok(esperado.seq > 0, 'pré-condição: a URL tem uma mensagem');

    const com = await cursor(token, '--read-secret', segredo);
    assert.equal(numeroImpresso(com), esperado.seq);
    assert.deepEqual(com.cli.linhas.filter((l) => l.texto.includes(segredo)), [], `o segredo apareceu na saída\n${com.cli.descricao()}`);

    const sem = await cursor(token);
    assert.notEqual(sem.codigo, 0, `sem o segredo: código de saída\n${sem.cli.descricao()}`);
    assert.deepEqual(sem.stdout, [], `sem o segredo: stdout vazio\n${sem.cli.descricao()}`);
    assert.deepEqual(sem.cli.linhas.filter((l) => l.texto.includes(segredo)), []);
  });
});

describe('roteiro sem corrida: cursor → disparo → wait-for --after', () => {
  test('o disparo que chega ANTES de o wait-for começar é achado; a mensagem antiga que casa, não', { timeout: 90_000 }, async () => {
    const token = await criarToken();
    const antiga = await disparar(token, '/pedidos', '{"n":"antiga"}');

    const lido = numeroImpresso(await cursor(token));
    assert.equal(lido, antiga.seq);

    // O teste dispara e só depois começa a esperar: é a ordem em que o --new perde a mensagem.
    const nova = await disparar(token, '/pedidos', '{"n":"nova"}');
    const inicio = Date.now();
    const r = await rodar(['wait-for', '--token', token, '--after', String(lido), '--path', '/pedidos', '--timeout', '20000', '--server', SERVIDOR]);
    assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
    assert.ok(Date.now() - inicio < 10_000, `a mensagem já estava gravada: a espera não devia chegar perto do prazo\n${r.cli.descricao()}`);
    const achadas = JSON.parse(r.stdout.join('\n'));
    assert.deepEqual(achadas.map((m) => m.uuid), [nova.uuid]);

    // Guarda: o --new, começando depois do disparo, não a vê (é o que o cursor resolve).
    const comNew = await rodar(['wait-for', '--token', token, '--new', '--path', '/pedidos', '--timeout', '0', '--server', SERVIDOR]);
    assert.equal(comNew.codigo, 1, `--new depois do disparo\n${comNew.cli.descricao()}`);
    assert.deepEqual(JSON.parse(comNew.stdout.join('\n')), []);
  });

  test('cursor 0 de uma URL vazia: wait-for --after 0 acha a primeira mensagem', { timeout: 90_000 }, async () => {
    const token = await criarToken();
    const lido = numeroImpresso(await cursor(token));
    assert.equal(lido, 0);
    const primeira = await disparar(token, '/primeira');
    const r = await rodar(['wait-for', '--token', token, '--after', String(lido), '--timeout', '20000', '--server', SERVIDOR]);
    assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
    assert.deepEqual(JSON.parse(r.stdout.join('\n')).map((m) => m.uuid), [primeira.uuid]);
  });
});
