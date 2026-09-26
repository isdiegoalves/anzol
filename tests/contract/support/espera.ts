import type { APIRequestContext, APIResponse } from '@playwright/test';
import { JSON_ACCEPT, expect, type Mensagem } from './contrato.js';
import type { MatchRegra } from './regras.js';

// Espera por requisições (feature `wait-for`, §1 do plano): `POST /token/{id}/requests/wait` é um
// long-poll que responde quando `count` mensagens casam o `match` (a mesma linguagem das regras de
// resposta) ou quando o prazo acaba.

export interface PedidoDeEspera {
  /** O objeto `match` de uma regra; ausente = `{}` = casa qualquer requisição. */
  match?: MatchRegra;
  /** Só mensagens com `seq` > `after`. */
  after?: number;
  /** 1..100, padrão 1. */
  count?: number;
  /** 0..300000 ms, padrão 30000; `0` = só o histórico. */
  timeout?: number;
}

export interface ResultadoDaEspera {
  matched: boolean;
  /** Quantas casaram (≤ `count` pedido). */
  count: number;
  /** As mensagens que casaram, completas como no `GET /token/{id}/request/{id}`, em ordem de `seq`. */
  requests: Mensagem[];
  /**
   * Só com `matched=false`: a mensagem avaliada mais próxima de casar, ou `null` se nenhuma foi avaliada.
   * `conditions[i]` é a chave `match.*` da condição que produziu `failed[i]` (item 14, B1).
   */
  near_miss: { uuid: string; seq: number; failed: string[]; conditions: string[] } | null;
}

export const CHAVES_RESULTADO = ['count', 'matched', 'near_miss', 'requests'];

/** Folga do cliente sobre o prazo pedido: o servidor é quem corta. */
const FOLGA_DO_CLIENTE = 20_000;

/** Chama o endpoint com o corpo dado (qualquer JSON) e mede o tempo até a resposta no cliente. */
export async function chamarEspera(
  request: APIRequestContext,
  tokenId: string,
  corpo: unknown,
  prazoDoCliente = 30_000,
): Promise<{ res: APIResponse; ms: number }> {
  const inicio = Date.now();
  const res = await request.post(`/token/${tokenId}/requests/wait`, {
    data: corpo as object,
    headers: JSON_ACCEPT,
    timeout: prazoDoCliente,
  });
  await res.body();
  return { res, ms: Date.now() - inicio };
}

/**
 * Espera válida: exige 200 com o resultado na forma da §1 e devolve o resultado, o tempo medido no
 * cliente e o instante (relógio do cliente) em que a resposta chegou.
 */
export async function esperar(
  request: APIRequestContext,
  tokenId: string,
  pedido: PedidoDeEspera,
): Promise<{ resultado: ResultadoDaEspera; ms: number; chegou: number }> {
  const prazo = (pedido.timeout ?? 30_000) + FOLGA_DO_CLIENTE;
  const { res, ms } = await chamarEspera(request, tokenId, pedido, prazo);
  const chegou = Date.now();
  expect(res.status(), `POST /token/{id}/requests/wait: ${(await res.text()).slice(0, 500)}`).toBe(200);
  const resultado = (await res.json()) as ResultadoDaEspera;
  expectFormaDoResultado(resultado);
  return { resultado, ms, chegou };
}

/** Chaves e tipos do resultado; `requests` em ordem crescente de `seq`; `near_miss` só sem sucesso. */
export function expectFormaDoResultado(r: ResultadoDaEspera): void {
  expect(Object.keys(r).sort(), JSON.stringify(r).slice(0, 500)).toEqual(CHAVES_RESULTADO);
  expect(typeof r.matched).toBe('boolean');
  expect(Number.isInteger(r.count)).toBe(true);
  expect(Array.isArray(r.requests)).toBe(true);
  expect(r.requests).toHaveLength(r.count);
  const seqs = r.requests.map((m) => m.seq);
  expect(seqs, 'requests em ordem crescente de seq').toEqual([...seqs].sort((a, b) => a - b));
  if (r.matched) expect(r.near_miss, 'near_miss só quando matched=false').toBeNull();
  if (r.near_miss !== null) {
    // Item 14, B1: `conditions` ao lado de `failed`.
    expect(Object.keys(r.near_miss).sort()).toEqual(['conditions', 'failed', 'seq', 'uuid']);
    expect(Number.isInteger(r.near_miss.seq)).toBe(true);
  }
}
