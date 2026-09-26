import http from 'node:http';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import type { APIRequestContext } from '@playwright/test';
import { BASE_URL, buscarMensagem, expect, listar, test } from '../../support/contrato.js';
import { erros422, lerRegras, putRegras, salvarRegras, type Atraso, type Falha, type Regra } from '../../support/regras.js';

// Atrasos, dribble e falhas de rede (CA-7, fatia 05, Anexo B), observados do lado do cliente.
//
// Margens de tempo (generosas de propósito, para não depender da máquina):
// - o atraso é aplicado antes de responder, então o tempo medido no cliente nunca fica abaixo dele:
//   o piso é o atraso menos 20 ms (granularidade de relógio); o teto é o atraso mais 5 s (fila, GC,
//   Docker Desktop);
// - "aleatório" é conferido pela dispersão entre amostras seguidas (≥ 80 ms num intervalo de 800 ms),
//   o que um atraso fixo com ruído de rede não alcança;
// - dribble: pedaços separados por ≥ 100 ms (o pedido é ~200 ms) e o último pedaço depois de 80% da
//   duração pedida.
// As falhas de rede são lidas por socket cru (`node:net`), porque um cliente HTTP esconde o que
// chegou no fio.

const HOST = new URL(BASE_URL);
const PORTA = Number(HOST.port || 80);

/** Salva uma regra que responde em `/lento` e mede quanto a resposta leva, no cliente. */
async function medir(request: APIRequestContext, tokenId: string, opcoes: { timeout?: number } = {}): Promise<{ ms: number; status: number; corpo: string; id: string }> {
  const inicio = performance.now();
  const res = await request.post(`/${tokenId}/lento`, { data: Buffer.from('corpo'), timeout: opcoes.timeout });
  const corpo = await res.text();
  return { ms: performance.now() - inicio, status: res.status(), corpo, id: res.headers()['x-request-id']! };
}

function regraLenta(delay: Atraso): Regra {
  return { name: 'lenta', match: { path: { equals: '/lento' } }, response: { status: 201, body: 'demorei', delay } };
}

test.describe('atrasos', () => {
  test('fixo: a resposta leva o atraso pedido; status, corpo e mensagem como sempre', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [regraLenta({ fixed: 1500 })]);
    const r = await medir(request, token.uuid);
    expect(r.status).toBe(201);
    expect(r.corpo).toBe('demorei');
    expect(r.ms).toBeGreaterThanOrEqual(1480);
    expect(r.ms).toBeLessThan(1500 + 5000);
    const msg = await buscarMensagem(request, token.uuid, r.id);
    expect(msg.content).toBe('corpo');
    expect(msg.rule?.name).toBe('lenta');

    // Sem regra casando (outro caminho), sem atraso.
    const inicio = performance.now();
    expect((await request.get(`/${token.uuid}/rapido`)).status()).toBe(200);
    expect(performance.now() - inicio).toBeLessThan(1000);
  });

  test('uniforme: cada resposta cai em [min, max] e o valor varia entre requisições', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [regraLenta({ uniform: { min: 800, max: 1600 } })]);
    const tempos: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await medir(request, token.uuid);
      expect(r.status).toBe(201);
      tempos.push(r.ms);
    }
    for (const ms of tempos) {
      expect(ms, JSON.stringify(tempos)).toBeGreaterThanOrEqual(780);
      expect(ms, JSON.stringify(tempos)).toBeLessThan(1600 + 5000);
    }
    expect(Math.max(...tempos) - Math.min(...tempos), JSON.stringify(tempos)).toBeGreaterThanOrEqual(80);
  });

  test('log-normal: amostras em volta da mediana e variando', async ({ request, tokens }) => {
    const token = await tokens.criar();
    // Mediana 1000 ms, sigma 0,25: 99,99% das amostras ficam entre ~400 e ~2500 ms.
    await salvarRegras(request, token.uuid, [regraLenta({ lognormal: { median: 1000, sigma: 0.25 } })]);
    const tempos: number[] = [];
    for (let i = 0; i < 5; i++) tempos.push((await medir(request, token.uuid)).ms);
    for (const ms of tempos) {
      expect(ms, JSON.stringify(tempos)).toBeGreaterThanOrEqual(300);
      expect(ms, JSON.stringify(tempos)).toBeLessThan(2600 + 5000);
    }
    expect(Math.max(...tempos) - Math.min(...tempos), JSON.stringify(tempos)).toBeGreaterThanOrEqual(50);
  });

  test('log-normal é cortado no teto de 60 s', async ({ request, tokens }) => {
    // Mediana 60 s e sigma 3: metade das amostras passaria do teto sem o corte. Leva até ~60 s.
    test.setTimeout(120_000);
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [regraLenta({ lognormal: { median: 60_000, sigma: 3 } })]);
    const r = await medir(request, token.uuid, { timeout: 110_000 });
    expect(r.status).toBe(201);
    expect(r.ms).toBeLessThan(60_000 + 5000);
  });

  test('teto: 60 000 ms aceito; acima → 422 em response.delay', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const noTeto = [{ fixed: 60_000 }, { uniform: { min: 0, max: 60_000 } }, { lognormal: { median: 60_000, sigma: 1 } }] as const;
    for (const delay of noTeto) {
      const [salva] = await salvarRegras(request, token.uuid, [regraLenta(delay)]);
      expect(salva.response.delay).toEqual(delay);
    }
    for (const delay of [{ fixed: 60_001 }, { uniform: { min: 0, max: 60_001 } }, { fixed: -1 }]) {
      const corpo = await erros422(await putRegras(request, token.uuid, [regraLenta(delay)]));
      const chaves = Object.keys(corpo);
      expect(chaves.length, JSON.stringify(corpo)).toBeGreaterThan(0);
      expect(chaves.every((k) => k.startsWith('0.response.delay')), JSON.stringify(corpo)).toBe(true);
      for (const m of Object.values(corpo).flat()) {
        expect(m).toMatch(/^[A-Z].+\.$/);
        expect(m).not.toMatch(/not supported yet/i);
      }
    }
  });
});

interface Pedaco {
  ms: number;
  bytes: number;
}

/** GET lido em streaming: quando cada pedaço do corpo chegou, desde o início do pedido. */
function lerEmStreaming(caminho: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; pedacos: Pedaco[]; corpo: string }> {
  return new Promise((resolve, reject) => {
    const inicio = performance.now();
    const req = http.get({ host: HOST.hostname, port: PORTA, path: caminho, agent: false }, (res) => {
      const pedacos: Pedaco[] = [];
      const partes: Buffer[] = [];
      res.on('data', (parte: Buffer) => {
        pedacos.push({ ms: performance.now() - inicio, bytes: parte.length });
        partes.push(parte);
      });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, pedacos, corpo: Buffer.concat(partes).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('timeout lendo em streaming')));
  });
}

test.describe('dribble', () => {
  test('o corpo chega em pedaços espaçados ao longo da duração pedida (chunked)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const corpo = 'abcdefghij'.repeat(20);
    await salvarRegras(request, token.uuid, [{
      name: 'gotejando',
      match: { path: { equals: '/gota' } },
      response: { status: 201, headers: { 'X-Mock': 'sim', 'Content-Type': 'text/plain' }, body: corpo, dribble: { chunks: 10, durationMs: 2000 } },
    }]);

    const r = await lerEmStreaming(`/${token.uuid}/gota`);
    const tempos = JSON.stringify(r.pedacos);
    expect(r.status).toBe(201);
    expect(r.headers['x-mock']).toBe('sim');
    expect(String(r.headers['transfer-encoding']).toLowerCase()).toContain('chunked');
    expect(r.corpo).toBe(corpo);
    // O primeiro pedaço chega cedo (não é tudo guardado até o fim) e o último perto do fim.
    expect(r.pedacos[0].ms, tempos).toBeLessThan(1000);
    expect(r.pedacos.at(-1)!.ms, tempos).toBeGreaterThanOrEqual(0.8 * 2000);
    // Intervalo pedido ~200 ms; o cliente pode juntar pedaços, então basta metade das separações.
    const separacoes = r.pedacos.slice(1).filter((p, i) => p.ms - r.pedacos[i].ms >= 100).length;
    expect(separacoes, tempos).toBeGreaterThanOrEqual(4);

    const msg = await buscarMensagem(request, token.uuid, String(r.headers['x-request-id']));
    expect(msg.rule?.name).toBe('gotejando');
  });

  test('validação: chunks 1..100 e durationMs 0..60000; fora disso → 422 em response.dribble', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regra = (dribble: { chunks: number; durationMs: number }): Regra => ({ name: 'd', response: { body: 'x', dribble } });
    for (const dribble of [{ chunks: 1, durationMs: 0 }, { chunks: 100, durationMs: 60_000 }]) {
      const [salva] = await salvarRegras(request, token.uuid, [regra(dribble)]);
      expect(salva.response.dribble).toEqual(dribble);
    }
    for (const dribble of [{ chunks: 0, durationMs: 100 }, { chunks: 101, durationMs: 100 }, { chunks: 2, durationMs: 60_001 }, { chunks: 2, durationMs: -1 }]) {
      const corpo = await erros422(await putRegras(request, token.uuid, [regra(dribble)]));
      expect(Object.keys(corpo).every((k) => k.startsWith('0.response.dribble')), JSON.stringify(corpo)).toBe(true);
      for (const m of Object.values(corpo).flat()) expect(m).not.toMatch(/not supported yet/i);
    }
  });
});

interface Observado {
  bytes: Buffer;
  /** Erro do socket (ex.: ECONNRESET); ausente quando a conexão fechou limpa. */
  erro?: NodeJS.ErrnoException;
  ms: number;
}

/** Manda um POST cru e devolve tudo o que chegou até a conexão fechar. */
function observarSocket(caminho: string, corpo = '{"id":1}'): Promise<Observado> {
  const pedido = [
    `POST ${caminho} HTTP/1.1`, `Host: ${HOST.host}`, 'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(corpo)}`, 'Connection: close', '', corpo,
  ].join('\r\n');
  return new Promise((resolve) => {
    const inicio = performance.now();
    const partes: Buffer[] = [];
    let erro: NodeJS.ErrnoException | undefined;
    const socket = net.connect(PORTA, HOST.hostname, () => socket.write(pedido));
    socket.on('data', (parte: Buffer) => partes.push(parte));
    socket.on('error', (e: NodeJS.ErrnoException) => { erro = e; });
    socket.setTimeout(20_000, () => socket.destroy(Object.assign(new Error('timeout: a conexão não fechou'), { code: 'TIMEOUT' })));
    socket.on('close', () => resolve({ bytes: Buffer.concat(partes), erro, ms: performance.now() - inicio }));
  });
}

/** Corpo chunked completo e bem formado (tamanhos hexadecimais, CRLF e o pedaço final 0). */
function chunkedValido(corpo: Buffer): boolean {
  let i = 0;
  for (;;) {
    const fim = corpo.indexOf('\r\n', i);
    if (fim < 0) return false;
    const linha = corpo.subarray(i, fim).toString('latin1').split(';')[0].trim();
    if (!/^[0-9a-fA-F]+$/.test(linha)) return false;
    const tamanho = parseInt(linha, 16);
    i = fim + 2;
    if (tamanho === 0) return corpo.subarray(i).toString('latin1').startsWith('\r\n') || corpo.indexOf('\r\n\r\n', i) >= 0;
    if (i + tamanho + 2 > corpo.length) return false;
    if (corpo.subarray(i + tamanho, i + tamanho + 2).toString('latin1') !== '\r\n') return false;
    i += tamanho + 2;
  }
}

/** Regra de falha em `/falha`, com resposta e atraso que a falha tem de ignorar. */
async function salvarFalha(request: APIRequestContext, tokenId: string, fault: Falha): Promise<string> {
  const [salva] = await salvarRegras(request, tokenId, [{
    name: `falha ${fault}`,
    match: { path: { equals: '/falha' } },
    response: { status: 201, headers: { 'X-Mock': 'sim' }, body: 'nunca sai', delay: { fixed: 5000 }, fault },
  }]);
  expect(salva.response.fault).toBe(fault);
  return salva.id;
}

/** A mensagem foi gravada antes da falha, com a regra que respondeu. */
async function expectGravada(request: APIRequestContext, tokenId: string, regraId: string, fault: Falha): Promise<void> {
  const { data, total } = await listar(request, tokenId);
  expect(total).toBe(1);
  expect(data[0].method).toBe('POST');
  expect(data[0].content).toBe('{"id":1}');
  expect(data[0].rule).toEqual({ id: regraId, name: `falha ${fault}` });
}

const descrever = (o: Observado): string =>
  `erro=${o.erro?.code ?? 'nenhum'} bytes=${o.bytes.length} ${JSON.stringify(o.bytes.subarray(0, 120).toString('latin1'))}`;

test.describe('falhas de rede (socket cru)', () => {
  test('connection_reset: a conexão cai sem resposta HTTP (RST; FIN atrás de encaminhador de porta)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regraId = await salvarFalha(request, token.uuid, 'connection_reset');
    const o = await observarSocket(`/${token.uuid}/falha`);
    // Encaminhadores de porta (OrbStack, Docker Desktop) trocam o RST do container por um FIN no host.
    // O RST de verdade é exigido por backend/.../rules/RuleTimingApiTest (Tomcat no mesmo processo,
    // sem encaminhador), que roda no ./ci.sh. Aqui: RST, ou fechamento sem nenhum byte.
    const resetOuFechouVazio = o.erro?.code === 'ECONNRESET' || (o.erro === undefined && o.bytes.length === 0);
    expect(resetOuFechouVazio, descrever(o)).toBe(true);
    expect(o.bytes.toString('latin1'), descrever(o)).not.toMatch(/^HTTP\//);
    expect(o.ms, 'o atraso da regra é ignorado com fault').toBeLessThan(4000);
    await expectGravada(request, token.uuid, regraId, 'connection_reset');
  });

  test('empty_response: a conexão fecha limpa sem nenhum byte', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regraId = await salvarFalha(request, token.uuid, 'empty_response');
    const o = await observarSocket(`/${token.uuid}/falha`);
    expect(o.erro, descrever(o)).toBeUndefined();
    expect(o.bytes.length, descrever(o)).toBe(0);
    expect(o.ms, 'o atraso da regra é ignorado com fault').toBeLessThan(4000);
    await expectGravada(request, token.uuid, regraId, 'empty_response');
  });

  test('malformed_chunk: status e cabeçalhos válidos (chunked) e corpo chunked inválido', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regraId = await salvarFalha(request, token.uuid, 'malformed_chunk');
    const o = await observarSocket(`/${token.uuid}/falha`);
    const texto = o.bytes.toString('latin1');
    const fimCabecalho = texto.indexOf('\r\n\r\n');
    expect(fimCabecalho, descrever(o)).toBeGreaterThan(0);
    const [linhaStatus, ...cabecalhos] = texto.slice(0, fimCabecalho).split('\r\n');
    expect(linhaStatus, descrever(o)).toMatch(/^HTTP\/1\.[01] [1-5]\d\d( .*)?$/);
    for (const c of cabecalhos) expect(c, descrever(o)).toMatch(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+:/);
    expect(cabecalhos.some((c) => /^transfer-encoding:\s*chunked\s*$/i.test(c)), descrever(o)).toBe(true);
    expect(chunkedValido(o.bytes.subarray(fimCabecalho + 4)), descrever(o)).toBe(false);
    expect(o.ms, 'o atraso da regra é ignorado com fault').toBeLessThan(4000);
    await expectGravada(request, token.uuid, regraId, 'malformed_chunk');
  });

  test('random_data_then_close: chegam bytes que não são HTTP e a conexão fecha', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regraId = await salvarFalha(request, token.uuid, 'random_data_then_close');
    const o = await observarSocket(`/${token.uuid}/falha`);
    expect(o.erro?.code, descrever(o)).not.toBe('TIMEOUT');
    expect(o.bytes.length, descrever(o)).toBeGreaterThan(0);
    expect(o.bytes.toString('latin1'), descrever(o)).not.toMatch(/^HTTP\/\d/);
    expect(o.ms, 'o atraso da regra é ignorado com fault').toBeLessThan(4000);
    await expectGravada(request, token.uuid, regraId, 'random_data_then_close');
  });

  test('fault: as quatro vão e voltam no PUT/GET; valor desconhecido → 422 em "0.response.fault"', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const falhas: Falha[] = ['connection_reset', 'empty_response', 'malformed_chunk', 'random_data_then_close'];
    const salvas = await salvarRegras(request, token.uuid, falhas.map((fault) => ({ name: fault, response: { fault } })));
    expect(salvas.map((r) => r.response.fault)).toEqual(falhas);
    expect(await lerRegras(request, token.uuid)).toEqual(salvas);

    const corpo = await erros422(await putRegras(request, token.uuid, [{ name: 'x', response: { fault: 'explodir' as Falha } }]));
    expect(Object.keys(corpo)).toEqual(['0.response.fault']);
    expect(corpo['0.response.fault'][0]).toMatch(/^[A-Z].+\.$/);
    expect(corpo['0.response.fault'][0]).not.toMatch(/not supported yet/i);
  });
});
