import type { RuleMatch, SchemaCondition, SignatureCondition } from '../rules/rule';

/** Métodos oferecidos no filtro rápido "Method". */
export const FILTER_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** `absent` fica de fora do filtro rápido (o `match` aceita; a §1 pede Any/Valid/Invalid). */
export type SignatureFilter = 'any' | Exclude<SignatureCondition, 'absent'>;
export type SchemaFilter = 'any' | SchemaCondition;

/** Filtro da lista lateral: texto e filtros rápidos. Fica só na tela, não vai para a rota. */
export interface RequestFilter {
  text: string;
  methods: readonly string[];
  signature: SignatureFilter;
  schema: SchemaFilter;
}

export const NO_FILTER: RequestFilter = { text: '', methods: [], signature: 'any', schema: 'any' };

/** Mensagens por página da busca: a mesma página da lista sem filtro. */
export const SEARCH_PER_PAGE = 50;

/** Corpo de `POST /token/{id}/requests/search`. */
export interface SearchBody {
  text?: string;
  match: RuleMatch;
  sorting: 'oldest';
  page: number;
  per_page: number;
}

export function isFilterActive(filter: RequestFilter): boolean {
  return (
    filter.text.trim() !== '' ||
    filter.methods.length > 0 ||
    filter.signature !== 'any' ||
    filter.schema !== 'any'
  );
}

export function sameFilter(a: RequestFilter, b: RequestFilter): boolean {
  return (
    a.text.trim() === b.text.trim() &&
    a.signature === b.signature &&
    a.schema === b.schema &&
    a.methods.length === b.methods.length &&
    a.methods.every((method) => b.methods.includes(method))
  );
}

/**
 * Filtro → corpo da busca. Os filtros rápidos viram o `match` das regras; ordem `oldest`, a
 * mesma da lista sem filtro (a mensagem nova entra no fim).
 */
export function searchBody(filter: RequestFilter, page: number): SearchBody {
  const text = filter.text.trim();
  const match: RuleMatch = {};
  if (filter.methods.length > 0) {
    match.method = [...filter.methods];
  }
  if (filter.signature !== 'any') {
    match.signature = filter.signature;
  }
  if (filter.schema !== 'any') {
    match.schema = filter.schema;
  }
  return {
    ...(text && { text }),
    match,
    sorting: 'oldest',
    page,
    per_page: SEARCH_PER_PAGE,
  };
}
