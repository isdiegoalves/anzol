import http from 'node:http';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import type { APIRequestContext } from '@playwright/test';
import { BASE_URL, JSON_ACCEPT, buscarMensagem, espera, expect, listar, test } from '../../support/contrato.js';
import { erros422, lerRegras, putRegras, salvarRegras, type Falha, type Regra } from '../../support/regras.js';

// Todo teste que prende conexão (hang, stall_after_headers) fica neste arquivo: os testes de um arquivo rodam em
// sequência no mesmo worker, e o de carga ocupa as 128 vagas do servidor sem disputar com outro teste.

const HOST = new URL(BASE_URL);
const PORTA = Number(HOST.port || 80);
/** O `ANZOL_FAULT_HOLD_MAX` (s) com que o app sob teste foi iniciado; o padrão do servidor é 300. */
const TETO_MS = Number(process.env.ANZOL_FAULT_HOLD_MAX ?? 300) * 1000;
/** Os outros testes daqui conferem conexões presas por até ~20 s; um teto menor as fecharia antes. */
const TETO_MINIMO_MS = 30_000;

test.beforeAll(() => {
  expect(TETO_MS, `ANZOL_FAULT_HOLD_MAX=${process.env.ANZOL_FAULT_HOLD_MAX}: o arquivo precisa de pelo menos 30 s`)
    .toBeGreaterThanOrEqual(TETO_MINIMO_MS);
});

interface Conexao {
  dados(): Buffer;
  /** ms desde a conexão até cada pedaço recebido. */
  chegadas: number[];
  /** O servidor fechou antes de o cliente desistir. */
  fechouOServidor(): boolean;
  /** ms desde a conexão até o fechamento pelo servidor. */
  fechouEm(): number | undefined;
  /** Espera o servidor fechar, até `ms` desde a conexão. */
  ate(ms: number): Promise<void>;
  /** O cliente desiste: fecha a conexão. */
  fechar(): void;
}

/** POST cru, sem prazo do lado do cliente: só o teste decide quando desistir. */
function conectar(caminho: string, corpo = '{"id":1}'): Conexao {
  const pedido = [
    `POST ${caminho} HTTP/1.1`, `Host: ${HOST.host}`, 'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(corpo)}`, 'Connection: close', '', corpo,
  ].join('\r\n');
  const inicio = performance.now();
  const partes: Buffer[] = [];
  const chegadas: number[] = [];
  let desistiu = false;
  let fechouEm: number | undefined;
  const socket = net.connect(PORTA, HOST.hostname, () => socket.write(pedido));
  socket.on('data', (parte: Buffer) => {
    partes.push(parte);
    chegadas.push(performance.now() - inicio);
  });
  socket.on('error', () => undefined);
  const fechada = new Promise<void>((resolve) => socket.on('close', () => {
    if (!desistiu) fechouEm = performance.now() - inicio;
    resolve();
  }));
  return {
    dados: () => Buffer.concat(partes),
    chegadas,
    fechouOServidor: () => fechouEm !== undefined,
    fechouEm: () => fechouEm,
    ate: (ms) => Promise.race([fechada, espera(Math.max(0, ms - (performance.now() - inicio)))]),
    fechar() {
      if (fechouEm === undefined) desistiu = true;
      socket.destroy();
    },
  };
}

interface Cabeca {
  linha: string;
  status: number;
  headers: Record<string, string>;
  corpo: Buffer;
}

/** Status, cabeçalhos (nome em minúsculas) e o que veio depois deles; `null` sem o fim dos cabeçalhos. */
function cabeca(bytes: Buffer): Cabeca | null {
  const fim = bytes.indexOf('\r\n\r\n');
  if (fim < 0) return null;
  const [linha, ...linhas] = bytes.subarray(0, fim).toString('latin1').split('\r\n');
  const headers: Record<string, string> = {};
  for (const l of linhas) {
    const i = l.indexOf(':');
    headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return { linha, status: Number(linha.split(' ')[1]), headers, corpo: bytes.subarray(fim + 4) };
}

const descrever = (c: Conexao): string =>
  `servidor fechou=${c.fechouOServidor()} em ${Math.round(c.fechouEm() ?? -1)} ms, bytes=${c.dados().length} ` +
  JSON.stringify(c.dados().subarray(0, 200).toString('latin1'));

/** Presa: nada chegou e a conexão continua aberta. */
const presa = (c: Conexao): boolean => c.dados().length === 0 && !c.fechouOServidor();

/** Regra em `/falha` com status, cabeçalho, corpo e atraso que a falha usa ou ignora. */
async function salvarFalha(request: APIRequestContext, tokenId: string, fault: Falha, resposta: Regra['response'] = {}): Promise<string> {
  const [salva] = await salvarRegras(request, tokenId, [{
    name: `falha ${fault}`,
    match: { path: { equals: '/falha' } },
    response: { status: 201, headers: { 'X-Mock': 'sim' }, body: 'abcdefghijklmnopqrst', delay: { fixed: 5000 }, ...resposta, fault },
  }]);
  expect(salva.response.fault).toBe(fault);
  return salva.id;
}

async function expectGravadaAntes(request: APIRequestContext, tokenId: string, regraId: string, fault: Falha): Promise<void> {
  await expect.poll(async () => (await listar(request, tokenId)).total, { timeout: 3000 }).toBe(1);
  const [msg] = (await listar(request, tokenId)).data;
  expect(msg.content).toBe('{"id":1}');
  expect(msg.rule).toEqual({ id: regraId, name: `falha ${fault}` });
  expect(msg.response).toEqual({ fault });
}

interface VistoPeloCliente {
  status: number | null;
  corpo: string;
  fim: 'end' | 'timeout' | 'close';
  completo: boolean;
}

/** Um cliente HTTP comum, com timeout de socket de `timeout` ms. */
function clienteHttp(caminho: string, timeout: number): Promise<VistoPeloCliente> {
  return new Promise((resolve) => {
    let status: number | null = null;
    let corpo = '';
    let completo = false;
    let feito = false;
    const fim = (como: VistoPeloCliente['fim']) => {
      if (feito) return;
      feito = true;
      resolve({ status, corpo, fim: como, completo });
      req.destroy();
    };
    const req = http.request({ host: HOST.hostname, port: PORTA, path: caminho, method: 'POST', agent: false, timeout, headers: { 'Content-Type': 'application/json' } }, (res) => {
      status = res.statusCode ?? null;
      res.setEncoding('latin1');
      res.on('data', (parte: string) => { corpo += parte; });
      res.on('end', () => { completo = res.complete; fim('end'); });
      res.on('close', () => { completo = res.complete; fim('close'); });
    });
    req.on('timeout', () => fim('timeout'));
    req.on('error', () => fim('close'));
    req.end('{"id":1}');
  });
}

test.describe('hang', () => {
  test('grava a mensagem e não manda nenhum byte enquanto o cliente espera', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regraId = await salvarFalha(request, token.uuid, 'hang');
    const c = conectar(`/${token.uuid}/falha`);
    try {
      await expectGravadaAntes(request, token.uuid, regraId, 'hang');
      await c.ate(6000);
      expect(presa(c), descrever(c)).toBe(true);
    } finally {
      c.fechar();
    }
  });

  test('um cliente HTTP com timeout de 2 s desiste sem ver resposta', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarFalha(request, token.uuid, 'hang');
    const inicio = performance.now();
    const visto = await clienteHttp(`/${token.uuid}/falha`, 2000);
    expect(visto).toEqual({ status: null, corpo: '', fim: 'timeout', completo: false });
    expect(performance.now() - inicio).toBeLessThan(5000);
  });
});

test.describe('stall_after_headers', () => {
  test('manda status e cabeçalhos com o Content-Length do corpo e nenhum byte do corpo', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regraId = await salvarFalha(request, token.uuid, 'stall_after_headers', { status: 202, body: 'abcdefghij' });
    const c = conectar(`/${token.uuid}/falha`);
    try {
      await c.ate(6000);
      const r = cabeca(c.dados());
      expect(r, descrever(c)).not.toBeNull();
      expect(r!.linha, descrever(c)).toMatch(/^HTTP\/1\.1 202\b/);
      expect(r!.headers['x-mock']).toBe('sim');
      expect(r!.headers['content-length']).toBe('10');
      expect(r!.headers['transfer-encoding']).toBeUndefined();
      expect(r!.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(r!.corpo.length, descrever(c)).toBe(0);
      expect(c.chegadas[0], 'o atraso da regra é ignorado com fault').toBeLessThan(3000);
      expect(c.fechouOServidor(), descrever(c)).toBe(false);
      await expectGravadaAntes(request, token.uuid, regraId, 'stall_after_headers');
    } finally {
      c.fechar();
    }
  });

  test('um cliente HTTP vê a resposta começar e o corpo nunca terminar', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarFalha(request, token.uuid, 'stall_after_headers', { status: 202, body: 'abcdefghij' });
    const visto = await clienteHttp(`/${token.uuid}/falha`, 2000);
    expect(visto).toEqual({ status: 202, corpo: '', fim: 'timeout', completo: false });
  });
});

test.describe('truncated_body', () => {
  test('manda status, cabeçalhos com o Content-Length inteiro, metade do corpo, e fecha', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regraId = await salvarFalha(request, token.uuid, 'truncated_body');
    const c = conectar(`/${token.uuid}/falha`);
    await c.ate(6000);
    c.fechar();
    expect(c.fechouOServidor(), descrever(c)).toBe(true);
    expect(c.fechouEm()!, 'o atraso da regra é ignorado com fault').toBeLessThan(4000);
    const r = cabeca(c.dados());
    expect(r, descrever(c)).not.toBeNull();
    expect(r!.linha).toMatch(/^HTTP\/1\.1 201\b/);
    expect(r!.headers['x-mock']).toBe('sim');
    expect(r!.headers['content-length']).toBe('20');
    expect(r!.headers['transfer-encoding']).toBeUndefined();
    expect(r!.corpo.toString('latin1')).toBe('abcdefghij');
    await expectGravadaAntes(request, token.uuid, regraId, 'truncated_body');
  });

  test('com template, corta a metade do corpo renderizado', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarFalha(request, token.uuid, 'truncated_body', { body: '{{request.method}}-0123456789', template: true });
    const c = conectar(`/${token.uuid}/falha`);
    await c.ate(6000);
    c.fechar();
    const r = cabeca(c.dados());
    expect(r, descrever(c)).not.toBeNull();
    expect(r!.headers['content-length']).toBe(String('POST-0123456789'.length));
    expect(r!.corpo.toString('latin1')).toBe('POST-01');
  });

  test('um cliente HTTP vê o corpo acabar antes do Content-Length', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarFalha(request, token.uuid, 'truncated_body');
    const visto = await clienteHttp(`/${token.uuid}/falha`, 5000);
    expect(visto.status).toBe(201);
    expect(visto.corpo).toBe('abcdefghij');
    expect(visto.completo).toBe(false);
    expect(visto.fim).not.toBe('timeout');
  });
});

test.describe('validação das falhas', () => {
  test('as sete vão e voltam no PUT/GET; hang aceita corpo vazio', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const falhas: Falha[] = [
      'connection_reset', 'empty_response', 'malformed_chunk', 'random_data_then_close',
      'hang', 'stall_after_headers', 'truncated_body',
    ];
    const salvas = await salvarRegras(request, token.uuid, falhas.map((fault) => ({ name: fault, response: { body: 'x', fault } })));
    expect(salvas.map((r) => r.response.fault)).toEqual(falhas);
    expect(await lerRegras(request, token.uuid)).toEqual(salvas);
    const [semCorpo] = await salvarRegras(request, token.uuid, [{ name: 'hang sem corpo', response: { fault: 'hang' } }]);
    expect(semCorpo.response).toMatchObject({ fault: 'hang', body: '' });
  });

  test('stall_after_headers e truncated_body sem corpo → 422 em "0.response.body"', async ({ request, tokens }) => {
    const token = await tokens.criar();
    for (const fault of ['stall_after_headers', 'truncated_body'] as const) {
      for (const resposta of [{ fault }, { fault, body: '' }]) {
        const corpo = await erros422(await putRegras(request, token.uuid, [{ name: 'x', response: resposta }]));
        expect(corpo, JSON.stringify(resposta)).toEqual({ '0.response.body': [`The body field is required when fault is ${fault}.`] });
      }
    }
    expect(await lerRegras(request, token.uuid)).toEqual([]);
  });
});

/** Abre uma presa nova em `caminho` até ela ficar presa por 1,5 s (a vaga pode levar uns segundos para voltar). */
async function expectVagaDeVolta(caminho: string, prazo: number): Promise<void> {
  await expect.poll(async () => {
    const c = conectar(caminho);
    await c.ate(1500);
    const ficou = presa(c);
    c.fechar();
    return ficou;
  }, { timeout: prazo, intervals: [500] }).toBe(true);
}

test.describe('teto de conexões presas', () => {
  test('por URL: 16 presas (hang e stall juntos); a 17ª → 503 com X-Fault-Limit, gravada com a regra', async ({ request, tokens }) => {
    test.setTimeout(90_000);
    const token = await tokens.criar();
    const [presaRegra] = await salvarRegras(request, token.uuid, [
      { name: 'presa', match: { path: { equals: '/h' } }, response: { fault: 'hang' } },
      { name: 'parada', match: { path: { equals: '/s' } }, response: { body: 'abc', fault: 'stall_after_headers' } },
    ]);
    const outra = await tokens.criar();
    await salvarRegras(request, outra.uuid, [{ name: 'presa', response: { fault: 'hang' } }]);

    const abertas = [
      ...Array.from({ length: 8 }, () => conectar(`/${token.uuid}/h`)),
      ...Array.from({ length: 8 }, () => conectar(`/${token.uuid}/s`)),
    ];
    try {
      await expect.poll(async () => (await listar(request, token.uuid)).total, { timeout: 10_000 }).toBe(16);
      const decimaSetima = conectar(`/${token.uuid}/h`);
      abertas.push(decimaSetima);
      await decimaSetima.ate(5000);
      const r = cabeca(decimaSetima.dados());
      expect(r, descrever(decimaSetima)).not.toBeNull();
      expect(r!.status).toBe(503);
      expect(r!.headers['x-fault-limit']).toBe('16 held connections on this URL');
      const msg = await buscarMensagem(request, token.uuid, r!.headers['x-request-id']);
      expect(msg.rule).toEqual({ id: presaRegra.id, name: 'presa' });
      expect(msg.response).toEqual({ status: 503 });

      for (const c of abertas.slice(0, 8)) expect(presa(c), descrever(c)).toBe(true);
      for (const c of abertas.slice(8, 16)) {
        expect(c.fechouOServidor(), descrever(c)).toBe(false);
        expect(cabeca(c.dados())?.status, descrever(c)).toBe(200);
      }

      const naOutra = conectar(`/${outra.uuid}`);
      abertas.push(naOutra);
      await naOutra.ate(2000);
      expect(presa(naOutra), `o teto é por URL: ${descrever(naOutra)}`).toBe(true);
    } finally {
      for (const c of abertas) c.fechar();
    }
    await expectVagaDeVolta(`/${token.uuid}/h`, 10_000);
  });

  test('do servidor: 200 hang ao mesmo tempo em 20 URLs → no máximo 128 presas, o resto 503; as outras URLs respondem', async ({ request, tokens }) => {
    test.setTimeout(120_000);
    const urls = await Promise.all(Array.from({ length: 20 }, () => tokens.criar()));
    await Promise.all(urls.map((t) => salvarRegras(request, t.uuid, [{ name: 'presa', response: { fault: 'hang' } }])));
    const livre = await tokens.criar();

    const abertas = urls.flatMap((t) => Array.from({ length: 10 }, () => conectar(`/${t.uuid}/carga`)));
    try {
      await espera(5000);
      const recusadas = abertas.filter((c) => cabeca(c.dados())?.status === 503);
      const presas = abertas.filter(presa);
      const resumo = `presas=${presas.length} recusadas=${recusadas.length}`;
      expect(presas.length + recusadas.length, resumo).toBe(200);
      expect(presas.length, resumo).toBeLessThanOrEqual(128);
      expect(presas.length, resumo).toBeGreaterThanOrEqual(120);
      for (const c of recusadas) expect(cabeca(c.dados())!.headers['x-fault-limit']).toBe('128 held connections on this server');

      for (let i = 0; i < 10; i++) {
        const inicio = performance.now();
        const res = await request.post(`/${livre.uuid}/vivo`, { data: 'ok' });
        expect(res.status()).toBe(200);
        expect(performance.now() - inicio, `webhook nº ${i + 1} numa URL sem regra`).toBeLessThan(2000);
      }
      const inicio = performance.now();
      expect((await request.get(`/token/${livre.uuid}`, { headers: JSON_ACCEPT })).status()).toBe(200);
      expect(performance.now() - inicio).toBeLessThan(2000);
    } finally {
      for (const c of abertas) c.fechar();
    }
    await expectVagaDeVolta(`/${urls[0].uuid}/depois`, 15_000);
  });

  test('sem o cliente desistir: hang fecha no teto sem nenhum byte; stall fecha depois dos cabeçalhos', async ({ request, tokens }) => {
    test.setTimeout(TETO_MS + 120_000);
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [
      { name: 'presa', match: { path: { equals: '/h' } }, response: { fault: 'hang' } },
      { name: 'parada', match: { path: { equals: '/s' } }, response: { body: 'abc', fault: 'stall_after_headers' } },
    ]);
    const hang = conectar(`/${token.uuid}/h`);
    const stall = conectar(`/${token.uuid}/s`);
    try {
      await Promise.all([hang.ate(TETO_MS + 60_000), stall.ate(TETO_MS + 60_000)]);
      for (const c of [hang, stall]) {
        expect(c.fechouOServidor(), descrever(c)).toBe(true);
        expect(c.fechouEm()!, descrever(c)).toBeGreaterThanOrEqual(TETO_MS - 5000);
        expect(c.fechouEm()!, descrever(c)).toBeLessThan(TETO_MS + 30_000);
      }
      expect(hang.dados().length, descrever(hang)).toBe(0);
      const r = cabeca(stall.dados());
      expect(r, descrever(stall)).not.toBeNull();
      expect(r!.headers['content-length']).toBe('3');
      expect(r!.corpo.length).toBe(0);
    } finally {
      hang.fechar();
      stall.fechar();
    }
  });
});
