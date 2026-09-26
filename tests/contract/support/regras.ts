import type { APIRequestContext, APIResponse } from '@playwright/test';
import { JSON_ACCEPT, expect } from './contrato.js';

// Regras de resposta por URL. Fase A (fatias 01 + 02, Anexo A do plano da feature): a regra,
// `GET|PUT /token/{id}/rules`, `POST /token/{id}/rules/test` e os campos `rule`/`near_miss` da
// mensagem gravada. Fase B (fatias 03, 04, 05, Anexo B): templating, cenários com estado
// (`/token/{id}/scenarios`), atrasos, dribble e falhas de rede.

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
  /** Resultado da verificação de assinatura da URL: `absent` = header de assinatura ausente. */
  signature?: 'valid' | 'invalid' | 'absent';
  /** Resultado da validação de schema da mensagem; sem schema configurado na URL, nenhum dos dois casa. */
  schema?: 'valid' | 'invalid';
}

/** Atraso antes de responder, em ms; teto 60 000 (log-normal cortado no teto). */
export type Atraso =
  | { fixed: number }
  | { uniform: { min: number; max: number } }
  | { lognormal: { median: number; sigma: number } };

/** Corpo dividido em `chunks` pedaços (1..100) enviados em intervalos iguais ao longo de `durationMs`. */
export interface Gotejamento {
  chunks: number;
  durationMs: number;
}

export type Falha = 'connection_reset' | 'empty_response' | 'malformed_chunk' | 'random_data_then_close';

export interface RespostaRegra {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Handlebars no corpo e nos valores de cabeçalho (fase B). */
  template?: boolean;
  delay?: Atraso | null;
  dribble?: Gotejamento | null;
  /** Com `fault`, status, cabeçalhos, corpo, `delay` e `dribble` são ignorados. */
  fault?: Falha | null;
}

/** Cenário da regra: só casa no estado `requiredState` (ausente = qualquer) e passa a `newState` ao responder. */
export interface CenarioDaRegra {
  name: string;
  requiredState?: string;
  newState?: string;
}

export interface Regra {
  id?: string;
  name?: string;
  enabled?: boolean;
  priority?: number;
  match?: MatchRegra;
  scenario?: CenarioDaRegra | null;
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
  /** Chave da condição de cada frase de `failed`, na mesma ordem (item 14, B1); `null` em mensagem antiga. */
  conditions: string[] | null;
}

export interface ResultadoTesteDeRegra {
  matches: Array<{ uuid: string; seq: number }>;
  misses: Array<{ uuid: string; seq: number; failed: string[]; conditions: string[] }>;
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

/** Mensagens de validação 422 no formato de sempre: `{chave.em.ponto: [mensagem]}`. */
export async function erros422(res: APIResponse): Promise<Record<string, string[]>> {
  expect(res.status(), (await res.text()).slice(0, 500)).toBe(422);
  return (await res.json()) as Record<string, string[]>;
}

/** Estado de um cenário da URL, como `GET /token/{id}/scenarios` devolve. */
export interface Cenario {
  name: string;
  state: string;
  /** Os estados que as regras citam (`requiredState`/`newState`). */
  states: string[];
}

export async function lerCenarios(request: APIRequestContext, tokenId: string): Promise<Cenario[]> {
  const res = await request.get(`/token/${tokenId}/scenarios`, { headers: JSON_ACCEPT });
  expect(res.status(), `GET /token/{id}/scenarios: ${(await res.text()).slice(0, 500)}`).toBe(200);
  return (await res.json()) as Cenario[];
}

/** Estado atual de um cenário (falha se a URL não o lista). */
export async function estadoDoCenario(request: APIRequestContext, tokenId: string, nome: string): Promise<string> {
  const cenarios = await lerCenarios(request, tokenId);
  const cenario = cenarios.find((c) => c.name === nome);
  expect(cenario, `cenário ${nome} ausente de ${JSON.stringify(cenarios)}`).toBeDefined();
  return cenario!.state;
}
