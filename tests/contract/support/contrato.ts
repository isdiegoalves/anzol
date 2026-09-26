import net from 'node:net';
import { test as base, expect, type APIRequestContext, type APIResponse } from '@playwright/test';

export { expect };

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8084';

/**
 * Alvo do contrato. `novo` (padrão) é o backend Kotlin; `legado` era o app Laravel, removido do
 * repositório. Só muda os testes marcados com `bugDoLegado`: no legado eles falhavam de propósito
 * (`test.fail`) porque documentam um defeito acidental; no novo, exigem o comportamento corrigido.
 */
export const ALVO = process.env.CONTRATO_ALVO ?? 'novo';

export function bugDoLegado(motivo: string): void {
  test.fail(ALVO === 'legado', motivo);
}

/** Cliente "de API": faz o Laravel responder erro em JSON em vez de HTML. */
export const JSON_ACCEPT = { Accept: 'application/json' } as const;

export const DATA_HORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CHAVES_TOKEN = [
  'uuid', 'ip', 'user_agent', 'default_content', 'default_status', 'default_content_type',
  'timeout', 'cors', 'created_at', 'updated_at',
].sort();

export const CHAVES_MENSAGEM = [
  'uuid', 'token_id', 'ip', 'hostname', 'method', 'user_agent', 'content', 'query', 'headers',
  'url', 'created_at', 'updated_at',
].sort();

export interface Token {
  uuid: string;
  ip: string;
  user_agent: string | null;
  default_content: string;
  default_status: number;
  default_content_type: string;
  timeout: number;
  cors: boolean;
  created_at: string;
  updated_at: string;
}

export interface Mensagem {
  uuid: string;
  token_id: string;
  ip: string;
  hostname: string;
  method: string;
  user_agent: string | null;
  content: string;
  query: Record<string, unknown> | null;
  headers: Record<string, string[]>;
  url: string;
  created_at: string;
  updated_at: string;
  request?: Record<string, unknown> | null;
}

export interface Listagem {
  data: Mensagem[];
  total: number;
  per_page: number;
  current_page: number;
  is_last_page: boolean;
  from: number;
  to: number;
}

export interface Tokens {
  /** Cria um token com corpo JSON e o registra para limpeza ao fim do teste. */
  criar(dados?: Record<string, unknown>): Promise<Token>;
  /** Registra para limpeza um token criado por outro caminho (formulário, query string…). */
  registrar(uuid: string): void;
}

export const test = base.extend<{ tokens: Tokens }>({
  tokens: async ({ request }, use) => {
    const criados: string[] = [];
    await use({
      async criar(dados = {}) {
        const res = await request.post('/token', { data: dados, headers: JSON_ACCEPT });
        expect(res.status(), await res.text()).toBe(201);
        const token = (await res.json()) as Token;
        criados.push(token.uuid);
        return token;
      },
      registrar(uuid) {
        criados.push(uuid);
      },
    });
    // Limpa só o que o teste criou. As mensagens vão antes: no app atual o DELETE do token
    // não apaga a hash de mensagens, e depois dele a API já responde 410.
    for (const uuid of criados) {
      await request.delete(`/token/${uuid}/request`, { headers: JSON_ACCEPT });
      await request.delete(`/token/${uuid}`, { headers: JSON_ACCEPT });
    }
  },
});

/** Compara Content-Type pelo significado: tipo e parâmetros, sem caixa e sem depender de espaço. */
export function tipoDeMidia(valor: string): { tipo: string; parametros: Record<string, string> } {
  const [tipo, ...partes] = valor.split(';');
  const parametros: Record<string, string> = {};
  for (const parte of partes) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim().toLowerCase();
    parametros[nome] = parte.slice(i + 1).trim().replace(/^"(.*)"$/, '$1').toLowerCase();
  }
  return { tipo: tipo.trim().toLowerCase(), parametros };
}

export function expectContentType(res: APIResponse, esperado: string): void {
  const recebido = res.headers()['content-type'];
  expect(recebido, `Content-Type esperado: ${esperado}`).toBeDefined();
  expect(tipoDeMidia(recebido!)).toEqual(tipoDeMidia(esperado));
}

/** Envelope de erro para cliente JSON. Campos de depuração (exception, trace, file, line) ficam fora. */
export async function expectErroJson(res: APIResponse, status: number, mensagem: string): Promise<void> {
  expect(res.status()).toBe(status);
  expectContentType(res, 'application/json');
  const corpo = await res.json();
  expect(corpo.success).toBe(false);
  expect(corpo.error.message).toBe(mensagem);
  expect(corpo.error).toHaveProperty('id', null);
}

/** Datas do app: `YYYY-MM-DD HH:MM:SS` em UTC, próximas do cabeçalho Date da resposta. */
export function expectDataUtcRecente(valor: string, res: APIResponse): void {
  expect(valor).toMatch(DATA_HORA);
  const data = Date.parse(valor.replace(' ', 'T') + 'Z');
  const agora = Date.parse(res.headers()['date'] ?? new Date().toUTCString());
  expect(Math.abs(agora - data)).toBeLessThanOrEqual(15_000);
}

export async function buscarMensagem(request: APIRequestContext, tokenId: string, id: string): Promise<Mensagem> {
  const res = await request.get(`/token/${tokenId}/request/${id}`, { headers: JSON_ACCEPT });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Mensagem;
}

export async function listar(request: APIRequestContext, tokenId: string, query = ''): Promise<Listagem> {
  const res = await request.get(`/token/${tokenId}/requests${query ? `?${query}` : ''}`, { headers: JSON_ACCEPT });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Listagem;
}

/** Dispara o webhook e devolve a mensagem gravada (pelo X-Request-Id). */
export async function enviarEGuardar(
  request: APIRequestContext,
  tokenId: string,
  caminho = '',
  opcoes: Parameters<APIRequestContext['fetch']>[1] = {},
): Promise<{ res: APIResponse; msg: Mensagem }> {
  const res = await request.fetch(`/${tokenId}${caminho}`, opcoes);
  const id = res.headers()['x-request-id'];
  expect(id, `sem X-Request-Id (status ${res.status()})`).toMatch(UUID);
  return { res, msg: await buscarMensagem(request, tokenId, id!) };
}

export interface RespostaCrua {
  status: number;
  headers: Record<string, string>;
}

/**
 * HTTP/1.1 escrito à mão, para o que um cliente HTTP comum não deixa fazer: repetir um
 * cabeçalho em linhas separadas, omitir User-Agent, mandar cabeçalho vazio.
 */
export function httpCru(linhas: string[], corpo = ''): Promise<RespostaCrua> {
  const url = new URL(BASE_URL);
  const porta = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const pedido = [...linhas, `Host: ${url.host}`, 'Connection: close', '', corpo].join('\r\n');
  return new Promise((resolve, reject) => {
    const socket = net.connect(porta, url.hostname, () => socket.write(pedido));
    let bruto = '';
    socket.setEncoding('latin1');
    socket.on('data', (parte) => { bruto += parte; });
    socket.on('error', reject);
    socket.setTimeout(20_000, () => socket.destroy(new Error('timeout no HTTP cru')));
    socket.on('close', () => {
      const [cabeca] = bruto.split('\r\n\r\n');
      const [linhaStatus, ...linhasCabecalho] = cabeca.split('\r\n');
      const headers: Record<string, string> = {};
      for (const linha of linhasCabecalho) {
        const i = linha.indexOf(':');
        headers[linha.slice(0, i).trim().toLowerCase()] = linha.slice(i + 1).trim();
      }
      resolve({ status: Number(linhaStatus.split(' ')[1]), headers });
    });
  });
}

export function espera(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
