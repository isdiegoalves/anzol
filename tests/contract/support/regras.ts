import type { APIRequestContext, APIResponse } from '@playwright/test';
import { JSON_ACCEPT, expect } from './contrato.js';

// Regras de resposta por URL (fase A: fatias 01 + 02). Formato fixado no Anexo A do plano da
// feature: a regra, `GET|PUT /token/{id}/rules`, `POST /token/{id}/rules/test` e os campos
// `rule`/`near_miss` da mensagem gravada.

/** Condição sobre um valor de query ou de cabeçalho: exatamente um operador. */
export type CondicaoTexto =
  | { equals: string }
  | { contains: string }
  | { regex: string }
  | { present: boolean };

/** Condição sobre o corpo: exatamente um operador. `jsonPath` sem `equals` = o caminho existe. */
export type CondicaoCorpo =
  | { equals: string }
  | { contains: string }
  | { regex: string }
  | { jsonPath: { path: string; equals?: string } }
  | { equalToJson: unknown };

export interface MatchRegra {
  /** Vazia ou ausente = qualquer método. */
  method?: string[];
  /** Exatamente um de `equals|prefix|regex`, sobre o caminho depois do token (`""` vira `/`). */
  path?: { equals?: string; prefix?: string; regex?: string };
  query?: Record<string, CondicaoTexto>;
  /** Nome do cabeçalho sem distinção de caixa. */
  headers?: Record<string, CondicaoTexto>;
  body?: CondicaoCorpo[];
}

export interface RespostaRegra {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  template?: boolean;
  delay?: unknown;
  dribble?: unknown;
  fault?: unknown;
}

export interface Regra {
  id?: string;
  name?: string;
  enabled?: boolean;
  priority?: number;
  match?: MatchRegra;
  scenario?: unknown;
  response?: RespostaRegra;
}

/** Regra como o servidor devolve: `id` sempre preenchido e os padrões aplicados. */
export interface RegraSalva extends Regra {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  match: MatchRegra;
  response: RespostaRegra & { status: number; body: string; template: boolean };
}

/** `rule` da mensagem gravada: a regra que respondeu. */
export interface RegraQueRespondeu {
  id: string;
  name: string;
}

/** `near_miss` da mensagem gravada: a regra ativa mais próxima e as condições que falharam. */
export interface QuaseCasou extends RegraQueRespondeu {
  failed: string[];
}

export interface ResultadoTesteDeRegra {
  matches: Array<{ uuid: string; seq: number }>;
  misses: Array<{ uuid: string; seq: number; failed: string[] }>;
}

export function putRegras(request: APIRequestContext, tokenId: string, corpo: unknown): Promise<APIResponse> {
  return request.put(`/token/${tokenId}/rules`, { data: corpo as object, headers: JSON_ACCEPT });
}

/** Substitui a lista de regras da URL e devolve a lista salva; exige 200. */
export async function salvarRegras(request: APIRequestContext, tokenId: string, regras: Regra[]): Promise<RegraSalva[]> {
  const res = await putRegras(request, tokenId, regras);
  expect(res.status(), `PUT /token/{id}/rules: ${(await res.text()).slice(0, 500)}`).toBe(200);
  return (await res.json()) as RegraSalva[];
}

export async function lerRegras(request: APIRequestContext, tokenId: string): Promise<RegraSalva[]> {
  const res = await request.get(`/token/${tokenId}/rules`, { headers: JSON_ACCEPT });
  expect(res.status(), `GET /token/{id}/rules: ${(await res.text()).slice(0, 500)}`).toBe(200);
  return (await res.json()) as RegraSalva[];
}

export function testarRegra(request: APIRequestContext, tokenId: string, regra: unknown): Promise<APIResponse> {
  return request.post(`/token/${tokenId}/rules/test`, { data: regra as object, headers: JSON_ACCEPT });
}

/** Garante que cada padrão casa com alguma frase de `failed` (conteúdo, não o texto exato). */
export function expectFalhas(failed: string[], padroes: RegExp[]): void {
  expect(Array.isArray(failed), `failed deve ser lista: ${JSON.stringify(failed)}`).toBe(true);
  for (const f of failed) expect(typeof f).toBe('string');
  for (const padrao of padroes) {
    expect(failed.some((f) => padrao.test(f)), `nenhuma frase de ${JSON.stringify(failed)} casa ${padrao}`).toBe(true);
  }
}
