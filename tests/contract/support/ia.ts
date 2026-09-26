import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BASE_URL, JSON_ACCEPT, expect, expectContentType, test } from './contrato.js';
import { pedidosAoLlm, type PedidoAoLlm } from './llm-falso.js';

// IA local (§1 do plano "ia-local"): `POST /token/{id}/rules/suggest` e `POST /token/{id}/request/{rid}/explain`,
// com o LLM falso de `llm-falso.ts` no lugar do oMLX.
//
// IA e MCP são ligados ou desligados no app inteiro, não por URL. O contrato roda num modo por execução:
// - `CONTRATO_IA=falso` (padrão): o app sob teste aponta `WEBHOOK_AI_BASE_URL` para o LLM falso
//   (`http://host.docker.internal:18099`); os testes de 503 são pulados.
// - `CONTRATO_IA=desligada`: stack com a IA desligada; só os testes de 503 rodam.
// - `CONTRATO_MCP=ligado` (padrão) ou `desligado` (só o teste do 404 em `/mcp` roda).
// Sem `CONTRATO_IA` declarado e `BASE_URL` na 8084 (o app do dono, ligado ao oMLX real), os testes que
// chamam o LLM são pulados: nenhum prompt do contrato vai para o modelo de verdade.

export const MODO_IA = process.env.CONTRATO_IA ?? 'falso';
export const MODO_MCP = process.env.CONTRATO_MCP ?? 'ligado';

/** Modelos da §1 (`WEBHOOK_AI_MODEL_JSON` e `WEBHOOK_AI_MODEL_TEXT`); declarar se o stack sob teste mudou. */
export const MODELO_JSON = process.env.IA_MODELO_JSON ?? 'NVIDIA-Nemotron-3.5-Lightning-30B-A3B-4bit';
export const MODELO_TEXTO = process.env.IA_MODELO_TEXTO ?? 'KAT-Coder-V2.5-Dev-oQ4e-mtp';

const APP_DO_DONO = new URL(BASE_URL).port === '8084' && process.env.CONTRATO_IA === undefined;

/** Pula o teste se o app sob teste não está ligado ao LLM falso. */
export function exigirLlmFalso(): void {
  test.skip(APP_DO_DONO, 'BASE_URL na 8084 (oMLX real): declare CONTRATO_IA=falso num stack ligado ao LLM falso');
  test.skip(MODO_IA !== 'falso', `CONTRATO_IA=${MODO_IA}: o app não está ligado ao LLM falso`);
}

/** Pula o teste se o stack sob teste não está com a IA desligada. */
export function exigirIaDesligada(): void {
  test.skip(MODO_IA !== 'desligada', 'só num stack com a IA desligada (CONTRATO_IA=desligada)');
}

/** Até 3 tentativas contra o LLM, cada uma com timeout de leitura de 90 s no app: o cliente espera mais. */
const PRAZO_DO_CLIENTE = 120_000;

export interface Sugestao {
  rule: Record<string, unknown>;
  explanation: string;
  attempts: number;
}

export interface Diagnostico {
  explanation: string;
  facts: Record<string, unknown>;
}

export function chamarSuggest(request: APIRequestContext, tokenId: string, corpo: unknown): Promise<APIResponse> {
  return request.post(`/token/${tokenId}/rules/suggest`, { data: corpo as object, headers: JSON_ACCEPT, timeout: PRAZO_DO_CLIENTE });
}

export function chamarExplain(request: APIRequestContext, tokenId: string, rid: string, corpo: unknown = {}): Promise<APIResponse> {
  return request.post(`/token/${tokenId}/request/${rid}/explain`, { data: corpo as object, headers: JSON_ACCEPT, timeout: PRAZO_DO_CLIENTE });
}

/** Exige 200 JSON com `{rule, explanation, attempts}`. */
export async function sugestaoOk(res: APIResponse): Promise<Sugestao> {
  const texto = await res.text();
  expect(res.status(), `POST rules/suggest: ${texto.slice(0, 500)}`).toBe(200);
  expectContentType(res, 'application/json');
  const s = JSON.parse(texto) as Sugestao;
  expect(typeof s.rule === 'object' && s.rule !== null && !Array.isArray(s.rule), `rule: ${texto.slice(0, 300)}`).toBe(true);
  expect(typeof s.explanation, `explanation: ${texto.slice(0, 300)}`).toBe('string');
  expect(Number.isInteger(s.attempts), `attempts: ${texto.slice(0, 300)}`).toBe(true);
  return s;
}

/** Exige 200 JSON com `{explanation, facts}`. */
export async function diagnosticoOk(res: APIResponse): Promise<Diagnostico> {
  const texto = await res.text();
  expect(res.status(), `POST explain: ${texto.slice(0, 500)}`).toBe(200);
  expectContentType(res, 'application/json');
  const d = JSON.parse(texto) as Diagnostico;
  expect(typeof d.explanation, `explanation: ${texto.slice(0, 300)}`).toBe('string');
  expect(typeof d.facts === 'object' && d.facts !== null && !Array.isArray(d.facts), `facts: ${texto.slice(0, 300)}`).toBe(true);
  return d;
}

/** 503 `{"error": "AI is not configured"}`. */
export async function expect503(res: APIResponse): Promise<void> {
  const texto = await res.text();
  expect(res.status(), texto.slice(0, 300)).toBe(503);
  expectContentType(res, 'application/json');
  expect(JSON.parse(texto)).toEqual({ error: 'AI is not configured' });
}

/** 502 com `error` texto não vazio (LLM fora ou com erro). */
export async function expect502(res: APIResponse): Promise<void> {
  const texto = await res.text();
  expect(res.status(), texto.slice(0, 300)).toBe(502);
  expectContentType(res, 'application/json');
  const corpo = JSON.parse(texto) as { error?: unknown };
  expect(typeof corpo.error === 'string' && corpo.error.trim().length > 0, `error: ${texto.slice(0, 300)}`).toBe(true);
}

/** As mensagens (textos) de um 422 `{chave: [mensagem]}` da API. */
export async function mensagensDo422(res: APIResponse): Promise<string[]> {
  const texto = await res.text();
  expect(res.status(), texto.slice(0, 300)).toBe(422);
  const corpo = JSON.parse(texto) as Record<string, string[]>;
  const mensagens = Object.values(corpo).flat();
  expect(mensagens.length, texto).toBeGreaterThan(0);
  return mensagens;
}

/** Os pedidos que o falso recebeu com o marcador, exigindo exatamente `quantidade`. */
export async function pedidosCom(marcador: string, quantidade: number): Promise<PedidoAoLlm[]> {
  const pedidos = await pedidosAoLlm(marcador);
  expect(pedidos.length, `pedidos ao LLM com o marcador: ${pedidos.length}`).toBe(quantidade);
  return pedidos;
}

/**
 * Aspas e barras invertidas fora: um texto citado dentro de JSON (`\"pago\"`) e o mesmo texto cru (`"pago"`)
 * ficam iguais. O app pode pôr os fatos no prompt como JSON ou como texto.
 */
export function semAspas(texto: string): string {
  return texto.replace(/[\\"]/g, '');
}

/** Cada item de `procurados` aparece em `texto` (comparados sem aspas nem barras invertidas). */
export function expectContem(texto: string, procurados: string[], onde: string): void {
  const alvo = semAspas(texto);
  for (const p of procurados) expect(alvo.includes(semAspas(p)), `${onde} não contém ${JSON.stringify(p)}: ${texto.slice(0, 1500)}`).toBe(true);
}

/** Todos os textos e números de um JSON (valores e chaves), um por linha: os fatos lidos pelo conteúdo. */
export function textosDe(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (Array.isArray(valor)) return valor.map(textosDe).join('\n');
  return Object.entries(valor as Record<string, unknown>).map(([k, v]) => `${k}\n${textosDe(v)}`).join('\n');
}
