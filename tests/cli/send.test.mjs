import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { CLI, SERVIDOR, UUID } from './support/ambiente.mjs';
import { iniciarCapturador, valores } from './support/capturador.mjs';
import { iniciarCli } from './support/cli.mjs';
import { aoFinal, limparTudo } from './support/limpeza.mjs';
import { maisNovas, registrarToken, verificarServidor } from './support/servidor.mjs';

// Aceite do `webhook send` (simulador de provedor, §1 do plano "simulador-provedor"). O CLI dispara
// contra um receptor local (o capturador), que confere método, cabeçalhos, corpo, placeholders,
// assinatura (com `node:crypto`) e o intervalo entre tentativas; a prova cruzada da assinatura manda
// para uma URL da 8084 com a mesma `signature` configurada.

afterEach(limparTudo);
after(limparTudo);

/** Segredo de todos os envios assinados: não pode aparecer em linha nenhuma do CLI. */
const SEGREDO = 'whsec_aceite_send_Q7m2xK9p';

/** Folga dos intervalos medidos no receptor: abaixo, resolução de relógio; acima, JVM e conexão. */
const FOLGA_ABAIXO = 30;
const FOLGA_ACIMA = 2_500;

// ---- formato das linhas (§1: "Saída") ----

/**
 * `HH:mm:ss #<seq> attempt <n>/<total> -> <status> (<ms> ms)` ou `... -> error: <motivo>`, com o
 * sufixo opcional `, retrying in <ms> ms` e ` (Retry-After)`.
 */
const LINHA_TENTATIVA = /^(\d{2}):(\d{2}):(\d{2}) #(\d+) attempt (\d+)\/(\d+) -> (?:(\d{3}) \((\d+) ms\)|error: (.+?))(?:, retrying in (\d+) ms( \(Retry-After\))?)?$/;
/** `#<seq> delivered after <n> attempt(s)` ou `#<seq> gave up after <n> attempt(s)`. */
const LINHA_DESFECHO = /^#(\d+) (delivered|gave up) after (\d+) attempt\(s\)$/;
const ERRO_DE_USO = /^Usage:|unexpected extra argument|no such (sub)?command|missing (argument|option)|no such option|invalid value for/im;

function lerTentativa(texto) {
  const m = LINHA_TENTATIVA.exec(texto);
  if (!m) return null;
  const [, hh, mm, ss, seq, n, total, status, ms, erro, espera, retryAfter] = m;
  assert.ok(Number(hh) < 24 && Number(mm) < 60 && Number(ss) < 60, `hora inválida em ${JSON.stringify(texto)}`);
  return {
    seq: Number(seq),
    n: Number(n),
    total: Number(total),
    status: status === undefined ? null : Number(status),
    ms: ms === undefined ? null : Number(ms),
    erro: erro ?? null,
    espera: espera === undefined ? null : Number(espera),
    retryAfter: retryAfter !== undefined,
  };
}

/** Inicia `webhook send <args>`. */
function iniciarSend(args) {
  return iniciarCli(['send', ...args]);
}

/** Erro de uso do CLI (comando ou opção que não existe) vira falha com mensagem clara. */
function recusarErroDeUso(cli) {
  if (ERRO_DE_USO.test(cli.linhas.map((l) => l.texto).join('\n'))) {
    throw new Error(`o CLI em ${CLI} recusou a linha de comando (erro de uso); falta \`webhook send\` ou alguma opção dele?\n${cli.descricao()}`);
  }
}

/**
 * Espera o `send` terminar e lê a saída: tentativas e desfechos na ordem impressa, em qualquer
 * fluxo. Confere que o segredo não aparece e que toda linha com ` attempt ` segue o formato.
 */
async function concluir(cli, prazo = 60_000) {
  const { codigo } = await cli.esperarSaida(prazo);
  const textos = cli.linhas.map((l) => l.texto);
  const tudo = textos.join('\n');
  recusarErroDeUso(cli);
  assert.ok(!tudo.includes(SEGREDO), `o segredo apareceu na saída do CLI\n${cli.descricao()}`);
  const tentativas = [];
  const desfechos = [];
  for (const texto of textos) {
    const t = lerTentativa(texto);
    if (t) {
      tentativas.push(t);
      continue;
    }
    const d = LINHA_DESFECHO.exec(texto);
    if (d) {
      desfechos.push({ seq: Number(d[1]), resultado: d[2], tentativas: Number(d[3]) });
      continue;
    }
    assert.ok(!/ attempt | attempt\(s\)/.test(texto), `linha fora do formato da §1: ${JSON.stringify(texto)}\n${cli.descricao()}`);
  }
  return { cli, codigo, tentativas, desfechos };
}

async function send(args, prazo) {
  return concluir(await iniciarSend(args), prazo);
}

/** Tentativas sem os campos variáveis (ms, motivo do erro), para comparar com o esperado. */
function resumo(tentativas, { comRetryAfter = true } = {}) {
  return tentativas.map(({ seq, n, total, status, erro, espera, retryAfter }) => {
    const r = { seq, n, total, status: erro === null ? status : 'error', espera };
    if (comRetryAfter) r.retryAfter = retryAfter;
    return r;
  });
}

function tentativa(seq, n, total, status, espera = null, retryAfter = false) {
  return { seq, n, total, status, espera, retryAfter };
}

/** Intervalo medido no receptor entre duas chegadas, compatível com a espera impressa. */
function conferirIntervalo(anterior, seguinte, espera, cli) {
  const medido = seguinte.em - anterior.em;
  assert.ok(
    medido >= espera - FOLGA_ABAIXO && medido <= espera + FOLGA_ACIMA,
    `intervalo entre tentativas: ${medido} ms, esperado ${espera} ms (−${FOLGA_ABAIXO}/+${FOLGA_ACIMA})\n${cli.descricao()}`,
  );
  return medido;
}

function cabecalho(rec, nome) {
  const v = valores(rec, nome);
  assert.equal(v.length, 1, `cabeçalho ${nome}: esperado um valor, chegaram ${JSON.stringify(v)}`);
  return v[0];
}

/** Porta livre no loopback (aberta e fechada em seguida). */
async function portaLivre() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

function pastaTemporaria() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aceite-send-'));
  aoFinal(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- assinatura, conferida no receptor com node:crypto (fórmulas de tests/contract/support/assinatura.ts) ----

function hmac(algoritmo, dados, codificacao = 'hex') {
  return createHmac(algoritmo, SEGREDO).update(dados).digest(codificacao);
}

/** Segundos Unix perto da chegada da requisição (relógio do mesmo host). */
function conferirTimestampRecente(ts, rec, oque) {
  const chegada = Math.floor(rec.em / 1000);
  assert.ok(Math.abs(Number(ts) - chegada) <= 5, `${oque}: timestamp ${ts} longe da chegada (${chegada})`);
}

function assinaturaStripe(rec) {
  const valor = cabecalho(rec, 'stripe-signature');
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(valor);
  assert.ok(m, `Stripe-Signature fora do formato t=<ts>,v1=<hex>: ${valor}`);
  conferirTimestampRecente(m[1], rec, 'Stripe-Signature');
  assert.equal(m[2], hmac('sha256', Buffer.concat([Buffer.from(`${m[1]}.`), rec.corpo])), `Stripe-Signature não confere: ${valor}`);
  return Number(m[1]);
}

const PROVEDORES = [
  {
    nome: 'stripe',
    args: ['--provider', 'stripe'],
    config: { provider: 'stripe' },
    verificar: (rec) => { assinaturaStripe(rec); },
  },
  {
    nome: 'github',
    args: ['--provider', 'github'],
    config: { provider: 'github' },
    verificar: (rec) => assert.equal(cabecalho(rec, 'x-hub-signature-256'), `sha256=${hmac('sha256', rec.corpo)}`),
  },
  {
    nome: 'shopify',
    args: ['--provider', 'shopify'],
    config: { provider: 'shopify' },
    verificar: (rec) => assert.equal(cabecalho(rec, 'x-shopify-hmac-sha256'), hmac('sha256', rec.corpo, 'base64')),
  },
  {
    nome: 'slack',
    args: ['--provider', 'slack'],
    config: { provider: 'slack' },
    verificar: (rec) => {
      const ts = cabecalho(rec, 'x-slack-request-timestamp');
      assert.match(ts, /^\d+$/, 'X-Slack-Request-Timestamp em segundos Unix');
      conferirTimestampRecente(ts, rec, 'X-Slack-Request-Timestamp');
      const esperado = `v0=${hmac('sha256', Buffer.concat([Buffer.from(`v0:${ts}:`), rec.corpo]))}`;
      assert.equal(cabecalho(rec, 'x-slack-signature'), esperado);
    },
  },
  {
    nome: 'generic (sha256, hex, sem prefixo: os padrões)',
    args: ['--provider', 'generic', '--sig-header', 'X-Assinatura'],
    config: { provider: 'generic', header: 'X-Assinatura' },
    verificar: (rec) => assert.equal(cabecalho(rec, 'x-assinatura'), hmac('sha256', rec.corpo)),
  },
  {
    nome: 'generic (sha512, base64, prefixo hmac=)',
    args: ['--provider', 'generic', '--sig-header', 'X-Webhook-Hmac', '--algorithm', 'sha512', '--encoding', 'base64', '--prefix', 'hmac='],
    config: { provider: 'generic', header: 'X-Webhook-Hmac', algorithm: 'sha512', encoding: 'base64', prefix: 'hmac=' },
    verificar: (rec) => assert.equal(cabecalho(rec, 'x-webhook-hmac'), `hmac=${hmac('sha512', rec.corpo, 'base64')}`),
  },
  {
    nome: 'generic (sha1, hex)',
    args: ['--provider', 'generic', '--sig-header', 'X-Sig-Sha1', '--algorithm', 'sha1', '--encoding', 'hex'],
    config: { provider: 'generic', header: 'X-Sig-Sha1', algorithm: 'sha1', encoding: 'hex' },
    verificar: (rec) => assert.equal(cabecalho(rec, 'x-sig-sha1'), hmac('sha1', rec.corpo)),
  },
];

/** URL da 8084 com `signature` configurada; apagada ao fim do teste, passe ou falhe. */
async function criarTokenAssinado(config) {
  await verificarServidor();
  const res = await fetch(`${SERVIDOR}/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature: { ...config, secret: SEGREDO } }),
  });
  const corpo = await res.json().catch(() => ({}));
  if (typeof corpo.uuid === 'string') registrarToken(corpo.uuid);
  if (res.status !== 201) throw new Error(`POST /token com signature respondeu ${res.status}: ${JSON.stringify(corpo)}`);
  return corpo.uuid;
}

/** Corpo com não-ASCII e placeholder: a assinatura tem de cobrir os bytes já resolvidos. */
const CORPO_ASSINADO = '{"id":"{{uuid}}","evento":"pagamento.aprovado","valor":"R$ 10,00 ✓","seq":{{seq}}}';

describe('webhook send', () => {
  test('CA-1: método, cabeçalhos, corpo e placeholders chegam resolvidos; linha da tentativa e saída 0', { timeout: 90_000 }, async () => {
    const app = await iniciarCapturador({ status: 201 });
    const modelo = '{"id":"{{uuid}}","agora":"{{now}}","ts":{{timestamp}},"seq":{{seq}},"r1":"{{random 1}}","r16":"{{random 16}}","r256":"{{random 256}}","lit":"{{{{uuid}}","dois":"{{{{","texto":"olá ✓"}';
    const antes = Date.now();
    const r = await send([
      '--to', `${app.url}/hook/ca1?origem=aceite&x=1`,
      '--method', 'PUT',
      '--header', 'Content-Type: application/json',
      '--header', 'X-Evento: {{uuid}}',
      '--header', 'X-Fixo: valor com espaço',
      '--header', 'X-Seq: {{seq}}',
      '--data', modelo,
    ]);
    const depois = Date.now();

    assert.equal(app.recebidas.length, 1, `uma requisição; recebidas:\n${app.resumo()}`);
    const [rec] = app.recebidas;
    assert.equal(rec.metodo, 'PUT');
    assert.equal(rec.url, '/hook/ca1?origem=aceite&x=1');
    assert.equal(cabecalho(rec, 'content-type'), 'application/json');
    assert.equal(cabecalho(rec, 'x-fixo'), 'valor com espaço');
    assert.equal(cabecalho(rec, 'x-seq'), '1');

    const texto = rec.corpo.toString('utf8');
    const v = JSON.parse(texto);
    assert.match(v.id, new RegExp(`^${UUID.source}$`, 'i'), '{{uuid}}');
    assert.equal(cabecalho(rec, 'x-evento'), v.id, '{{uuid}} é o mesmo no cabeçalho e no corpo do mesmo envio');
    assert.match(v.agora, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, '{{now}} em ISO-8601 UTC');
    const agora = Date.parse(v.agora.replace(/(\.\d{3})\d+Z$/, '$1Z'));
    assert.ok(agora >= antes - 2_000 && agora <= depois + 2_000, `{{now}} ${v.agora} fora da janela do envio`);
    assert.ok(Number.isInteger(v.ts) && v.ts >= Math.floor(antes / 1000) - 2 && v.ts <= Math.ceil(depois / 1000) + 2, `{{timestamp}} ${v.ts} fora da janela do envio`);
    assert.equal(v.seq, 1, '{{seq}} do único envio');
    assert.match(v.r1, /^[A-Za-z0-9]{1}$/, '{{random 1}}');
    assert.match(v.r16, /^[A-Za-z0-9]{16}$/, '{{random 16}}');
    assert.match(v.r256, /^[A-Za-z0-9]{256}$/, '{{random 256}}');

    // Byte a byte: só os placeholders mudam, e `{{{{` vira `{{`.
    const esperado = `{"id":"${v.id}","agora":"${v.agora}","ts":${v.ts},"seq":1,"r1":"${v.r1}","r16":"${v.r16}","r256":"${v.r256}","lit":"{{uuid}}","dois":"{{","texto":"olá ✓"}`;
    assert.equal(texto, esperado);

    assert.deepEqual(resumo(r.tentativas), [tentativa(1, 1, 1, 201)], r.cli.descricao());
    assert.deepEqual(r.desfechos, [{ seq: 1, resultado: 'delivered', tentativas: 1 }], r.cli.descricao());
    assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
  });

  test('CA-1: --data-file com placeholders, POST por padrão, bytes UTF-8 preservados', { timeout: 90_000 }, async () => {
    const app = await iniciarCapturador();
    const arquivo = path.join(pastaTemporaria(), 'evento.txt');
    fs.writeFileSync(arquivo, 'ação: {{seq}}-{{random 8}}\r\nliteral {{{{now}}\n', 'utf8');
    const r = await send(['--to', `${app.url}/arquivo`, '--data-file', arquivo]);

    assert.equal(app.recebidas.length, 1, `uma requisição; recebidas:\n${app.resumo()}`);
    const [rec] = app.recebidas;
    assert.equal(rec.metodo, 'POST', 'método padrão');
    assert.equal(rec.url, '/arquivo');
    assert.match(rec.corpo.toString('utf8'), /^ação: 1-[A-Za-z0-9]{8}\r\nliteral \{\{now\}\}\n$/);
    assert.deepEqual(resumo(r.tentativas), [tentativa(1, 1, 1, 200)], r.cli.descricao());
    assert.deepEqual(r.desfechos, [{ seq: 1, resultado: 'delivered', tentativas: 1 }], r.cli.descricao());
    assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
  });

  describe('CA-2: assinatura por provedor', () => {
    for (const p of PROVEDORES) {
      test(`${p.nome}: confere no receptor com node:crypto e o webhook.site grava valid: true`, { timeout: 90_000 }, async () => {
        const app = await iniciarCapturador();
        const local = await send(['--to', `${app.url}/assinado`, ...p.args, '--secret', SEGREDO, '--header', 'Content-Type: application/json', '--data', CORPO_ASSINADO]);
        assert.equal(local.codigo, 0, `código de saída\n${local.cli.descricao()}`);
        assert.equal(app.recebidas.length, 1, `uma requisição; recebidas:\n${app.resumo()}`);
        const [rec] = app.recebidas;
        assert.match(rec.corpo.toString('utf8'), new RegExp(`^\\{"id":"${UUID.source}","evento":"pagamento\\.aprovado","valor":"R\\$ 10,00 ✓","seq":1\\}$`, 'i'));
        p.verificar(rec);

        // Prova cruzada: o próprio webhook.site verifica a mesma assinatura.
        const token = await criarTokenAssinado(p.config);
        const remoto = await send(['--to', `${SERVIDOR}/${token}/evento`, ...p.args, '--secret', SEGREDO, '--header', 'Content-Type: application/json', '--data', CORPO_ASSINADO]);
        assert.deepEqual(resumo(remoto.tentativas), [tentativa(1, 1, 1, 200)], remoto.cli.descricao());
        assert.equal(remoto.codigo, 0, `código de saída\n${remoto.cli.descricao()}`);
        const mensagens = await maisNovas(token, 5);
        assert.equal(mensagens.length, 1, `uma mensagem gravada em ${token}`);
        assert.deepEqual(mensagens[0].signature, { provider: p.config.provider, valid: true, reason: null }, JSON.stringify(mensagens[0].signature));
        assert.match(mensagens[0].content, /"valor":"R\$ 10,00 ✓"/);
      });
    }
  });

  describe('CA-3: retentativa com backoff', () => {
    test('503, 503, 200 (exponencial padrão): 3 tentativas, esperas do backoff, mesmo corpo e {{uuid}}, Stripe reassinado com timestamp novo', { timeout: 90_000 }, async () => {
      const app = await iniciarCapturador({ responder: (_, i) => ({ status: i < 2 ? 503 : 200 }) });
      const r = await send([
        '--to', `${app.url}/retentativa`,
        '--provider', 'stripe', '--secret', SEGREDO,
        '--retries', '3', '--initial-delay', '1100', '--max-delay', '10000',
        '--header', 'Idempotency-Key: {{uuid}}',
        '--header', 'Content-Type: application/json',
        '--data', '{"id":"{{uuid}}","ts":{{timestamp}},"agora":"{{now}}","r":"{{random 20}}"}',
      ]);

      assert.deepEqual(resumo(r.tentativas), [
        tentativa(1, 1, 4, 503, 1100),
        tentativa(1, 2, 4, 503, 2200),
        tentativa(1, 3, 4, 200),
      ], r.cli.descricao());
      assert.deepEqual(r.desfechos, [{ seq: 1, resultado: 'delivered', tentativas: 3 }], r.cli.descricao());
      assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);

      assert.equal(app.recebidas.length, 3, `três tentativas; recebidas:\n${app.resumo()}`);
      const [a, b, c] = app.recebidas;
      conferirIntervalo(a, b, 1100, r.cli);
      conferirIntervalo(b, c, 2200, r.cli);

      const corpo = a.corpo.toString('utf8');
      const { id } = JSON.parse(corpo);
      assert.match(id, new RegExp(`^${UUID.source}$`, 'i'));
      for (const rec of app.recebidas) {
        assert.equal(rec.corpo.toString('utf8'), corpo, 'a retentativa é o mesmo evento: corpo idêntico');
        assert.equal(cabecalho(rec, 'idempotency-key'), id, '{{uuid}} igual entre tentativas');
      }
      const ts = app.recebidas.map(assinaturaStripe);
      assert.ok(ts[0] < ts[1] && ts[1] < ts[2], `Stripe-Signature reassinada com timestamp novo a cada tentativa: ${ts.join(', ')}`);
    });

    test('backoff fixo: a mesma espera entre as tentativas', { timeout: 90_000 }, async () => {
      const app = await iniciarCapturador({ responder: (_, i) => ({ status: i < 2 ? 502 : 204 }) });
      const r = await send(['--to', `${app.url}/fixo`, '--retries', '2', '--backoff', 'fixed', '--initial-delay', '400', '--data', 'x']);
      assert.deepEqual(resumo(r.tentativas), [
        tentativa(1, 1, 3, 502, 400),
        tentativa(1, 2, 3, 502, 400),
        tentativa(1, 3, 3, 204),
      ], r.cli.descricao());
      assert.deepEqual(r.desfechos, [{ seq: 1, resultado: 'delivered', tentativas: 3 }], r.cli.descricao());
      assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
      assert.equal(app.recebidas.length, 3, app.resumo());
      conferirIntervalo(app.recebidas[0], app.recebidas[1], 400, r.cli);
      conferirIntervalo(app.recebidas[1], app.recebidas[2], 400, r.cli);
    });

    test('exponencial limitado por --max-delay; esgotadas as tentativas, desiste e sai com 1', { timeout: 90_000 }, async () => {
      const app = await iniciarCapturador({ status: 503 });
      const r = await send(['--to', `${app.url}/sempre-503`, '--retries', '3', '--initial-delay', '300', '--max-delay', '500', '--data', 'x']);
      assert.deepEqual(resumo(r.tentativas), [
        tentativa(1, 1, 4, 503, 300),
        tentativa(1, 2, 4, 503, 500),
        tentativa(1, 3, 4, 503, 500),
        tentativa(1, 4, 4, 503),
      ], r.cli.descricao());
      assert.deepEqual(r.desfechos, [{ seq: 1, resultado: 'gave up', tentativas: 4 }], r.cli.descricao());
      assert.equal(r.codigo, 1, `código de saída\n${r.cli.descricao()}`);
      assert.equal(app.recebidas.length, 4, app.resumo());
      conferirIntervalo(app.recebidas[1], app.recebidas[2], 500, r.cli);
    });
  });

  describe('CA-4: Retry-After, 4xx e erro de conexão', () => {
    test('429 com Retry-After: 1 → espera 1000 ms (Retry-After), acima do backoff', { timeout: 90_000 }, async () => {
      const app = await iniciarCapturador({ responder: (_, i) => (i === 0 ? { status: 429, cabecalhos: { 'Retry-After': '1' } } : { status: 200 }) });
      const r = await send(['--to', `${app.url}/limite`, '--retries', '2', '--initial-delay', '100', '--max-delay', '5000', '--data', 'x']);
      assert.deepEqual(resumo(r.tentativas), [
        tentativa(1, 1, 3, 429, 1000, true),
        tentativa(1, 2, 3, 200),
      ], r.cli.descricao());
      assert.deepEqual(r.desfechos, [{ seq: 1, resultado: 'delivered', tentativas: 2 }], r.cli.descricao());
      assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
      assert.equal(app.recebidas.length, 2, app.resumo());
      conferirIntervalo(app.recebidas[0], app.recebidas[1], 1000, r.cli);
    });

    test('503 com Retry-After: 5 e --max-delay 400 → espera 400 ms', { timeout: 90_000 }, async () => {
      const app = await iniciarCapturador({ responder: (_, i) => (i === 0 ? { status: 503, cabecalhos: { 'Retry-After': '5' } } : { status: 200 }) });
      const r = await send(['--to', `${app.url}/teto`, '--retries', '1', '--initial-delay', '100', '--max-delay', '400', '--data', 'x']);
      // O sufixo ` (Retry-After)` com a espera cortada pelo teto fica livre (ver README).
      assert.deepEqual(resumo(r.tentativas, { comRetryAfter: false }), [
        { seq: 1, n: 1, total: 2, status: 503, espera: 400 },
        { seq: 1, n: 2, total: 2, status: 200, espera: null },
      ], r.cli.descricao());
      assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
      assert.equal(app.recebidas.length, 2, app.resumo());
      conferirIntervalo(app.recebidas[0], app.recebidas[1], 400, r.cli);
    });

    test('503 com Retry-After em data HTTP → espera até a data (Retry-After)', { timeout: 90_000 }, async () => {
      const app = await iniciarCapturador({
        responder: (_, i) => (i === 0 ? { status: 503, cabecalhos: { 'Retry-After': new Date(Date.now() + 3_000).toUTCString() } } : { status: 200 }),
      });
      const r = await send(['--to', `${app.url}/data`, '--retries', '1', '--initial-delay', '100', '--max-delay', '10000', '--data', 'x']);
      assert.equal(r.tentativas.length, 2, r.cli.descricao());
      const [primeira] = r.tentativas;
      assert.equal(primeira.status, 503, r.cli.descricao());
      assert.ok(primeira.retryAfter, `sufixo (Retry-After)\n${r.cli.descricao()}`);
      assert.ok(primeira.espera >= 1_000 && primeira.espera <= 3_000, `espera ${primeira.espera} ms para uma data 2–3 s à frente\n${r.cli.descricao()}`);
      assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
      conferirIntervalo(app.recebidas[0], app.recebidas[1], primeira.espera, r.cli);
    });

    test('400 não retenta: uma tentativa, gave up after 1 attempt(s), saída 1', { timeout: 90_000 }, async () => {
      const app = await iniciarCapturador({ status: 400 });
      const r = await send(['--to', `${app.url}/ruim`, '--retries', '3', '--initial-delay', '100', '--data', 'x']);
      assert.deepEqual(resumo(r.tentativas), [tentativa(1, 1, 4, 400)], r.cli.descricao());
      assert.deepEqual(r.desfechos, [{ seq: 1, resultado: 'gave up', tentativas: 1 }], r.cli.descricao());
      assert.equal(r.codigo, 1, `código de saída\n${r.cli.descricao()}`);
      assert.equal(app.recebidas.length, 1, app.resumo());
    });

    test('erro de conexão retenta: porta recusando, depois o receptor sobe e a entrega sai', { timeout: 90_000 }, async () => {
      const porta = await portaLivre();
      const cli = await iniciarSend(['--to', `http://127.0.0.1:${porta}/volta`, '--retries', '2', '--initial-delay', '3000', '--data', 'x']);
      await cli.esperarLinha(/ #1 attempt 1\/3 -> error: /, { prazo: 30_000 }).catch((e) => {
        recusarErroDeUso(cli);
        throw e;
      });
      const linhaVista = Date.now();
      const app = await iniciarCapturador({ porta });
      const r = await concluir(cli);
      assert.deepEqual(resumo(r.tentativas), [
        { seq: 1, n: 1, total: 3, status: 'error', espera: 3000, retryAfter: false },
        tentativa(1, 2, 3, 200),
      ], r.cli.descricao());
      assert.ok(r.tentativas[0].erro.trim().length > 0, 'motivo do erro');
      assert.deepEqual(r.desfechos, [{ seq: 1, resultado: 'delivered', tentativas: 2 }], r.cli.descricao());
      assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
      assert.equal(app.recebidas.length, 1, app.resumo());
      // A linha sai antes da espera; entre vê-la e a segunda tentativa, os 3000 ms (menos o trânsito do pipe).
      const espera = app.recebidas[0].em - linhaVista;
      assert.ok(espera >= 3000 - 300 && espera <= 3000 + FOLGA_ACIMA, `segunda tentativa ${espera} ms depois da linha do erro, esperado ~3000 ms`);
    });

    test('--timeout estourado conta como erro e retenta', { timeout: 90_000 }, async () => {
      const app = await iniciarCapturador({ responder: (_, i) => ({ status: 200, atraso: i === 0 ? 4_000 : 0 }) });
      const r = await send(['--to', `${app.url}/lento`, '--timeout', '500', '--retries', '1', '--initial-delay', '200', '--data', 'x']);
      assert.deepEqual(resumo(r.tentativas), [
        { seq: 1, n: 1, total: 2, status: 'error', espera: 200, retryAfter: false },
        tentativa(1, 2, 2, 200),
      ], r.cli.descricao());
      assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);
      assert.equal(app.recebidas.length, 2, app.resumo());
      const intervalo = app.recebidas[1].em - app.recebidas[0].em;
      assert.ok(intervalo >= 700 - FOLGA_ABAIXO && intervalo < 4_000, `a segunda tentativa sai depois do timeout + espera, sem esperar a resposta lenta (${intervalo} ms)`);
    });
  });

  describe('CA-5: --repeat', () => {
    test('--repeat 3: {{seq}} 1..3, {{uuid}} distintos, --interval respeitado, saída 0', { timeout: 90_000 }, async () => {
      const app = await iniciarCapturador();
      const r = await send([
        '--to', `${app.url}/repete`, '--repeat', '3', '--interval', '300',
        '--header', 'X-Seq: {{seq}}',
        '--data', '{"seq":{{seq}},"id":"{{uuid}}"}',
      ]);
      assert.deepEqual(resumo(r.tentativas), [tentativa(1, 1, 1, 200), tentativa(2, 1, 1, 200), tentativa(3, 1, 1, 200)], r.cli.descricao());
      assert.deepEqual(r.desfechos, [1, 2, 3].map((seq) => ({ seq, resultado: 'delivered', tentativas: 1 })), r.cli.descricao());
      assert.equal(r.codigo, 0, `código de saída\n${r.cli.descricao()}`);

      assert.equal(app.recebidas.length, 3, app.resumo());
      const corpos = app.recebidas.map((rec) => JSON.parse(rec.corpo.toString('utf8')));
      assert.deepEqual(corpos.map((c) => c.seq), [1, 2, 3]);
      assert.deepEqual(app.recebidas.map((rec) => cabecalho(rec, 'x-seq')), ['1', '2', '3']);
      for (const c of corpos) assert.match(c.id, new RegExp(`^${UUID.source}$`, 'i'));
      assert.equal(new Set(corpos.map((c) => c.id)).size, 3, `{{uuid}} novo a cada envio: ${corpos.map((c) => c.id).join(', ')}`);
      conferirIntervalo(app.recebidas[0], app.recebidas[1], 300, r.cli);
      conferirIntervalo(app.recebidas[1], app.recebidas[2], 300, r.cli);
    });

    test('--repeat 3 com o segundo envio recusado: os três saem, #2 desiste, saída 1', { timeout: 90_000 }, async () => {
      const app = await iniciarCapturador({ responder: (_, i) => ({ status: i === 1 ? 500 : 200 }) });
      const r = await send(['--to', `${app.url}/um-falha`, '--repeat', '3', '--data', '{{seq}}']);
      assert.deepEqual(resumo(r.tentativas), [tentativa(1, 1, 1, 200), tentativa(2, 1, 1, 500), tentativa(3, 1, 1, 200)], r.cli.descricao());
      assert.deepEqual(r.desfechos, [
        { seq: 1, resultado: 'delivered', tentativas: 1 },
        { seq: 2, resultado: 'gave up', tentativas: 1 },
        { seq: 3, resultado: 'delivered', tentativas: 1 },
      ], r.cli.descricao());
      assert.equal(r.codigo, 1, `código de saída\n${r.cli.descricao()}`);
      assert.deepEqual(app.recebidas.map((rec) => rec.corpo.toString('utf8')), ['1', '2', '3']);
    });
  });
});
