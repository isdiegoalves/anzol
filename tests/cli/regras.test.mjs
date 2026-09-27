import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { CLI, SERVIDOR, UUID } from './support/ambiente.mjs';
import { iniciarCli } from './support/cli.mjs';
import { aoFinal, limparTudo } from './support/limpeza.mjs';
import { criarToken, statusDoToken } from './support/servidor.mjs';

afterEach(limparTudo);
after(limparTudo);

const JSON_API = { Accept: 'application/json', 'Content-Type': 'application/json' };

/**
 * `WEBHOOK_SERVER` que o CLI herda nestes testes: porta fechada. Só o `--server` depois do
 * subcomando leva ao app real, então um CLI que o ignore falha em todos.
 */
const SERVIDOR_MORTO = 'http://127.0.0.1:9';

/** Regras com todos os campos do Anexo A e da fase B, para a ida e volta não perder nada. */
const REGRAS_RICAS = [
  {
    name: 'pix pago',
    enabled: true,
    priority: 1,
    match: {
      method: ['POST', 'PUT'],
      path: { prefix: '/pagamentos' },
      query: { tipo: { equals: 'pix' } },
      headers: { 'X-Signature': { present: true } },
      body: [{ jsonPath: { path: '$.status', equals: 'pago' } }, { contains: 'pedido' }, { equalToJson: { a: 1, b: [1, 2] } }],
    },
    scenario: { name: 'retentativa', requiredState: 'Started', newState: 'ok' },
    response: {
      status: 201,
      headers: { 'Content-Type': 'application/json', 'X-Seq': '{{seq}}' },
      body: '{"id":{{jsonPath request.body \'$.id\'}},"texto":"olá ✓"}',
      template: true,
      delay: { uniform: { min: 10, max: 20 } },
      dribble: { chunks: 2, durationMs: 100 },
      fault: null,
    },
  },
  {
    name: 'desligada',
    enabled: false,
    priority: 7,
    match: { path: { regex: '^/r/[0-9]+$' } },
    response: { status: 503, headers: { 'Retry-After': '1' }, body: '', fault: 'connection_reset' },
  },
  { name: 'mínima' },
];

async function lerRegras(token) {
  const res = await fetch(`${SERVIDOR}/token/${token}/rules`, { headers: JSON_API });
  if (res.status !== 200) throw new Error(`GET /token/${token}/rules respondeu ${res.status}: ${await res.text()}`);
  return res.json();
}

/** PUT direto na API; devolve status e corpo (o teste decide o que esperar). */
async function putRegras(token, corpo) {
  const res = await fetch(`${SERVIDOR}/token/${token}/rules`, { method: 'PUT', headers: JSON_API, body: corpo });
  return { status: res.status, corpo: await res.json() };
}

async function gravarRegras(token, regras) {
  const { status, corpo } = await putRegras(token, JSON.stringify(regras));
  if (status !== 200) throw new Error(`pré-condição: PUT /token/${token}/rules respondeu ${status}: ${JSON.stringify(corpo)}`);
  return corpo;
}

function semIds(regras) {
  return regras.map(({ id, ...resto }) => resto);
}

/** Pasta temporária apagada ao fim do teste. */
function pastaTemporaria() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aceite-regras-'));
  aoFinal(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Roda `webhook <args>` até o fim, com `WEBHOOK_SERVER` apontando para uma porta fechada. Erro de
 * uso do CLI (comando que não existe, argumento a mais) falha aqui, com a saída, para que os casos
 * de erro não passem por acaso contra um CLI sem `rules pull|push`.
 */
async function rodar(args) {
  const anterior = process.env.WEBHOOK_SERVER;
  process.env.WEBHOOK_SERVER = SERVIDOR_MORTO;
  let cli;
  try {
    cli = await iniciarCli(args);
  } finally {
    if (anterior === undefined) delete process.env.WEBHOOK_SERVER;
    else process.env.WEBHOOK_SERVER = anterior;
  }
  const { codigo } = await cli.esperarSaida(30_000);
  const fluxo = (f) => cli.linhas.filter((l) => l.fluxo === f).map((l) => l.texto).join('\n');
  const r = { cli, codigo, stdout: fluxo('stdout'), stderr: fluxo('stderr') };
  if (/^Usage:|unexpected extra argument|no such (sub)?command|missing argument|no such option/im.test(r.stderr)) {
    throw new Error(`o CLI em ${CLI} recusou a linha de comando (erro de uso); falta \`webhook ${args.slice(0, 2).join(' ')}\`?\n${cli.descricao()}`);
  }
  return r;
}

function pull(token, ...extra) {
  return rodar(['rules', 'pull', token, ...extra, '--server', SERVIDOR]);
}

function push(token, arquivo) {
  return rodar(['rules', 'push', token, arquivo, '--server', SERVIDOR]);
}

/** Saída 1 com alguma mensagem no stderr. */
function falhouComMensagem(r, oque) {
  assert.equal(r.codigo, 1, `${oque}: código de saída\n${r.cli.descricao()}`);
  assert.ok(r.stderr.trim().length > 0, `${oque}: sem mensagem no stderr\n${r.cli.descricao()}`);
}

describe('anzol rules pull', () => {
  test('pull sem --file: stdout é o JSON formatado igual ao GET /token/{id}/rules; saída 0', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await gravarRegras(token, REGRAS_RICAS);
    const esperado = await lerRegras(token);

    const r = await pull(token);
    assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
    let lido;
    assert.doesNotThrow(() => { lido = JSON.parse(r.stdout); }, `stdout não é JSON\n${r.cli.descricao()}`);
    assert.deepEqual(lido, esperado);
    assert.match(r.stdout, /\n\s+"/, 'JSON formatado: uma linha por campo, com recuo');
  });

  test('pull --file: o arquivo tem o JSON igual ao GET; nada da lista no stdout; saída 0', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await gravarRegras(token, REGRAS_RICAS);
    const esperado = await lerRegras(token);
    const arquivo = path.join(pastaTemporaria(), 'regras.json');

    const r = await pull(token, '--file', arquivo);
    assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
    assert.ok(fs.existsSync(arquivo), `o arquivo ${arquivo} não foi criado\n${r.cli.descricao()}`);
    const texto = fs.readFileSync(arquivo, 'utf8');
    assert.deepEqual(JSON.parse(texto), esperado);
    assert.match(texto, /\n\s+"/, 'JSON formatado: uma linha por campo, com recuo');
    for (const { id } of esperado) assert.ok(!r.stdout.includes(id), `com --file a lista não vai para o stdout (achei ${id})\n${r.cli.descricao()}`);
  });

  test('pull de token inexistente → "Token not found" no stderr e saída 1', { timeout: 60_000 }, async () => {
    const token = randomUUID();
    assert.equal(await statusDoToken(token), 410, 'pré-condição: o token não existe');
    const r = await pull(token);
    assert.match(r.stderr, /Token not found/, `stderr\n${r.cli.descricao()}`);
    assert.equal(r.codigo, 1, `código de saída\n${r.cli.descricao()}`);
  });
});

describe('anzol rules push', () => {
  test('push de um arquivo: "Pushed <n> rule(s)", saída 0, e o GET devolve as regras com id', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await gravarRegras(token, [{ name: 'antiga', priority: 2 }]);
    const arquivo = path.join(pastaTemporaria(), 'regras.json');
    fs.writeFileSync(arquivo, JSON.stringify(REGRAS_RICAS, null, 2));

    const r = await push(token, arquivo);
    assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
    assert.ok(r.cli.linhasQueCasam(/^Pushed 3 rule\(s\)$/).length === 1, `linha "Pushed 3 rule(s)"\n${r.cli.descricao()}`);

    const gravadas = await lerRegras(token);
    assert.equal(gravadas.length, 3, 'o push substitui a lista (a regra antiga some)');
    for (const { id } of gravadas) assert.match(id, new RegExp(`^${UUID.source}$`), 'id gerado pelo servidor');
    // O que a API faria com o mesmo arquivo, num token de referência.
    const referencia = await criarToken();
    const direto = await gravarRegras(referencia, REGRAS_RICAS);
    assert.deepEqual(semIds(gravadas), semIds(direto), 'as regras gravadas pelo CLI são as do arquivo');
  });

  test('ida e volta: pull → push → pull sem diferença', { timeout: 90_000 }, async () => {
    const token = await criarToken();
    await gravarRegras(token, REGRAS_RICAS);
    const original = await lerRegras(token);
    const dir = pastaTemporaria();
    const primeiro = path.join(dir, 'primeiro.json');
    const segundo = path.join(dir, 'segundo.json');

    const p1 = await pull(token, '--file', primeiro);
    assert.equal(p1.codigo, 0, `primeiro pull\n${p1.cli.descricao()}`);
    // Sem isto, um push que não faz nada passaria.
    await gravarRegras(token, []);

    const r = await push(token, primeiro);
    assert.equal(r.codigo, 0, `push\n${r.cli.descricao()}`);
    assert.ok(r.cli.linhasQueCasam(/^Pushed 3 rule\(s\)$/).length === 1, `linha "Pushed 3 rule(s)"\n${r.cli.descricao()}`);

    const p2 = await pull(token, '--file', segundo);
    assert.equal(p2.codigo, 0, `segundo pull\n${p2.cli.descricao()}`);
    assert.equal(fs.readFileSync(segundo, 'utf8'), fs.readFileSync(primeiro, 'utf8'), 'os dois pulls são idênticos, byte a byte');
    assert.deepEqual(await lerRegras(token), original, 'as regras voltaram como eram, com os mesmos ids');
  });

  test('push com regra inválida: cada chave e mensagem do 422 no stderr, saída 1, regras salvas intactas', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await gravarRegras(token, REGRAS_RICAS);
    const antes = await lerRegras(token);
    const invalidas = JSON.stringify([
      { name: 'válida', match: { method: ['GET'] } },
      { name: 'regex ruim', match: { path: { regex: '(' } } },
      { priority: 0 },
    ]);
    const arquivo = path.join(pastaTemporaria(), 'invalidas.json');
    fs.writeFileSync(arquivo, invalidas);

    const r = await push(token, arquivo);
    assert.equal(r.codigo, 1, `código de saída\n${r.cli.descricao()}`);
    assert.deepEqual(r.cli.linhasQueCasam(/Pushed/), [], 'nada de "Pushed" quando o servidor recusa');
    assert.deepEqual(await lerRegras(token), antes, 'as regras salvas ficam intactas');

    // O 422 que a API dá para o mesmo arquivo (a recusa não muda nada no token).
    const { status, corpo: erros } = await putRegras(token, invalidas);
    assert.equal(status, 422, 'pré-condição: a API recusa o arquivo');
    const pares = Object.entries(erros).flatMap(([chave, msgs]) => msgs.map((m) => [chave, m]));
    assert.ok(pares.length >= 3, `pré-condição: várias chaves no 422 (${JSON.stringify(erros)})`);
    const linhas = r.stderr.split('\n');
    for (const [chave, msg] of pares) {
      assert.ok(linhas.some((l) => l.includes(chave) && l.includes(msg)), `stderr sem linha com "${chave}" e "${msg}"\n${r.cli.descricao()}`);
    }
    assert.deepEqual(await lerRegras(token), antes, 'as regras salvas ficam intactas');
  });

  test('push para token inexistente → "Token not found" no stderr e saída 1', { timeout: 60_000 }, async () => {
    const token = randomUUID();
    assert.equal(await statusDoToken(token), 410, 'pré-condição: o token não existe');
    const arquivo = path.join(pastaTemporaria(), 'regras.json');
    fs.writeFileSync(arquivo, JSON.stringify(REGRAS_RICAS));

    const r = await push(token, arquivo);
    assert.match(r.stderr, /Token not found/, `stderr\n${r.cli.descricao()}`);
    assert.equal(r.codigo, 1, `código de saída\n${r.cli.descricao()}`);
    assert.equal(await statusDoToken(token), 410, 'o push não cria o token');
  });

  test('push de arquivo inexistente → saída 1 com mensagem; regras intactas', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await gravarRegras(token, REGRAS_RICAS);
    const antes = await lerRegras(token);
    const arquivo = path.join(pastaTemporaria(), 'nao-existe.json');

    const r = await push(token, arquivo);
    falhouComMensagem(r, 'arquivo inexistente');
    assert.deepEqual(r.cli.linhasQueCasam(/Pushed/), []);
    assert.deepEqual(await lerRegras(token), antes, 'as regras salvas ficam intactas');
  });

  test('push de JSON inválido → saída 1 com mensagem; regras intactas', { timeout: 60_000 }, async () => {
    const token = await criarToken();
    await gravarRegras(token, REGRAS_RICAS);
    const antes = await lerRegras(token);
    const arquivo = path.join(pastaTemporaria(), 'quebrado.json');
    fs.writeFileSync(arquivo, '[{"name": "sem fim",');

    const r = await push(token, arquivo);
    falhouComMensagem(r, 'JSON inválido');
    assert.deepEqual(r.cli.linhasQueCasam(/Pushed/), []);
    assert.deepEqual(await lerRegras(token), antes, 'as regras salvas ficam intactas');
  });
});
