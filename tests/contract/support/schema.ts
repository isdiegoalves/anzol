import type { APIRequestContext, APIResponse } from '@playwright/test';
import { JSON_ACCEPT, expect, type Mensagem, type Token } from './contrato.js';

// Validação de schema por URL (§1 do plano "validacao-schema"). O token guarda um JSON Schema
// (`schema`, objeto ou `null`); cada requisição capturada com schema configurado grava na mensagem
// `schema: {valid, errors: [{path, message}]}`, com `path` em JSON Pointer (RFC 6901) e no máximo
// 20 erros. Sem schema na URL, `schema: null`. `message` é o texto da biblioteca: o contrato não o
// fixa, salvo o `body is not JSON` do corpo vazio ou que não é JSON.

export type ResultadoSchema = NonNullable<Mensagem['schema']>;
export type ErroSchema = ResultadoSchema['errors'][number];

/** Teto de erros gravados por mensagem. */
export const TETO_DE_ERROS = 20;

/** JSON Pointer (RFC 6901): `""` ou sequência de `/token`, com `~` só como `~0` ou `~1`. */
export const PONTEIRO_JSON = /^(\/([^~/]|~[01])*)*$/;

export const NAO_E_JSON: ResultadoSchema = { valid: false, errors: [{ path: '', message: 'body is not JSON' }] };

/** Mensagem de 422 do schema inválido: `The schema is invalid: <motivo>.` */
export const SCHEMA_INVALIDO = /^The schema is invalid: .+\.$/s;

/** Forma das mensagens de validação do Laravel: maiúscula no início, ponto no fim. */
export const FORMA_LARAVEL = /^[A-Z].*\.$/s;

/** Schema de pedido usado em quase todos os testes. */
export const SCHEMA_PEDIDO = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['id', 'status'],
  properties: {
    id: { type: 'integer' },
    status: { type: 'string', enum: ['pago', 'pendente'] },
    itens: {
      type: 'array',
      items: { type: 'object', required: ['qtd'], properties: { qtd: { type: 'integer', minimum: 1 } } },
    },
  },
};

export const PEDIDO_VALIDO = { id: 7, status: 'pago', itens: [{ qtd: 1 }, { qtd: 3 }] };

/** Envio JSON com os bytes exatos (`corpo` string) ou serializado (qualquer outro valor). */
export function envioJson(corpo: unknown, metodo = 'POST') {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  return { method: metodo, headers: { 'Content-Type': 'application/json' }, data: Buffer.from(texto) } as const;
}

/** Resultado inválido: chaves exatas, cada erro `{path, message}` com `path` em JSON Pointer. */
export function expectInvalido(resultado: ResultadoSchema | null | undefined): ErroSchema[] {
  expect(resultado ?? null, 'schema ausente ou null na mensagem').not.toBeNull();
  expectForma(resultado!);
  expect(resultado!.valid, JSON.stringify(resultado)).toBe(false);
  expect(resultado!.errors.length, JSON.stringify(resultado)).toBeGreaterThan(0);
  return resultado!.errors;
}

export function expectValido(resultado: ResultadoSchema | null | undefined): void {
  expect(resultado ?? null, 'schema ausente ou null na mensagem').toEqual({ valid: true, errors: [] });
}

/** `{valid, errors}` com `errors` lista de `{path, message}`, `path` JSON Pointer, no máximo 20. */
export function expectForma(resultado: ResultadoSchema): void {
  expect(Object.keys(resultado).sort(), JSON.stringify(resultado)).toEqual(['errors', 'valid']);
  expect(typeof resultado.valid).toBe('boolean');
  expect(Array.isArray(resultado.errors), JSON.stringify(resultado)).toBe(true);
  expect(resultado.errors.length).toBeLessThanOrEqual(TETO_DE_ERROS);
  for (const erro of resultado.errors) {
    expect(Object.keys(erro).sort(), JSON.stringify(erro)).toEqual(['message', 'path']);
    expect(erro.path, JSON.stringify(erro)).toMatch(PONTEIRO_JSON);
    expect(typeof erro.message, JSON.stringify(erro)).toBe('string');
    expect(erro.message.length, JSON.stringify(erro)).toBeGreaterThan(0);
  }
}

export function caminhos(erros: ErroSchema[]): string[] {
  return erros.map((e) => e.path);
}

export async function lerToken(request: APIRequestContext, uuid: string): Promise<Token> {
  const res = await request.get(`/token/${uuid}`, { headers: JSON_ACCEPT });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Token;
}

/** 422 com exatamente a chave `schema` e uma mensagem; devolve a mensagem. */
export async function expect422Schema(res: APIResponse, corpoEnviado: unknown): Promise<string> {
  const texto = await res.text();
  const descricao = `${JSON.stringify(corpoEnviado).slice(0, 120)} → ${res.status()} ${texto.slice(0, 300)}`;
  expect(res.status(), descricao).toBe(422);
  const corpo = JSON.parse(texto) as Record<string, unknown>;
  expect(Object.keys(corpo), descricao).toEqual(['schema']);
  const mensagens = corpo.schema as string[];
  expect(Array.isArray(mensagens) && mensagens.length === 1, descricao).toBe(true);
  expect(mensagens[0], descricao).toMatch(FORMA_LARAVEL);
  return mensagens[0];
}

/** Schema cujo JSON compacto tem exatamente `bytes` bytes (ASCII), com o tamanho no `description`. */
export function schemaComTamanho(bytes: number): Record<string, unknown> {
  const base = { type: 'object', description: '' };
  const semTexto = JSON.stringify(base).length;
  const schema = { type: 'object', description: 'd'.repeat(bytes - semTexto) };
  expect(Buffer.byteLength(JSON.stringify(schema))).toBe(bytes);
  return schema;
}
