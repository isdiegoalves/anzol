import type { APIRequestContext, APIResponse } from '@playwright/test';
import { JSON_ACCEPT, expect, expectContentType, type Listagem } from './contrato.js';
import type { MatchRegra } from './regras.js';

// Busca de mensagens (§1 do plano "busca-filtro-diff"): `POST /token/{id}/requests/search` com corpo
// `{text?, match?, sorting?, page?, per_page?}`. `text` casa sem diferenciar maiúsculas em método, URL
// gravada, IP, nome ou valor de header, nome ou valor de query e corpo; `match` é o de uma regra; os dois
// em E. A resposta tem a forma e a aritmética de página do `GET /token/{id}/requests`, com `total` = quantas
// casam. Padrões: `sorting` newest, `page` 1, `per_page` 50.

export interface PedidoDeBusca {
  /** 1..200 caracteres; vazio ou ausente = sem filtro de texto. */
  text?: string;
  /** O objeto `match` de uma regra; ausente = `{}`. */
  match?: MatchRegra;
  sorting?: 'newest' | 'oldest';
  page?: number;
  per_page?: number;
}

export const CHAVES_PAGINA = ['current_page', 'data', 'from', 'is_last_page', 'per_page', 'to', 'total'];

/** Chama a busca com qualquer corpo JSON e devolve a resposta crua (para 4xx). */
export function chamarBusca(request: APIRequestContext, tokenId: string, corpo: unknown): Promise<APIResponse> {
  return request.post(`/token/${tokenId}/requests/search`, { data: corpo as object, headers: JSON_ACCEPT });
}

/** Busca válida: exige 200, JSON e a forma da listagem; devolve a página. */
export async function buscar(request: APIRequestContext, tokenId: string, pedido: PedidoDeBusca = {}): Promise<Listagem> {
  const res = await chamarBusca(request, tokenId, pedido);
  expect(res.status(), `POST /token/{id}/requests/search ${JSON.stringify(pedido)}: ${(await res.text()).slice(0, 500)}`).toBe(200);
  expectContentType(res, 'application/json');
  const pagina = (await res.json()) as Listagem;
  expect(Object.keys(pagina).sort(), JSON.stringify(pagina).slice(0, 300)).toEqual(CHAVES_PAGINA);
  return pagina;
}

/** Uuids da página, na ordem devolvida. */
export async function uuidsDaBusca(request: APIRequestContext, tokenId: string, pedido: PedidoDeBusca = {}): Promise<string[]> {
  return (await buscar(request, tokenId, pedido)).data.map((m) => m.uuid);
}

/**
 * Metadados de página com a aritmética do `GET /token/{id}/requests` (conferida contra ele em
 * `busca-paginacao.spec.ts`): `from` = (page − 1) × per_page + 1, `to` = min(page × per_page, total),
 * `is_last_page` = page × per_page ≥ total. Além do fim, `from` > `to`.
 */
export function metaEsperada(total: number, page: number, perPage: number): Omit<Listagem, 'data'> {
  return {
    total,
    per_page: perPage,
    current_page: page,
    is_last_page: page * perPage >= total,
    from: (page - 1) * perPage + 1,
    to: Math.min(page * perPage, total),
  };
}
