import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { CLI, SERVIDOR } from './support/ambiente.mjs';
import { iniciarCapturador } from './support/capturador.mjs';
import { iniciarCli, linhaListening, linhaMensagem } from './support/cli.mjs';
import { aoFinal, limparTudo } from './support/limpeza.mjs';
import { caminhoGravado, criarTokenProtegido, enviarCru } from './support/servidor.mjs';

// Aceite do segredo de leitura no CLI (item 12, §1 do plano "privacidade", CA-5): opção `--read-secret` (depois do
// subcomando, como `--server`) ou env `ANZOL_READ_SECRET` → header `X-Anzol-Secret` em `listen`, `replay`,
// `wait-for` e `rules`. Contra uma URL protegida, o comando funciona com o segredo e não finge sucesso sem ele. O
// segredo nunca aparece no stdout nem no stderr.

afterEach(limparTudo);
after(limparTudo);

const HEADER = 'X-Anzol-Secret';
const USO_RECUSADO = /^Usage:|no such option|unknown option|unexpected extra argument|no such (sub)?command/im;

function novoSegredo() {
  return `cli-${randomBytes(12).toString('hex')}`;
}

/** URL protegida, conferida: sem o header a API responde 401. */
async function urlProtegida() {
  const segredo = novoSegredo();
  const token = await criarTokenProtegido(segredo);
  const sem = await fetch(`${SERVIDOR}/token/${token}`, { headers: { Accept: 'application/json' } });
  await sem.arrayBuffer();
  assert.equal(sem.status, 401, `pré-condição: o app não protege a URL (GET /token/{id} sem o segredo respondeu ${sem.status})`);
  return { token, segredo };
}

async function api(metodo, caminho, segredo, corpo) {
  const res = await fetch(`${SERVIDOR}${caminho}`, {
    method: metodo,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', [HEADER]: segredo },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await res.text();
  if (res.status >= 300) throw new Error(`${metodo} ${caminho} respondeu ${res.status}: ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

/** Inicia o CLI com variáveis de ambiente extras só para este processo. */
async function iniciarCom(args, env = {}) {
  const anteriores = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await iniciarCli(args);
  } finally {
    for (const [k, v] of Object.entries(anteriores)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Nenhuma linha do stdout ou do stderr contém o segredo. */
function semSegredoNaSaida(cli, segredo) {
  const vazou = cli.linhas.filter((l) => l.texto.includes(segredo));
  assert.deepEqual(vazou, [], `o segredo apareceu na saída do CLI\n${cli.descricao()}`);
}

function recusouOpcao(cli) {
  const stderr = cli.linhas.filter((l) => l.fluxo === 'stderr').map((l) => l.texto).join('\n');
  if (USO_RECUSADO.test(stderr)) {
    throw new Error(`o CLI em ${CLI} recusou a linha de comando; falta --read-secret (depois do subcomando) ou o comando?\n${cli.descricao()}`);
  }
}

/** Roda até o fim; devolve código, stdout e stderr. */
async function rodar(args, env = {}, prazo = 60_000) {
  const cli = await iniciarCom(args, env);
  const { codigo } = await cli.esperarSaida(prazo);
  recusouOpcao(cli);
  const fluxo = (f) => cli.linhas.filter((l) => l.fluxo === f).map((l) => l.texto).join('\n');
  return { cli, codigo, stdout: fluxo('stdout'), stderr: fluxo('stderr') };
}

/** As duas formas de passar o segredo: a opção e a variável de ambiente. */
const FORMAS = [
  { nome: '--read-secret', args: (s) => ['--read-secret', s], env: () => ({}) },
  { nome: 'ANZOL_READ_SECRET', args: () => [], env: (s) => ({ ANZOL_READ_SECRET: s }) },
];

describe('segredo de leitura no CLI', () => {
  for (const forma of FORMAS) {
    test(`listen com ${forma.nome}: escuta a URL protegida e entrega; o segredo não aparece`, { timeout: 90_000 }, async () => {
      const { token, segredo } = await urlProtegida();
      const app = await iniciarCapturador({ status: 202 });
      const forward = `${app.url}/destino`;
      const listen = await iniciarCom(['listen', '--server', SERVIDOR, '--token', token, '--forward', forward, ...forma.args(segredo)], forma.env(segredo));
      try {
        await listen.esperarLinha(linhaListening(SERVIDOR, forward, token));
      } catch (e) {
        recusouOpcao(listen);
        throw e;
      }
      const { requestId } = await enviarCru(token, '/privado?x=1', { corpo: '{"privado":true}', cabecalhos: [['Content-Type', 'application/json']] });
      const msg = await api('GET', `/token/${token}/request/${requestId}`, segredo);
      const recebida = await app.esperarCaminho('/privado');
      assert.equal(recebida.corpo.toString('utf8'), '{"privado":true}');
      await listen.esperarLinha(linhaMensagem('POST', caminhoGravado(msg), 202));
      await listen.encerrar();
      semSegredoNaSaida(listen, segredo);
    });

    test(`replay com ${forma.nome}: reenvia a mensagem da URL protegida, saída 0; o segredo não aparece`, { timeout: 60_000 }, async () => {
      const { token, segredo } = await urlProtegida();
      const app = await iniciarCapturador({ status: 201 });
      const forward = `${app.url}/destino`;
      const { requestId } = await enviarCru(token, '/replay?y=2', { metodo: 'PUT', corpo: 'corpo do replay', cabecalhos: [['Content-Type', 'text/plain']] });
      const msg = await api('GET', `/token/${token}/request/${requestId}`, segredo);
      const r = await rodar(['replay', token, requestId, '--to', forward, '--server', SERVIDOR, ...forma.args(segredo)], forma.env(segredo));
      assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
      const recebida = await app.esperarCaminho('/replay');
      assert.equal(recebida.metodo, 'PUT');
      assert.equal(recebida.corpo.toString('utf8'), 'corpo do replay');
      await r.cli.esperarLinha(linhaMensagem('PUT', caminhoGravado(msg), 201));
      semSegredoNaSaida(r.cli, segredo);
    });

    test(`wait-for com ${forma.nome}: casa a mensagem da URL protegida, saída 0; o segredo não aparece`, { timeout: 60_000 }, async () => {
      const { token, segredo } = await urlProtegida();
      const { requestId } = await enviarCru(token, '/pedidos', { corpo: '{"status":"pago"}', cabecalhos: [['Content-Type', 'application/json']] });
      const r = await rodar(['wait-for', '--token', token, '--path', '/pedidos', '--timeout', '0', '--server', SERVIDOR, ...forma.args(segredo)], forma.env(segredo));
      assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
      const lista = JSON.parse(r.stdout);
      assert.deepEqual(lista.map((m) => m.uuid), [requestId]);
      assert.deepEqual(lista[0], await api('GET', `/token/${token}/request/${requestId}`, segredo));
      semSegredoNaSaida(r.cli, segredo);
    });

    test(`rules push e pull com ${forma.nome}: gravam e leem as regras da URL protegida; o segredo não aparece`, { timeout: 60_000 }, async () => {
      const { token, segredo } = await urlProtegida();
      const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'anzol-priv-'));
      aoFinal(() => fs.rmSync(pasta, { recursive: true, force: true }));
      const arquivo = path.join(pasta, 'regras.json');
      fs.writeFileSync(arquivo, JSON.stringify([{ name: 'privada', match: { path: { equals: '/x' } }, response: { status: 202 } }]));

      const push = await rodar(['rules', 'push', token, arquivo, '--server', SERVIDOR, ...forma.args(segredo)], forma.env(segredo));
      assert.equal(push.codigo, 0, `push: código de saída\n${push.cli.descricao()}`);
      assert.ok(push.cli.linhas.some((l) => /^Pushed 1 rule\(s\)$/.test(l.texto)), `push: linha Pushed\n${push.cli.descricao()}`);
      const salvas = await api('GET', `/token/${token}/rules`, segredo);
      assert.deepEqual(salvas.map((r) => r.name), ['privada']);
      semSegredoNaSaida(push.cli, segredo);

      const pull = await rodar(['rules', 'pull', token, '--server', SERVIDOR, ...forma.args(segredo)], forma.env(segredo));
      assert.equal(pull.codigo, 0, `pull: código de saída\n${pull.cli.descricao()}`);
      assert.deepEqual(JSON.parse(pull.stdout), salvas);
      semSegredoNaSaida(pull.cli, segredo);
    });
  }

  test('sem o segredo, ou com ele errado: listen, replay, wait-for e rules não fingem sucesso (saída ≠ 0) e nada é entregue', { timeout: 120_000 }, async () => {
    const { token, segredo } = await urlProtegida();
    const app = await iniciarCapturador();
    const forward = `${app.url}/destino`;
    const { requestId } = await enviarCru(token, '/nada', { corpo: 'x', cabecalhos: [['Content-Type', 'text/plain']] });
    const errado = novoSegredo();
    for (const [caso, extra] of [['sem segredo', []], ['segredo errado', ['--read-secret', errado]]]) {
      const comandos = [
        ['listen', '--server', SERVIDOR, '--token', token, '--forward', forward, ...extra],
        ['replay', token, requestId, '--to', forward, '--server', SERVIDOR, ...extra],
        ['wait-for', '--token', token, '--timeout', '0', '--server', SERVIDOR, ...extra],
        ['rules', 'pull', token, '--server', SERVIDOR, ...extra],
      ];
      for (const args of comandos) {
        const r = await rodar(args, {}, 30_000);
        assert.notEqual(r.codigo, 0, `${caso}: webhook ${args.slice(0, 2).join(' ')} saiu com 0\n${r.cli.descricao()}`);
        semSegredoNaSaida(r.cli, errado);
        semSegredoNaSaida(r.cli, segredo);
      }
    }
    assert.equal(app.recebidas.length, 0, 'nada chega ao app local');
    // A URL continua intacta.
    const msg = await api('GET', `/token/${token}/request/${requestId}`, segredo);
    assert.equal(msg.uuid, requestId);
  });
});
