import type { CapturedRequest } from '../requests/webhook-request';
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
 * (`?signature=&schema=&methods=&q=`, e `signatureReason=`/`schemaPath=` do M1, ver
 * `filterFromParams`), para o link ser compartilhável e o "Show in Inbox" do Health abrir filtrado.
 */
export interface RequestFilter {
  text: string;
  methods: readonly string[];
  signature: SignatureFilter;
  schema: SchemaFilter;
  /** Desfecho da mensagem (C2): respondida por uma regra, quase acerto dela, ou resposta padrão. */
  outcome?: OutcomeFilter | null;
  /**
   * M1: o motivo exato de assinatura inválida, como o Health mostra (sem o parêntese final); `null`
   * ou ausente, sem este filtro.
   */
  signatureReason?: string | null;
  /** M1: o caminho (JSON Pointer) de um erro de schema; `''` é a raiz. `null` ou ausente, sem ele. */
  schemaPath?: string | null;
  /**
   * Por classe (`4xx`) ou exato (`429`). A busca do servidor não filtra por status: roda no
   * navegador, sobre as mais novas (`RequestStore.scan`).
   */
  answered?: readonly string[] | null;
  /**
   * Ficam no estado da tela e no `sessionStorage` da aba: o dado da requisição não vai para o
   * endereço, que diz só quantos são (`?values=2`).
   */
  values?: readonly ValueFilter[] | null;
  /** Conta só sobre as n mais novas da URL, como a contagem de Métricas e de Saúde que trouxe aqui. */
  window?: number | null;
}

/** `name` é o cabeçalho, o parâmetro ou o JSONPath do corpo. */
export interface ValueFilter {
  kind: 'path' | 'header' | 'query' | 'body';
  name: string;
  value: string;
}

/** Igual à frase das condições de Regras: "header x-loja-event-id = evt_48213". */
export function valueLabel({ kind, name, value }: ValueFilter): string {
  switch (kind) {
    case 'path':
      return $localize`:filter chip:path = ${value}:value:`;
    case 'header':
      return $localize`:filter chip:header ${name}:name: = ${value}:value:`;
    case 'query':
      return $localize`:filter chip:query ${name}:name: = ${value}:value:`;
    case 'body':
      return $localize`:filter chip:body ${name}:name: = ${value}:value:`;
  }
}

/** O `outcome` da busca, com o nome da regra para o chip ("Answered by: Pix"). */
export type OutcomeFilter =
  { type: 'rule' | 'near_miss'; rule: string; name: string } | { type: 'default' };

export const NO_FILTER: RequestFilter = { text: '', methods: [], signature: 'any', schema: 'any' };

/** Os parâmetros da rota da Inbox que viram filtro. */
export interface FilterParams {
  signature?: string | null;
  schema?: string | null;
  methods?: string | null;
  q?: string | null;
  outcome?: string | null;
  rule?: string | null;
  ruleName?: string | null;
  signatureReason?: string | null;
  schemaPath?: string | null;
  answered?: string | null;
  /** Quantos filtros por valor a tela tinha: os valores ficam na aba, não no endereço. */
  values?: string | null;
  window?: string | null;
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
  const outcome = outcomeFromParams(params);
  // Os tetos do servidor (422 acima): o motivo vazio não filtra nada; o caminho vazio é a raiz.
  const reason = params.signatureReason?.slice(0, REASON_MAX) || null;
  const answered = (params.answered ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value, index, all) => ANSWERED.test(value) && all.indexOf(value) === index);
  const newest = /^[1-9]\d{0,5}$/.test(params.window ?? '') ? Number(params.window) : null;
  const path =
    params.schemaPath != null &&
    isPointer(params.schemaPath) &&
    params.schemaPath.length <= PATH_MAX
      ? params.schemaPath
      : null;
  return {
    text: (params.q ?? '').slice(0, 200),
    methods,
    signature,
    schema,
    ...(outcome && { outcome }),
    ...(reason !== null && { signatureReason: reason }),
    ...(path !== null && { schemaPath: path }),
    ...(answered.length > 0 && { answered }),
    ...(newest !== null && { window: newest }),
  };
}

const ANSWERED = /^([1-5]xx|[1-5]\d\d)$/;

/** Sem status gravado (falha de rede, gravada antes do campo), não casa. */
export function answeredMatches(request: CapturedRequest, answered: readonly string[]): boolean {
  const status = request.response?.status;
  if (status === undefined) {
    return false;
  }
  return answered.some((wanted) =>
    wanted.endsWith('xx') ? `${Math.floor(status / 100)}xx` === wanted : `${status}` === wanted,
  );
}

const REASON_MAX = 200;
const PATH_MAX = 1000;
/** JSON Pointer: vazio (a raiz), ou `/` no começo e `~` só como `~0`/`~1` (a busca recusa o resto). */
function isPointer(path: string): boolean {
  return path === '' || (path.startsWith('/') && !/~(?![01])/.test(path));
}

const UUID = /^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i;

function outcomeFromParams(params: FilterParams): OutcomeFilter | null {
  if (params.outcome === 'default') {
    return { type: 'default' };
  }
  if (
    (params.outcome === 'rule' || params.outcome === 'near_miss') &&
    UUID.test(params.rule ?? '')
  ) {
    return { type: params.outcome, rule: params.rule ?? '', name: params.ruleName ?? '' };
  }
  return null;
}

/** A query da rota para o filtro: só o que está ligado (`null` tira o parâmetro). */
export function filterToParams(filter: RequestFilter): Record<keyof FilterParams, string | null> {
  return {
    signature: filter.signature === 'any' ? null : filter.signature,
    schema: filter.schema === 'any' ? null : filter.schema,
    methods: filter.methods.length > 0 ? filter.methods.join(',') : null,
    q: filter.text.trim() ? filter.text : null,
    outcome: filter.outcome?.type ?? null,
    rule: filter.outcome && filter.outcome.type !== 'default' ? filter.outcome.rule : null,
    ruleName: filter.outcome && filter.outcome.type !== 'default' ? filter.outcome.name : null,
    signatureReason: filter.signatureReason ?? null,
    schemaPath: filter.schemaPath ?? null,
    answered: filter.answered?.length ? filter.answered.join(',') : null,
    values: filter.values?.length ? String(filter.values.length) : null,
    window: filter.window ? String(filter.window) : null,
  };
}

/** Mensagens por página da busca: a mesma página da lista sem filtro. */
export const SEARCH_PER_PAGE = 50;

/** Corpo de `POST /token/{id}/requests/search`. */
export interface SearchBody {
  text?: string;
  match: RuleMatch;
  outcome?: { type: OutcomeFilter['type']; rule?: string };
  signature_reason?: string;
  schema_path?: string;
  sorting: RequestSorting;
  page: number;
  per_page: number;
}

export function isFilterActive(filter: RequestFilter): boolean {
  return (
    filter.text.trim() !== '' ||
    filter.methods.length > 0 ||
    filter.signature !== 'any' ||
    filter.schema !== 'any' ||
    !!filter.outcome ||
    filter.signatureReason != null ||
    filter.schemaPath != null ||
    !!filter.answered?.length ||
    !!filter.values?.length ||
    !!filter.window
  );
}

export function sameFilter(a: RequestFilter, b: RequestFilter): boolean {
  return (
    a.text.trim() === b.text.trim() &&
    a.signature === b.signature &&
    a.schema === b.schema &&
    a.methods.length === b.methods.length &&
    a.methods.every((method) => b.methods.includes(method)) &&
    sameOutcome(a.outcome ?? null, b.outcome ?? null) &&
    (a.signatureReason ?? null) === (b.signatureReason ?? null) &&
    (a.schemaPath ?? null) === (b.schemaPath ?? null) &&
    (a.answered ?? []).join() === (b.answered ?? []).join() &&
    JSON.stringify(a.values ?? []) === JSON.stringify(b.values ?? []) &&
    (a.window ?? null) === (b.window ?? null)
  );
}

function sameOutcome(a: OutcomeFilter | null, b: OutcomeFilter | null): boolean {
  if (!a || !b) {
    return a === b;
  }
  const rule = (outcome: OutcomeFilter) => (outcome.type === 'default' ? null : outcome.rule);
  return a.type === b.type && rule(a) === rule(b);
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
  for (const { kind, name, value } of filter.values ?? []) {
    if (kind === 'path') {
      match.path = { equals: value };
    } else if (kind === 'body') {
      match.body = [...(match.body ?? []), { jsonPath: { path: name, equals: value } }];
    } else {
      const field = kind === 'header' ? 'headers' : 'query';
      match[field] = { ...(match[field] ?? {}), [name]: { equals: value } };
    }
  }
  const outcome = filter.outcome;
  return {
    ...(text && { text }),
    match,
    ...(filter.signatureReason != null && { signature_reason: filter.signatureReason }),
    ...(filter.schemaPath != null && { schema_path: filter.schemaPath }),
    ...(outcome && {
      outcome:
        outcome.type === 'default'
          ? { type: outcome.type }
          : { type: outcome.type, rule: outcome.rule },
    }),
    sorting,
    page,
    per_page: SEARCH_PER_PAGE,
  };
}

/**
 * O que o filtro tem e o `wait-for` não entende (ele só lê o `match`): o texto, o desfecho (C2) e o
 * motivo e o caminho do M1. O comando sai sem eles, e a tela diz quais ficaram de fora.
 */
export function outsideWaitFor(
  filter: RequestFilter,
): ('text' | 'outcome' | 'reason' | 'path' | 'answered')[] {
  return [
    ...(filter.text.trim() ? (['text'] as const) : []),
    ...(filter.outcome ? (['outcome'] as const) : []),
    ...(filter.signatureReason != null ? (['reason'] as const) : []),
    ...(filter.schemaPath != null ? (['path'] as const) : []),
    ...(filter.answered?.length ? (['answered'] as const) : []),
  ];
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
  const parts = [
    'anzol wait-for',
    `--server ${shellQuote(target.server)}`,
    `--token ${target.tokenId}`,
    ...matchArgs(filter),
  ];
  if (target.protected) {
    parts.push('--read-secret "$WEBHOOK_READ_SECRET"');
  }
  return parts.join(' ');
}

/**
 * "Copy CI test": o `anzol test` cria a própria URL, então vai sem `--token`. O `{url}` fica entre
 * aspas simples: no zsh, `{url}` solto antes de um redirecionamento vira descritor de arquivo.
 */
export function ciTestCommand(filter: RequestFilter, server: string): string {
  return [
    'anzol test',
    `--server ${shellQuote(server)}`,
    ...matchArgs(filter),
    "-- ./trigger.sh '{url}'",
  ].join(' ');
}

function matchArgs(filter: RequestFilter): string[] {
  const { match } = searchBody(filter, 1);
  return Object.keys(match).length > 0 ? [`--match ${shellQuote(JSON.stringify(match))}`] : [];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
