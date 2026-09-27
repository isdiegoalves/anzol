import type { RuleMatch, SchemaCondition, SignatureCondition } from '../rules/rule';

/** Métodos oferecidos no filtro rápido "Method". */
export const FILTER_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Os três resultados da assinatura, como o `match.signature` das regras (item 14: com `absent`). */
export type SignatureFilter = 'any' | SignatureCondition;
export type SchemaFilter = 'any' | SchemaCondition;

/** Ordem da lista e da busca: `newest` (a mais nova primeiro, o padrão) ou `oldest`. */
export type RequestSorting = 'newest' | 'oldest';

/**
 * Filtro da lista lateral: texto e filtros rápidos. Vai também para a query da rota da Inbox
 * (`?signature=&schema=&methods=&q=`, ver `filterFromParams`), para o link ser compartilhável e o
 * "Show in Inbox" do Health abrir filtrado.
 */
export interface RequestFilter {
  text: string;
  methods: readonly string[];
  signature: SignatureFilter;
  schema: SchemaFilter;
}

export const NO_FILTER: RequestFilter = { text: '', methods: [], signature: 'any', schema: 'any' };

/** Os parâmetros da rota da Inbox que viram filtro. */
export interface FilterParams {
  signature?: string | null;
  schema?: string | null;
  methods?: string | null;
  q?: string | null;
}

const SIGNATURE_VALUES: readonly SignatureCondition[] = ['valid', 'invalid', 'absent'];
const SCHEMA_VALUES: readonly SchemaCondition[] = ['valid', 'invalid'];

/**
 * O filtro da query da rota (`?signature=invalid&schema=valid&methods=POST,GET&q=texto`). Valor que
 * a tela não conhece é ignorado, parâmetro a parâmetro (um método estranho sai da lista).
 */
export function filterFromParams(params: FilterParams): RequestFilter {
  const signature = SIGNATURE_VALUES.find((value) => value === params.signature) ?? 'any';
  const schema = SCHEMA_VALUES.find((value) => value === params.schema) ?? 'any';
  const wanted = (params.methods ?? '').split(',').map((method) => method.trim().toUpperCase());
  const methods = FILTER_METHODS.filter((method) => wanted.includes(method));
  return { text: (params.q ?? '').slice(0, 200), methods, signature, schema };
}

/** A query da rota para o filtro: só o que está ligado (`null` tira o parâmetro). */
export function filterToParams(filter: RequestFilter): Record<keyof FilterParams, string | null> {
  return {
    signature: filter.signature === 'any' ? null : filter.signature,
    schema: filter.schema === 'any' ? null : filter.schema,
    methods: filter.methods.length > 0 ? filter.methods.join(',') : null,
    q: filter.text.trim() ? filter.text : null,
  };
}

/** Mensagens por página da busca: a mesma página da lista sem filtro. */
export const SEARCH_PER_PAGE = 50;

/** Corpo de `POST /token/{id}/requests/search`. */
export interface SearchBody {
  text?: string;
  match: RuleMatch;
  sorting: RequestSorting;
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
export function searchBody(
  filter: RequestFilter,
  page: number,
  sorting: RequestSorting = 'newest',
): SearchBody {
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
    sorting,
    page,
    per_page: SEARCH_PER_PAGE,
  };
}

/** Para onde e para qual URL o comando `anzol wait-for` aponta. */
export interface WaitForTarget {
  server: string;
  tokenId: string;
  /** URL protegida: o comando lê o segredo da variável, nunca o leva escrito. */
  protected: boolean;
}

/**
 * "Copy as anzol wait-for" (S10): o comando do CLI que espera uma mensagem com os filtros
 * rápidos, levados como o `match` (o mesmo da busca). O texto da busca não existe no `wait-for` e
 * fica de fora (a tela avisa). Valores entre aspas simples POSIX.
 */
export function waitForCommand(filter: RequestFilter, target: WaitForTarget): string {
  const { match } = searchBody(filter, 1);
  const parts = [
    'anzol wait-for',
    `--server ${shellQuote(target.server)}`,
    `--token ${target.tokenId}`,
  ];
  if (Object.keys(match).length > 0) {
    parts.push(`--match ${shellQuote(JSON.stringify(match))}`);
  }
  if (target.protected) {
    parts.push('--read-secret "$WEBHOOK_READ_SECRET"');
  }
  return parts.join(' ');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
