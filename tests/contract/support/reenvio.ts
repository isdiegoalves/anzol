import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BASE_URL, JSON_ACCEPT, expect, expectContentType, test as base } from './contrato.js';

// Reenvio pelo servidor e envio pela tela (§1 do plano "reenvio-servidor"): o servidor sai com uma
// requisição por `POST /token/{id}/request/{rid}/replay` e `POST /token/{id}/send`, devolve o resultado
// e o grava no histórico da URL (`GET /token/{id}/outbound`, mais novo primeiro, últimas 50).
//
// O app roda em container. O teste sobe um receptor HTTP no host, numa porta livre, e passa ao app o
// alvo `http://{ALVO_HOST}:{porta}`. `ALVO_HOST` é o nome pelo qual o container alcança o host.

/** Nome pelo qual o app (no container) alcança o host onde o receptor escuta. */
export const ALVO_HOST = process.env.ALVO_HOST ?? 'host.docker.internal';

/**
 * O `anzol.outbound.localhost-alias` do app sob teste: `localhost` e `127.0.0.1` no alvo viram esse nome.
 * O `./ci.sh` sobe o stack com `ANZOL_OUTBOUND_LOCALHOST_ALIAS=host.docker.internal`.
 */
export const ALIAS_LOCALHOST = process.env.ALIAS_LOCALHOST ?? 'host.docker.internal';

/** URL base do próprio Anzol vista de dentro do container: o host, na porta publicada do `BASE_URL`. */
export const APP_PELO_ALVO = process.env.APP_PELO_ALVO ?? `http://${ALVO_HOST}:${new URL(BASE_URL).port || '80'}`;

/** Headers que o replay não repassa (§1), por nome exato ou prefixo (`proxy-`, `x-forwarded-`, `cf-`). */
export const HEADERS_FILTRADOS = ['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade', 'te', 'trailer', 'x-real-ip'];
export const PREFIXOS_FILTRADOS = ['proxy-', 'x-forwarded-', 'cf-'];

export function filtrado(nome: string): boolean {
  const n = nome.toLowerCase();
  return HEADERS_FILTRADOS.includes(n) || PREFIXOS_FILTRADOS.some((p) => n.startsWith(p));
}

export type Cabecalhos = Record<string, string | string[]>;

export interface ErroDeSaida {
  kind: 'blocked' | 'dns' | 'connect' | 'timeout' | 'tls' | 'invalid_url';
  message: string;
}

/** Resultado de um replay ou send, como a chamada devolve e o histórico guarda. */
export interface ResultadoDeSaida {
  id: string;
  kind: 'replay' | 'send';
  at: string;
  /** URL efetiva (com o caminho e a query da mensagem no replay com `keep_path`). */
  target: string;
  method: string;
  request_headers: Cabecalhos;
  status?: number | null;
  headers?: Cabecalhos | null;
  body?: string | null;
  truncated?: boolean | null;
  duration_ms: number;
  error?: ErroDeSaida | null;
  /** Só no replay: o uuid da mensagem reenviada. */
  source_request?: string | null;
  /** Só no replay pedido com `chaos`. */
  chaos?: CaosNoResultado;
}

/** O `chaos` do pedido de replay. */
export interface Caos {
  delay_ms?: number;
  duplicate?: boolean;
  abort_mid_body?: boolean;
  slow_body_bps?: number;
  timeout_ms?: number;
}

export type Injetado = 'delay_ms' | 'slow_body_bps' | 'abort_mid_body' | 'timeout_ms' | 'duplicate';

export interface CaosNoResultado {
  delay_ms: number;
  duplicate: boolean;
  abort_mid_body: boolean;
  slow_body_bps: number | null;
  timeout_ms: number | null;
  injected: Injetado[];
  body_bytes_sent: number | null;
  duplicate_result: { status: number | null; duration_ms: number; error: ErroDeSaida | null } | null;
}

/** Sem resposta lida porque o próprio caos cortou o corpo ou desistiu de esperar. */
function semRespostaPorCaos(r: ResultadoDeSaida): boolean {
  const injetado = r.chaos?.injected ?? [];
  return injetado.includes('abort_mid_body') || injetado.includes('timeout_ms');
}

/** Valor de um header sem distinção de caixa no nome; lista vira o último valor (como a mensagem gravada). */
export function valorDoHeader(headers: Cabecalhos | null | undefined, nome: string): string | undefined {
  if (!headers) return undefined;
  const chave = Object.keys(headers).find((k) => k.toLowerCase() === nome.toLowerCase());
  if (chave === undefined) return undefined;
  const v = headers[chave];
  return Array.isArray(v) ? v[v.length - 1] : v;
}

export function nomesDosHeaders(headers: Cabecalhos | null | undefined): string[] {
  return Object.keys(headers ?? {}).map((k) => k.toLowerCase());
}

// --- Chamadas à API ------------------------------------------------------------------------------

export function chamarReplay(request: APIRequestContext, tokenId: string, rid: string, corpo: unknown): Promise<APIResponse> {
  return request.post(`/token/${tokenId}/request/${rid}/replay`, { data: corpo as object, headers: JSON_ACCEPT, timeout: 60_000 });
}

export function chamarSend(request: APIRequestContext, tokenId: string, corpo: unknown): Promise<APIResponse> {
  return request.post(`/token/${tokenId}/send`, { data: corpo as object, headers: JSON_ACCEPT, timeout: 60_000 });
}

export function chamarHistorico(request: APIRequestContext, tokenId: string): Promise<APIResponse> {
  return request.get(`/token/${tokenId}/outbound`, { headers: JSON_ACCEPT });
}

/** Exige 200 JSON e a forma do resultado; devolve o resultado. */
export async function resultadoOk(res: APIResponse, descricao: string): Promise<ResultadoDeSaida> {
  expect(res.status(), `${descricao}: ${(await res.text()).slice(0, 500)}`).toBe(200);
  expectContentType(res, 'application/json');
  const r = (await res.json()) as ResultadoDeSaida;
  expectFormaDoResultado(r);
  return r;
}

export async function replay(
  request: APIRequestContext,
  tokenId: string,
  rid: string,
  corpo: { url: string; keep_path?: boolean; timeout?: number; chaos?: Caos },
): Promise<ResultadoDeSaida> {
  return resultadoOk(await chamarReplay(request, tokenId, rid, corpo), `replay ${JSON.stringify(corpo)}`);
}

export interface PedidoDeEnvio {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  sign?: boolean;
  timeout?: number;
}

export async function send(request: APIRequestContext, tokenId: string, corpo: PedidoDeEnvio): Promise<ResultadoDeSaida> {
  const descricao = `send ${JSON.stringify({ ...corpo, body: corpo.body?.slice(0, 80) })}`;
  return resultadoOk(await chamarSend(request, tokenId, corpo), descricao);
}

export async function historico(request: APIRequestContext, tokenId: string): Promise<ResultadoDeSaida[]> {
  const res = await chamarHistorico(request, tokenId);
  expect(res.status(), `GET /token/{id}/outbound: ${(await res.text()).slice(0, 500)}`).toBe(200);
  expectContentType(res, 'application/json');
  const lista = (await res.json()) as ResultadoDeSaida[];
  expect(Array.isArray(lista), `o histórico é uma lista: ${JSON.stringify(lista).slice(0, 200)}`).toBe(true);
  for (const r of lista) expectFormaDoResultado(r);
  return lista;
}

/**
 * Forma comum aos dois: `id` e `at` textos não vazios, `kind`, `target`, `method`, `request_headers`
 * objeto, `duration_ms` inteiro ≥ 0; com `error`, sem `status`; sem `error`, `status` inteiro, menos quando o caos
 * cortou o corpo ou desistiu (sem `status` e sem `error`).
 */
export function expectFormaDoResultado(r: ResultadoDeSaida): void {
  const d = JSON.stringify(r).slice(0, 400);
  expect(typeof r.id === 'string' && r.id.length > 0, `id: ${d}`).toBe(true);
  expect(['replay', 'send'], `kind: ${d}`).toContain(r.kind);
  expect(typeof r.at === 'string' && r.at.length > 0, `at: ${d}`).toBe(true);
  expect(typeof r.target, `target: ${d}`).toBe('string');
  expect(typeof r.method, `method: ${d}`).toBe('string');
  expect(typeof r.request_headers === 'object' && r.request_headers !== null && !Array.isArray(r.request_headers), `request_headers: ${d}`).toBe(true);
  expect(Number.isInteger(r.duration_ms) && r.duration_ms >= 0, `duration_ms: ${d}`).toBe(true);
  if (r.error) {
    expect(typeof r.error.kind, `error.kind: ${d}`).toBe('string');
    expect(typeof r.error.message, `error.message: ${d}`).toBe('string');
    expect(r.status ?? null, `com error não há status: ${d}`).toBeNull();
  } else if (semRespostaPorCaos(r)) {
    expect(r.status ?? null, `sem resposta lida não há status: ${d}`).toBeNull();
  } else {
    expect(Number.isInteger(r.status), `status: ${d}`).toBe(true);
  }
}

/** 200 com `error.kind` = `kind` e sem resposta do alvo. */
export function expectErroDeSaida(r: ResultadoDeSaida, kind: ErroDeSaida['kind'] | Array<ErroDeSaida['kind']>): void {
  const d = JSON.stringify(r).slice(0, 400);
  expect(r.error ?? null, `esperava error: ${d}`).not.toBeNull();
  if (Array.isArray(kind)) expect(kind, d).toContain(r.error!.kind);
  else expect(r.error!.kind, d).toBe(kind);
  expect(r.status ?? null, d).toBeNull();
}

/** 422 JSON `{chave: [mensagem]}` com alguma chave casando `chave`. */
export async function expect422(res: APIResponse, chave: RegExp, descricao: string): Promise<Record<string, string[]>> {
  const texto = await res.text();
  expect(res.status(), `${descricao}: ${texto.slice(0, 300)}`).toBe(422);
  expectContentType(res, 'application/json');
  const erros = JSON.parse(texto) as Record<string, string[]>;
  const chaves = Object.keys(erros);
  expect(chaves.some((k) => chave.test(k)), `${descricao}: nenhuma chave de ${texto.slice(0, 300)} casa ${chave}`).toBe(true);
  for (const k of chaves) {
    expect(Array.isArray(erros[k]) && erros[k].length > 0, `${descricao}: ${k} → ${JSON.stringify(erros[k])}`).toBe(true);
    for (const msg of erros[k]) expect(msg, `${descricao}: ${k}`).toMatch(/^[A-Z].*\.$/s);
  }
  return erros;
}

// --- Receptor ------------------------------------------------------------------------------------

export interface Recebida {
  method: string;
  /** Alvo cru da linha de requisição: caminho e query. */
  url: string;
  /** Nomes em minúsculas; repetidos juntados pelo Node. */
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface RespostaDoReceptor {
  status?: number;
  headers?: Record<string, string>;
  body?: Buffer | string;
  /** Espera antes de responder, em ms. */
  atraso?: number;
}

export interface Receptor {
  /** `http://{ALVO_HOST}:{porta}`, sem barra final. */
  url: string;
  porta: number;
  recebidas: Recebida[];
  /** Troca a resposta das próximas requisições. */
  responder(resposta: RespostaDoReceptor): void;
}

async function subirReceptor(resposta: RespostaDoReceptor, servidores: http.Server[]): Promise<Receptor> {
  const recebidas: Recebida[] = [];
  let atual = resposta;
  const servidor = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => partes.push(p));
    req.on('end', () => {
      recebidas.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(partes) });
      const r = atual;
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(r.status ?? 200, r.headers ?? {});
        res.end(r.body ?? '');
      }, r.atraso ?? 0);
    });
  });
  servidores.push(servidor);
  await new Promise<void>((ok) => servidor.listen(0, '0.0.0.0', ok));
  const porta = (servidor.address() as AddressInfo).port;
  return {
    url: `http://${ALVO_HOST}:${porta}`,
    porta,
    recebidas,
    responder(nova) {
      atual = nova;
    },
  };
}

export interface Receptores {
  /** Sobe um receptor numa porta livre do host; fecha ao fim do teste. */
  subir(resposta?: RespostaDoReceptor): Promise<Receptor>;
}

/** `test` do contrato (com `tokens`) mais `receptores`, que fecha todos os servidores ao fim. */
export const test = base.extend<{ receptores: Receptores }>({
  // eslint-disable-next-line no-empty-pattern
  receptores: async ({}, use) => {
    const servidores: http.Server[] = [];
    await use({ subir: (resposta = {}) => subirReceptor(resposta, servidores) });
    for (const s of servidores) {
      s.closeAllConnections();
      await new Promise<void>((ok) => s.close(() => ok()));
    }
  },
});
