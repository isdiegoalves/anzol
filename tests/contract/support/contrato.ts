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

/**
 * Entrada que o app Laravel aceitava e o Tomcat do app novo recusa com 400 antes de chegar ao
 * código. Com `CONTRATO_ALVO=novo` o teste é marcado `test.fail` até o dono decidir se o backend
 * passa a aceitar (e a marcação sai) ou se o caso vira exclusão.
 */
export function limiteDoTomcat(): void {
  test.fail(ALVO === 'novo', 'limite do Tomcat, ver relatório');
}

/** Cliente "de API": faz o Laravel responder erro em JSON em vez de HTML. */
export const JSON_ACCEPT = { Accept: 'application/json' } as const;

export const DATA_HORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CHAVES_TOKEN = [
  'uuid', 'ip', 'user_agent', 'default_content', 'default_status', 'default_content_type',
  'timeout', 'cors', 'created_at', 'updated_at', 'retry_after', 'auto_cleanup',
].sort();

export const CHAVES_MENSAGEM = [
  'uuid', 'token_id', 'ip', 'hostname', 'method', 'user_agent', 'content', 'query', 'headers',
  'url', 'created_at', 'updated_at', 'seq', 'rule', 'near_miss',
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
  /** Segundos (número) ou data HTTP IMF-fixdate (string); `null` = sem `Retry-After`. */
  retry_after: number | string | null;
  /** Mantém só as N mais recentes (500, 1000, 5000 ou 10000); `null` = teto do servidor. */
  auto_cleanup: number | null;
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
  /** Inteiro ≥ 1, estritamente crescente por URL na ordem de gravação; nunca reaproveitado. */
  seq: number;
  /** Regra de resposta que respondeu (`{id, name}`), ou `null` quando nenhuma casou. */
  rule: { id: string; name: string } | null;
  /**
   * Com regras ativas e nenhuma casando: a mais próxima (menos condições falhando, empate pela
   * prioridade) e as condições que falharam. `null` quando uma regra casou ou não há regra ativa.
   */
  near_miss: { id: string; name: string; failed: string[] } | null;
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
    // Limpa só o que o teste criou. As mensagens vão antes: no app Laravel o DELETE do token
    // não apagava a hash de mensagens, e depois dele a API já responde 410.
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
 * cabeçalho em linhas separadas, omitir User-Agent, mandar cabeçalho vazio, caractere cru no
 * alvo (`"`, `\`, `#`), corpo chunked, outro `Host`.
 */
export function httpCru(linhas: string[], corpo = '', host = new URL(BASE_URL).host): Promise<RespostaCrua> {
  const url = new URL(BASE_URL);
  const porta = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const pedido = [...linhas, `Host: ${host}`, 'Connection: close', '', corpo].join('\r\n');
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

/**
 * Dispara `quantidade` webhooks em lotes de `paralelas` simultâneas e devolve os X-Request-Id na
 * ordem dos lotes (dentro de um lote a ordem de chegada é indefinida). Exige 200 em todas.
 */
export async function disparar(
  request: APIRequestContext,
  tokenId: string,
  quantidade: number,
  { paralelas = 10, opcoes = {} }: { paralelas?: number; opcoes?: Parameters<APIRequestContext['fetch']>[1] } = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < quantidade; i += paralelas) {
    const respostas = await Promise.all(
      Array.from({ length: Math.min(paralelas, quantidade - i) }, () => request.fetch(`/${tokenId}`, opcoes)),
    );
    for (const r of respostas) {
      expect(r.status(), `webhook nº ${ids.length + 1}: ${(await r.text()).slice(0, 200)}`).toBe(200);
      ids.push(r.headers()['x-request-id']!);
    }
  }
  return ids;
}

/** Todos os uuids da listagem, página a página (`oldest`). */
export async function todosOsUuids(request: APIRequestContext, tokenId: string): Promise<string[]> {
  const uuids: string[] = [];
  for (let pagina = 1; ; pagina++) {
    const { data, is_last_page } = await listar(request, tokenId, `per_page=500&page=${pagina}`);
    uuids.push(...data.map((m) => m.uuid));
    if (is_last_page) return uuids;
  }
}

export function espera(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
