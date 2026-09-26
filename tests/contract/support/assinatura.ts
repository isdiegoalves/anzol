import { createHmac } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { JSON_ACCEPT, expect, type Tokens } from './contrato.js';

// Verificação de assinatura HMAC por URL (§1 do plano "assinatura-hmac"). O contrato assina do lado
// do cliente com `node:crypto`, a partir do segredo e dos MESMOS bytes enviados; o servidor só vê o
// segredo pela configuração da URL.

export type Provedor = 'stripe' | 'github' | 'shopify' | 'slack' | 'generic';
export type Algoritmo = 'sha1' | 'sha256' | 'sha512';
export type Codificacao = 'hex' | 'base64';

/** Configuração `signature` do token, como se envia no `POST`/`PUT /token`. */
export interface ConfigAssinatura {
  provider: Provedor | string;
  secret?: string;
  header?: string;
  algorithm?: Algoritmo | string;
  encoding?: Codificacao | string;
  prefix?: string;
  toleranceSeconds?: number;
}

/** `signature` da mensagem gravada: `null` sem configuração na URL. */
export interface ResultadoAssinatura {
  provider: string;
  valid: boolean;
  /** `null` quando válida; senão frase curta em inglês. */
  reason: string | null;
}

/** Segredo mascarado como o `GET /token/{id}` devolve: `••••` + os 4 últimos caracteres. */
export function mascarado(segredo: string): string {
  return '••••' + segredo.slice(-4);
}

export function hmac(algoritmo: Algoritmo, segredo: string, dados: Buffer, codificacao: Codificacao = 'hex'): string {
  return createHmac(algoritmo, segredo).update(dados).digest(codificacao);
}

function bytes(corpo: Buffer | string): Buffer {
  return Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo, 'utf8');
}

export function agoraEmSegundos(): number {
  return Math.floor(Date.now() / 1000);
}

/** `Stripe-Signature: t=<ts>,v1=<hex>` com HMAC-SHA256 de `"{t}.{corpo}"`. */
export function assinaturaStripe(segredo: string, corpo: Buffer | string, t = agoraEmSegundos()): { t: number; v1: string; header: string } {
  const v1 = hmac('sha256', segredo, Buffer.concat([Buffer.from(`${t}.`), bytes(corpo)]));
  return { t, v1, header: `t=${t},v1=${v1}` };
}

/** `X-Hub-Signature-256: sha256=<hex>` do corpo. */
export function assinaturaGithub(segredo: string, corpo: Buffer | string): string {
  return `sha256=${hmac('sha256', segredo, bytes(corpo))}`;
}

/** `X-Shopify-Hmac-Sha256: <base64>` do corpo. */
export function assinaturaShopify(segredo: string, corpo: Buffer | string): string {
  return hmac('sha256', segredo, bytes(corpo), 'base64');
}

/** `X-Slack-Signature: v0=<hex>` de `"v0:{ts}:{corpo}"` e `X-Slack-Request-Timestamp: <ts>`. */
export function cabecalhosSlack(segredo: string, corpo: Buffer | string, ts = agoraEmSegundos()): Record<string, string> {
  const assinatura = hmac('sha256', segredo, Buffer.concat([Buffer.from(`v0:${ts}:`), bytes(corpo)]));
  return { 'X-Slack-Signature': `v0=${assinatura}`, 'X-Slack-Request-Timestamp': String(ts) };
}

export function postToken(request: APIRequestContext, dados: Record<string, unknown>): Promise<APIResponse> {
  return request.post('/token', { data: dados, headers: JSON_ACCEPT });
}

export function putToken(request: APIRequestContext, tokenId: string, dados: Record<string, unknown>): Promise<APIResponse> {
  return request.put(`/token/${tokenId}`, { data: dados, headers: JSON_ACCEPT });
}

/**
 * `POST /token` que pode (deve) ser recusado: se o servidor criar o token mesmo assim, ele é
 * registrado para limpeza antes de o teste falhar, para não deixar lixo no Redis.
 */
export async function postTokenRegistrando(
  request: APIRequestContext,
  tokens: Tokens,
  dados: Record<string, unknown>,
): Promise<{ res: APIResponse; corpo: Record<string, unknown> }> {
  const res = await postToken(request, dados);
  const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status() === 201 && typeof corpo.uuid === 'string') tokens.registrar(corpo.uuid);
  return { res, corpo };
}

/** 422 com ao menos uma chave de erro sob `signature` (o nome exato do subcampo fica livre). */
export function expect422Assinatura(res: APIResponse, corpo: Record<string, unknown>): void {
  expect(res.status(), JSON.stringify(corpo).slice(0, 500)).toBe(422);
  const chaves = Object.keys(corpo);
  expect(chaves.some((c) => c === 'signature' || c.startsWith('signature.')), `chaves do 422: ${chaves.join(', ')}`).toBe(true);
  for (const c of chaves) {
    const mensagens = corpo[c];
    expect(Array.isArray(mensagens), `${c}: ${JSON.stringify(mensagens)}`).toBe(true);
  }
}

// Frases de `reason`, casadas pelo conteúdo com tolerância de caixa e espaço (como nos specs de
// regras). Textos da §1: `header X-Hub-Signature-256 absent`, `malformed header`,
// `signature mismatch`, `timestamp outside tolerance (412 s)`.
export const MOTIVO_DIVERGENTE = /\bsignature\s+mismatch\b/i;
export const MOTIVO_MALFORMADO = /\bmalformed\s+header\b/i;
export function motivoAusente(cabecalho: string): RegExp {
  return new RegExp(`\\bheader\\s+${cabecalho.replace(/[-]/g, '\\-')}\\s+absent\\b`, 'i');
}
export const MOTIVO_FORA_DA_TOLERANCIA = /\btimestamp\s+outside\s+tolerance\s*\(\s*(\d+)\s*s\s*\)/i;

/** Confere o motivo de timestamp vencido e que a idade citada bate com a enviada (±30 s de relógio). */
export function expectForaDaTolerancia(resultado: ResultadoAssinatura | null, idade: number): void {
  expect(resultado ?? null, 'signature ausente ou null na mensagem').not.toBeNull();
  expect(resultado!.valid).toBe(false);
  const m = MOTIVO_FORA_DA_TOLERANCIA.exec(resultado!.reason ?? '');
  expect(m, `reason: ${resultado!.reason}`).not.toBeNull();
  expect(Math.abs(Number(m![1]) - idade), `reason: ${resultado!.reason}`).toBeLessThanOrEqual(30);
}

/** Resultado inválido com o motivo casando `padrao`, e as chaves exatas `{provider, valid, reason}`. */
export function expectInvalida(resultado: ResultadoAssinatura | null, provedor: string, padrao: RegExp): void {
  expect(resultado ?? null, 'signature ausente ou null na mensagem').not.toBeNull();
  expect(Object.keys(resultado!).sort()).toEqual(['provider', 'reason', 'valid']);
  expect(resultado!.provider).toBe(provedor);
  expect(resultado!.valid, JSON.stringify(resultado)).toBe(false);
  expect(typeof resultado!.reason, JSON.stringify(resultado)).toBe('string');
  expect(resultado!.reason!, JSON.stringify(resultado)).toMatch(padrao);
}

export function expectValida(resultado: ResultadoAssinatura | null, provedor: string): void {
  expect(resultado).toEqual({ provider: provedor, valid: true, reason: null });
}
