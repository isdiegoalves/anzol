import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { CLI, SERVIDOR, UUID, literal } from './support/ambiente.mjs';
import { iniciarCli } from './support/cli.mjs';
import { aoFinal, limparTudo } from './support/limpeza.mjs';
import { buscarMensagem, criarToken, statusDoToken } from './support/servidor.mjs';

afterEach(limparTudo);
after(limparTudo);

/** O CLI herda `ANZOL_SERVER` numa porta fechada: só o `--server` depois do subcomando leva ao app. */
const SERVIDOR_MORTO = 'http://127.0.0.1:9';
const SEM_COMANDO = /^Usage:|no such (sub)?command|no such option|unknown (command|option)|unexpected extra argument|missing argument/im;
const URL_CRIADA = new RegExp(`${literal(SERVIDOR)}/(${UUID.source})`);

function gatilho(caminho, corpo) {
  const js = `fetch(process.argv[1] + ${JSON.stringify(caminho)}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(corpo)} }).then((r) => r.arrayBuffer()).then(() => process.exit(0), (e) => { console.error(e); process.exit(9); })`;
  return [process.execPath, '-e', js, '{url}'];
}

async function rodar(opcoes, comando = [], prazo = 60_000) {
  const anterior = process.env.ANZOL_SERVER;
  process.env.ANZOL_SERVER = SERVIDOR_MORTO;
  let cli;
  try {
    cli = await iniciarCli(['test', ...opcoes, '--server', SERVIDOR, ...(comando.length ? ['--', ...comando] : [])]);
  } finally {
    if (anterior === undefined) delete process.env.ANZOL_SERVER;
    else process.env.ANZOL_SERVER = anterior;
  }
  const inicio = Date.now();
  const { codigo } = await cli.esperarSaida(prazo);
  const fluxo = (f) => cli.linhas.filter((l) => l.fluxo === f).map((l) => l.texto);
  const r = { cli, codigo, ms: Date.now() - inicio, stdout: fluxo('stdout'), stderr: fluxo('stderr') };
  if (SEM_COMANDO.test(r.stderr.join('\n'))) {
    throw new Error(`o CLI em ${CLI} recusou a linha de comando; falta \`anzol test\` ou alguma opção dele?\n${cli.descricao()}`);
  }
  return r;
}

function urlCriada(r) {
  const achada = r.cli.linhas.map((l) => URL_CRIADA.exec(l.texto)).find(Boolean);
  assert.ok(achada, `o CLI não imprimiu a URL criada\n${r.cli.descricao()}`);
  return achada[1];
}

function casadas(r) {
  try {
    return JSON.parse(r.stdout.join('\n'));
  } catch {
    assert.fail(`o stdout deve ser só o array JSON\n${r.cli.descricao()}`);
  }
}

function arquivoDeRegras(regras) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anzol-test-'));
  aoFinal(() => fs.rmSync(dir, { recursive: true, force: true }));
  const arquivo = path.join(dir, 'regras.json');
  fs.writeFileSync(arquivo, JSON.stringify(regras));
  return arquivo;
}

async function disparar(token, caminho, corpo) {
  const res = await fetch(`${SERVIDOR}/${token}${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
  await res.arrayBuffer();
  return buscarMensagem(token, res.headers.get('x-request-id'));
}

describe('anzol test: URL criada pelo comando', () => {
  test('cria a URL, roda o gatilho com {url}, acha o webhook que ele mandou e apaga a URL', { timeout: 90_000 }, async () => {
    const r = await rodar(
      ['--method', 'POST', '--path', '/pedidos', '--json-path', '$.status=pago', '--timeout', '20000'],
      gatilho('/pedidos/7', '{"status":"pago"}'),
    );

    assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
    const token = urlCriada(r);
    const [mensagem, ...resto] = casadas(r);
    assert.deepEqual(resto, [], `só a mensagem do gatilho\n${r.cli.descricao()}`);
    assert.equal(mensagem.method, 'POST');
    assert.equal(mensagem.token_id, token);
    assert.equal(mensagem.url, `${SERVIDOR}/${token}/pedidos/7`);
    assert.deepEqual(JSON.parse(mensagem.content), { status: 'pago' });
    assert.ok(r.ms < 15_000, `o webhook chegou antes da espera: não devia chegar perto do prazo (${r.ms} ms)\n${r.cli.descricao()}`);
    assert.equal(await statusDoToken(token), 410, 'a URL criada pelo comando é apagada no fim');
  });

  test('--rules e --status: a regra responde 202; --status 202 sai com 0 e --status 201 com 1', { timeout: 120_000 }, async () => {
    const regras = arquivoDeRegras([{ name: 'Pedido aceito', match: { path: { prefix: '/pedidos' } }, response: { status: 202 } }]);

    const certo = await rodar(['--rules', regras, '--path', '/pedidos', '--status', '202'], gatilho('/pedidos', '{}'));
    assert.equal(certo.codigo, 0, `--status 202\n${certo.cli.descricao()}`);
    assert.equal(casadas(certo)[0].response.status, 202, 'a regra do arquivo respondeu');

    const errado = await rodar(['--rules', regras, '--path', '/pedidos', '--status', '201'], gatilho('/pedidos', '{}'));
    assert.equal(errado.codigo, 1, `--status 201\n${errado.cli.descricao()}`);
    assert.match(errado.stderr.join('\n'), /201/, `o stderr diz o status esperado\n${errado.cli.descricao()}`);
    assert.equal(await statusDoToken(urlCriada(errado)), 410, 'a URL é apagada também quando falha');
  });

  test('prazo sem casar: saída 1, [] no stdout, a que chegou mais perto no stderr, URL apagada', { timeout: 90_000 }, async () => {
    const r = await rodar(['--path', '/pedidos', '--timeout', '1500'], gatilho('/outro', '{}'));

    assert.equal(r.codigo, 1, `código de saída\n${r.cli.descricao()}`);
    assert.deepEqual(casadas(r), []);
    assert.ok(
      r.stderr.some((l) => /^timed out after \d+ ms: 0\/1 matched$/.test(l)),
      `resumo do wait-for\n${r.cli.descricao()}`,
    );
    assert.ok(r.stderr.some((l) => /^closest: #\d+ /.test(l)), `a mais perto\n${r.cli.descricao()}`);
    assert.equal(await statusDoToken(urlCriada(r)), 410);
  });

  test('gatilho que sai com erro: saída 3 sem esperar o prazo, URL apagada', { timeout: 90_000 }, async () => {
    const r = await rodar(['--timeout', '30000'], [process.execPath, '-e', 'process.exit(5)']);

    assert.equal(r.codigo, 3, `código de saída\n${r.cli.descricao()}`);
    assert.deepEqual(r.stdout, [], `stdout vazio\n${r.cli.descricao()}`);
    assert.ok(r.ms < 20_000, `não esperou o prazo (${r.ms} ms)\n${r.cli.descricao()}`);
    assert.equal(await statusDoToken(urlCriada(r)), 410);
  });

  test('match que o servidor recusa: saída 2 com o 422, o gatilho não roda, URL apagada', { timeout: 60_000 }, async () => {
    const marca = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anzol-test-')), 'rodou');
    aoFinal(() => fs.rmSync(path.dirname(marca), { recursive: true, force: true }));
    const r = await rodar(
      ['--match', '{"path":{"regex":"("}}'],
      [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marca)}, '')`],
    );

    assert.equal(r.codigo, 2, `código de saída\n${r.cli.descricao()}`);
    assert.ok(r.stderr.some((l) => /^match\.path\.regex: /.test(l)), `a chave do 422 no stderr\n${r.cli.descricao()}`);
    assert.deepEqual(r.stdout, [], `stdout vazio\n${r.cli.descricao()}`);
    assert.equal(fs.existsSync(marca), false, 'o gatilho não rodou');
    assert.equal(await statusDoToken(urlCriada(r)), 410);
  });

  test('sem gatilho: mostra a URL e espera o webhook mandado de fora', { timeout: 90_000 }, async () => {
    const anterior = process.env.ANZOL_SERVER;
    process.env.ANZOL_SERVER = SERVIDOR_MORTO;
    let cli;
    try {
      cli = await iniciarCli(['test', '--path', '/de-fora', '--timeout', '20000', '--server', SERVIDOR]);
    } finally {
      if (anterior === undefined) delete process.env.ANZOL_SERVER;
      else process.env.ANZOL_SERVER = anterior;
    }
    const [, token] = await cli.esperarLinha(URL_CRIADA, { prazo: 20_000 });
    await disparar(token, '/de-fora', '{}');

    const { codigo } = await cli.esperarSaida(30_000);
    assert.equal(codigo, 0, `código de saída\n${cli.descricao()}`);
    assert.equal(await statusDoToken(token), 410);
  });
});

describe('anzol test --token: URL que já existe', () => {
  test('a mensagem antiga que casa fica de fora, a do gatilho entra, e a URL continua', { timeout: 90_000 }, async () => {
    const token = await criarToken();
    const antiga = await disparar(token, '/pedidos', '{"n":"antiga"}');

    const r = await rodar(['--token', token, '--path', '/pedidos', '--timeout', '20000'], gatilho('/pedidos', '{"n":"nova"}'));

    assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
    const achadas = casadas(r);
    assert.equal(achadas.length, 1, `só a nova\n${r.cli.descricao()}`);
    assert.notEqual(achadas[0].uuid, antiga.uuid);
    assert.deepEqual(JSON.parse(achadas[0].content), { n: 'nova' });
    assert.equal(await statusDoToken(token), 200, 'a URL do --token não é apagada');
  });

  test('token inexistente: saída 2, "Token not found", o gatilho não roda', { timeout: 60_000 }, async () => {
    const marca = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anzol-test-')), 'rodou');
    aoFinal(() => fs.rmSync(path.dirname(marca), { recursive: true, force: true }));
    const r = await rodar(['--token', '00000000-0000-4000-8000-000000000000'], [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marca)}, '')`]);

    assert.equal(r.codigo, 2, `código de saída\n${r.cli.descricao()}`);
    assert.match(r.stderr.join('\n'), /Token not found/);
    assert.equal(fs.existsSync(marca), false, 'o gatilho não rodou');
  });
});
