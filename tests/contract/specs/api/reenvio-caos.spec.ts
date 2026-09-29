import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { enviarEGuardar, espera, expect, type Mensagem } from '../../support/contrato.js';
import { test as testMcp, textoDo } from '../../support/mcp.js';
import {
  ALVO_HOST, chamarReplay, expect422, expectErroDeSaida, historico, replay, resultadoOk,
  type CaosNoResultado, type ResultadoDeSaida,
} from '../../support/reenvio.js';

interface Chegada {
  /** `performance.now()` quando os cabeçalhos chegaram. */
  ms: number;
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  corpo: Buffer;
  /** `performance.now()` quando o corpo terminou de chegar. */
  corpoFim: number;
  /** `performance.now()` quando a resposta saiu; ausente se não saiu. */
  respondeuEm?: number;
  /** A conexão fechou antes de a resposta sair. */
  fechouAntesDeResponder: boolean;
}

interface Resposta {
  status?: number;
  atraso?: number;
  corpo?: string;
}

interface Alvo {
  url: string;
  chegadas: Chegada[];
}

interface ConexaoCrua {
  bytes: Buffer;
  fechou: boolean;
}

interface AlvoCru {
  url: string;
  conexoes: ConexaoCrua[];
}

interface Alvos {
  /** Servidor HTTP no host; `resposta(i)` decide a resposta da i-ésima requisição (a partir de 0). */
  http(resposta?: (i: number) => Resposta): Promise<Alvo>;
  /** Servidor TCP que só lê: guarda os bytes de cada conexão e nunca responde. */
  cru(): Promise<AlvoCru>;
}

const test = testMcp.extend<{ alvos: Alvos }>({
  // eslint-disable-next-line no-empty-pattern
  alvos: async ({}, use) => {
    const servidores: Array<http.Server | net.Server> = [];
    const sockets: net.Socket[] = [];
    const escutar = async (servidor: http.Server | net.Server): Promise<number> => {
      servidores.push(servidor);
      await new Promise<void>((ok) => servidor.listen(0, '0.0.0.0', ok));
      return (servidor.address() as AddressInfo).port;
    };
    await use({
      async http(resposta = () => ({})) {
        const chegadas: Chegada[] = [];
        const servidor = http.createServer((req, res) => {
          const i = chegadas.length;
          const chegada: Chegada = {
            ms: performance.now(), method: req.method ?? '', url: req.url ?? '', headers: req.headers,
            corpo: Buffer.alloc(0), corpoFim: 0, fechouAntesDeResponder: false,
          };
          chegadas.push(chegada);
          const partes: Buffer[] = [];
          req.on('data', (p: Buffer) => partes.push(p));
          res.on('close', () => {
            if (chegada.respondeuEm === undefined) chegada.fechouAntesDeResponder = true;
          });
          req.on('end', () => {
            chegada.corpo = Buffer.concat(partes);
            chegada.corpoFim = performance.now();
            const r = resposta(i);
            setTimeout(() => {
              if (res.destroyed) return;
              res.writeHead(r.status ?? 201, { 'Content-Type': 'application/json' });
              res.end(r.corpo ?? '{"recebido":true}', () => { chegada.respondeuEm = performance.now(); });
            }, r.atraso ?? 0);
          });
        });
        const porta = await escutar(servidor);
        return { url: `http://${ALVO_HOST}:${porta}`, chegadas };
      },
      async cru() {
        const conexoes: ConexaoCrua[] = [];
        const servidor = net.createServer((socket) => {
          sockets.push(socket);
          const conexao: ConexaoCrua = { bytes: Buffer.alloc(0), fechou: false };
          conexoes.push(conexao);
          socket.on('data', (p: Buffer) => { conexao.bytes = Buffer.concat([conexao.bytes, p]); });
          socket.on('error', () => undefined);
          socket.on('close', () => { conexao.fechou = true; });
        });
        const porta = await escutar(servidor);
        return { url: `http://${ALVO_HOST}:${porta}`, conexoes };
      },
    });
    for (const s of sockets) s.destroy();
    for (const s of servidores) {
      if (s instanceof http.Server) s.closeAllConnections();
      await new Promise<void>((ok) => s.close(() => ok()));
    }
  },
});

const JSON_CT = { 'Content-Type': 'application/json', 'X-Custom': 'caos' };
const CORPO = '{"pedido":42,"ok":true}';
const BLOQUEADO = 'http://169.254.169.254/latest';

const SEM_CAOS: CaosNoResultado = {
  delay_ms: 0, duplicate: false, abort_mid_body: false, slow_body_bps: null, timeout_ms: null,
  injected: [], body_bytes_sent: null, duplicate_result: null,
};

async function mensagem(request: APIRequestContext, tokenId: string, corpo = CORPO): Promise<Mensagem> {
  return (await enviarEGuardar(request, tokenId, '/pedidos', { method: 'POST', headers: JSON_CT, data: Buffer.from(corpo) })).msg;
}

function retryAfter(res: APIResponse): string | undefined {
  return res.headers()['retry-after'];
}

/** Com janela por minuto de relógio, 31 chamadas perto da virada cairiam em dois minutos: espera a virada. */
async function longeDaViradaDoMinuto(): Promise<void> {
  const segundos = new Date().getSeconds();
  if (segundos >= 40) await espera((61 - segundos) * 1_000);
}

test.describe('replay sem caos', () => {
  test('sem chaos, ou com chaos null, o resultado não tem a chave chaos', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const msg = await mensagem(request, t);
    const r = await replay(request, t, msg.uuid, { url: alvo.url });
    expect('chaos' in r, JSON.stringify(r).slice(0, 300)).toBe(false);
    const nulo = await resultadoOk(await chamarReplay(request, t, msg.uuid, { url: alvo.url, chaos: null }), 'chaos null');
    expect('chaos' in nulo).toBe(false);
    expect(alvo.chegadas).toHaveLength(2);
  });
});

test.describe('replay com caos', () => {
  test('chaos {} → eco com os padrões e nada injetado', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const msg = await mensagem(request, t);
    const r = await replay(request, t, msg.uuid, { url: alvo.url, chaos: {} });
    expect(r.chaos).toEqual(SEM_CAOS);
    expect(r.status).toBe(201);
    expect(alvo.chegadas).toHaveLength(1);
  });

  test('delay_ms: espera antes de sair; duration_ms mede só a troca com o app', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const msg = await mensagem(request, t);
    const inicio = performance.now();
    const r = await replay(request, t, msg.uuid, { url: alvo.url, chaos: { delay_ms: 1500 } });
    const total = performance.now() - inicio;
    expect(r.chaos).toEqual({ ...SEM_CAOS, delay_ms: 1500, injected: ['delay_ms'] });
    expect(r.status).toBe(201);
    expect(total).toBeGreaterThanOrEqual(1480);
    expect(alvo.chegadas[0].ms - inicio).toBeGreaterThanOrEqual(1480);
    expect(r.duration_ms).toBeLessThan(1000);
  });

  test('duplicate: a mesma requisição chega duas vezes, a segunda depois da resposta da primeira; o resultado traz as duas', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http((i) => (i === 0 ? { status: 201, atraso: 300 } : { status: 409 }));
    const msg = await mensagem(request, t);
    const r = await replay(request, t, msg.uuid, { url: alvo.url, chaos: { duplicate: true } });

    expect(alvo.chegadas).toHaveLength(2);
    const [primeira, segunda] = alvo.chegadas;
    expect(segunda.method).toBe(primeira.method);
    expect(segunda.url).toBe(primeira.url);
    expect(segunda.corpo.toString()).toBe(CORPO);
    expect(primeira.corpo.toString()).toBe(CORPO);
    for (const nome of ['content-type', 'content-length', 'x-custom']) expect(segunda.headers[nome], nome).toBe(primeira.headers[nome]);
    expect(segunda.ms).toBeGreaterThanOrEqual(primeira.respondeuEm!);

    expect(r.status).toBe(201);
    expect(r.chaos).toMatchObject({ duplicate: true, injected: ['duplicate'], body_bytes_sent: null });
    expect(r.chaos!.duplicate_result).toMatchObject({ status: 409, error: null });
    expect(Number.isInteger(r.chaos!.duplicate_result!.duration_ms)).toBe(true);
  });

  test('abort_mid_body: cabeçalhos com o Content-Length inteiro, metade do corpo e a conexão fecha; sem status nem error', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const cru = await alvos.cru();
    const msg = await mensagem(request, t);
    const n = Buffer.byteLength(CORPO);
    const inicio = performance.now();
    const r = await replay(request, t, msg.uuid, { url: cru.url, keep_path: false, chaos: { abort_mid_body: true } });

    expect(performance.now() - inicio).toBeLessThan(5000);
    expect(r.chaos).toEqual({ ...SEM_CAOS, abort_mid_body: true, injected: ['abort_mid_body'], body_bytes_sent: Math.floor(n / 2) });
    expect(r.status ?? null).toBeNull();
    expect(r.error ?? null).toBeNull();

    await expect.poll(() => cru.conexoes.length).toBe(1);
    await expect.poll(() => cru.conexoes[0].fechou).toBe(true);
    const recebido = cru.conexoes[0].bytes.toString('latin1');
    const fim = recebido.indexOf('\r\n\r\n');
    expect(fim, recebido.slice(0, 300)).toBeGreaterThan(0);
    expect(recebido.slice(0, fim)).toMatch(new RegExp(`\r\ncontent-length: ${n}(\r\n|$)`, 'i'));
    expect(recebido.slice(fim + 4)).toBe(CORPO.slice(0, Math.floor(n / 2)));
  });

  test('abort_mid_body numa mensagem sem corpo → 422 em "chaos.abort_mid_body"', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const { msg } = await enviarEGuardar(request, t, '/vazio', { method: 'GET' });
    const erros = await expect422(
      await chamarReplay(request, t, msg.uuid, { url: alvo.url, chaos: { abort_mid_body: true } }),
      /^chaos\.abort_mid_body$/, 'abort sem corpo',
    );
    expect(erros).toEqual({ 'chaos.abort_mid_body': ['The abort mid body field requires a request body.'] });
    expect(alvo.chegadas).toHaveLength(0);
  });

  test('slow_body_bps: o corpo chega inteiro, na taxa pedida', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const corpo = 'x'.repeat(200);
    const msg = await mensagem(request, t, corpo);
    const r = await replay(request, t, msg.uuid, { url: alvo.url, chaos: { slow_body_bps: 100 } });

    expect(r.chaos).toEqual({ ...SEM_CAOS, slow_body_bps: 100, injected: ['slow_body_bps'] });
    expect(r.status).toBe(201);
    const [chegada] = alvo.chegadas;
    expect(chegada.corpo.toString()).toBe(corpo);
    expect(chegada.headers['content-length']).toBe('200');
    expect(chegada.corpoFim - chegada.ms, 'duzentos bytes a 100 B/s').toBeGreaterThanOrEqual(1500);
  });

  test('timeout_ms: desiste do app que demora e fecha a conexão; sem status nem error', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http(() => ({ status: 201, atraso: 3000 }));
    const msg = await mensagem(request, t);
    const inicio = performance.now();
    const r = await replay(request, t, msg.uuid, { url: alvo.url, chaos: { timeout_ms: 500 } });

    expect(performance.now() - inicio).toBeLessThan(2500);
    expect(r.chaos).toEqual({ ...SEM_CAOS, timeout_ms: 500, injected: ['timeout_ms'] });
    expect(r.status ?? null).toBeNull();
    expect(r.error ?? null).toBeNull();
    await expect.poll(() => alvo.chegadas[0]?.fechouAntesDeResponder, { timeout: 2500 }).toBe(true);
  });

  test('timeout_ms não dispara quando o app responde antes', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const msg = await mensagem(request, t);
    const r = await replay(request, t, msg.uuid, { url: alvo.url, chaos: { timeout_ms: 5000 } });
    expect(r.chaos).toEqual({ ...SEM_CAOS, timeout_ms: 5000 });
    expect(r.status).toBe(201);
  });

  test('injected segue a ordem fixa: delay_ms antes de duplicate', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const msg = await mensagem(request, t);
    const r = await replay(request, t, msg.uuid, { url: alvo.url, chaos: { duplicate: true, delay_ms: 300 } });
    expect(r.chaos?.injected).toEqual(['delay_ms', 'duplicate']);
    expect(alvo.chegadas).toHaveLength(2);
  });

  test('o histórico guarda o resultado com o chaos, numa entrada só', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const msg = await mensagem(request, t);
    const r = await replay(request, t, msg.uuid, { url: alvo.url, chaos: { delay_ms: 100, duplicate: true } });
    expect(r.chaos?.injected).toEqual(['delay_ms', 'duplicate']);
    expect(await historico(request, t)).toEqual([r]);
  });
});

test.describe('replay com caos: validação', () => {
  test('entradas inválidas → 422 com a chave e a mensagem; nada sai e nada entra no histórico', async ({ request, tokens, alvos }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const msg = await mensagem(request, t);
    const casos: Array<[Record<string, unknown>, string, string]> = [
      [{ chaos: 'x' }, 'chaos', 'The chaos must be an object.'],
      [{ chaos: 1 }, 'chaos', 'The chaos must be an object.'],
      [{ chaos: [] }, 'chaos', 'The chaos must be an object.'],
      [{ chaos: true }, 'chaos', 'The chaos must be an object.'],
      [{ chaos: { delay_ms: -1 } }, 'chaos.delay_ms', 'The delay ms must be between 0 and 30000.'],
      [{ chaos: { delay_ms: 30_001 } }, 'chaos.delay_ms', 'The delay ms must be between 0 and 30000.'],
      [{ chaos: { delay_ms: 1.5 } }, 'chaos.delay_ms', 'The delay ms must be an integer.'],
      [{ chaos: { delay_ms: '10' } }, 'chaos.delay_ms', 'The delay ms must be an integer.'],
      [{ chaos: { delay_ms: true } }, 'chaos.delay_ms', 'The delay ms must be an integer.'],
      [{ chaos: { duplicate: 'sim' } }, 'chaos.duplicate', 'The duplicate field must be true or false.'],
      [{ chaos: { duplicate: 1 } }, 'chaos.duplicate', 'The duplicate field must be true or false.'],
      [{ chaos: { abort_mid_body: 'sim' } }, 'chaos.abort_mid_body', 'The abort mid body field must be true or false.'],
      [{ chaos: { slow_body_bps: 0 } }, 'chaos.slow_body_bps', 'The slow body bps must be between 1 and 1048576.'],
      [{ chaos: { slow_body_bps: 1_048_577 } }, 'chaos.slow_body_bps', 'The slow body bps must be between 1 and 1048576.'],
      [{ chaos: { slow_body_bps: '100' } }, 'chaos.slow_body_bps', 'The slow body bps must be an integer.'],
      [{ chaos: { timeout_ms: 0 } }, 'chaos.timeout_ms', 'The timeout ms must be between 1 and 30000.'],
      [{ chaos: { timeout_ms: 30_001 } }, 'chaos.timeout_ms', 'The timeout ms must be between 1 and 30000.'],
      [{ chaos: { timeout_ms: '500' } }, 'chaos.timeout_ms', 'The timeout ms must be an integer.'],
      [{ timeout: 5000, chaos: { timeout_ms: 5000 } }, 'chaos.timeout_ms', 'The timeout ms must be less than the timeout.'],
      [{ chaos: { timeout_ms: 10_000 } }, 'chaos.timeout_ms', 'The timeout ms must be less than the timeout.'],
      [{ chaos: { drop: 10 } }, 'chaos.drop', 'The drop option is not supported.'],
    ];
    for (const [extra, chave, mensagem] of casos) {
      const descricao = JSON.stringify(extra);
      const erros = await expect422(
        await chamarReplay(request, t, msg.uuid, { url: alvo.url, ...extra }),
        new RegExp(`^${chave.replace('.', '\\.')}$`), descricao,
      );
      expect(erros, descricao).toEqual({ [chave]: [mensagem] });
    }
    expect(alvo.chegadas).toHaveLength(0);
    expect(await historico(request, t)).toEqual([]);
  });
});

test.describe('replay com caos: limites e segurança', () => {
  test('destino bloqueado: error blocked e nada injetado, nem o atraso', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const msg = await mensagem(request, t);
    const inicio = performance.now();
    const r = await replay(request, t, msg.uuid, { url: BLOQUEADO, keep_path: false, chaos: { delay_ms: 3000, duplicate: true } });
    expectErroDeSaida(r, 'blocked');
    expect(r.chaos).toEqual({ ...SEM_CAOS, delay_ms: 3000, duplicate: true });
    expect(performance.now() - inicio).toBeLessThan(2500);
  });

  test('30 replays com duplicate por minuto contam 30; o 31º → 429 e nada sai', async ({ request, tokens, alvos }) => {
    test.setTimeout(120_000);
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const msg = await mensagem(request, t);
    await longeDaViradaDoMinuto();
    for (let i = 0; i < 30; i++) {
      const r = await replay(request, t, msg.uuid, { url: alvo.url, chaos: { duplicate: true } });
      expect(r.chaos?.injected, `replay nº ${i + 1}`).toEqual(['duplicate']);
    }
    expect(alvo.chegadas).toHaveLength(60);
    const res = await chamarReplay(request, t, msg.uuid, { url: alvo.url, chaos: { duplicate: true } });
    expect(res.status()).toBe(429);
    expect(retryAfter(res)).toMatch(/^\d+$/);
    expect(alvo.chegadas).toHaveLength(60);
  });
});

test.describe('MCP replay_request', () => {
  test('declara chaos no inputSchema, injeta e relata; erro de validação vem como isError com o texto do 422', async ({ request, tokens, alvos, mcp }) => {
    const t = (await tokens.criar()).uuid;
    const alvo = await alvos.http();
    const msg = await mensagem(request, t);

    const propriedades = mcp.ferramentas.get('replay_request')!.inputSchema.properties as Record<string, { type?: string; properties?: Record<string, { type?: string }> }>;
    const chaos = propriedades.chaos;
    expect(chaos?.type, JSON.stringify(propriedades)).toBe('object');
    expect(Object.fromEntries(Object.entries(chaos.properties ?? {}).map(([nome, p]) => [nome, p.type]))).toEqual({
      delay_ms: 'integer', duplicate: 'boolean', abort_mid_body: 'boolean', slow_body_bps: 'integer', timeout_ms: 'integer',
    });

    const r = await mcp.chamarOk<ResultadoDeSaida>('replay_request', { request_id: msg.uuid, url: alvo.url, chaos: { duplicate: true } }, t);
    expect(r.chaos?.injected).toEqual(['duplicate']);
    expect(alvo.chegadas).toHaveLength(2);

    const ruim = await mcp.chamar('replay_request', { request_id: msg.uuid, url: alvo.url, chaos: { delay_ms: -1 } }, t);
    expect(ruim.isError, textoDo(ruim).slice(0, 300)).toBe(true);
    expect(textoDo(ruim)).toContain('The delay ms must be between 0 and 30000.');
    expect(alvo.chegadas).toHaveLength(2);
  });
});
