import { FieldValue, WebhookRequest } from '../requests/webhook-request';
import {
  BodyMatcher,
  PathMatcher,
  RULE_DEFAULT_PRIORITY,
  RULE_DEFAULT_STATUS,
  Rule,
  ValueMatcher,
} from './rule';

/** Acima disto (em bytes UTF-8), o corpo que não é JSON fica sem condição. */
const BODY_EQUALS_MAX_BYTES = 10 * 1024;
const NAME_MAX_LENGTH = 100;

/** Por que a caixa vem desmarcada: o valor muda a cada entrega (WM-31, CA-6). */
export type VolatileHint = 'id' | 'timestamp' | 'uuid';

/**
 * Uma condição que a regra pode ter a partir da mensagem (a folha "Create rule from this request"):
 * uma caixa (`Method POST`, `Body $.status = "pago"`), marcada ou não por padrão.
 */
export interface RuleCandidate {
  key: string;
  kind: 'method' | 'path' | 'query' | 'header' | 'body' | 'bodyText';
  /** O valor como aparece na caixa (texto na query e no cabeçalho, literal JSON no corpo). */
  display: string;
  /** Nome do campo (query, cabeçalho) ou o JSONPath (`$.status`). */
  field: string;
  value: unknown;
  checked: boolean;
  hint: VolatileHint | null;
  /** Cabeçalho que todo cliente manda (host, content-length…): a folha o recolhe no fim (R2-L3). */
  transport: boolean;
}

/** A resposta que a folha monta ao lado das condições. */
export interface CandidateResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parece mudar a cada entrega? Nome de id (`id`, `*_id`, `*Id`), de data (`*time*`, `*date*`,
 * `created*`, `updated*`, `*_at`, `*At`), valor UUID ou epoch (10 ou 13 dígitos).
 */
export function volatileHint(name: string, value: unknown): VolatileHint | null {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (UUID.test(text)) {
    return 'uuid';
  }
  if (name === 'id' || /_id$/i.test(name) || /[a-z]Id$/.test(name)) {
    return 'id';
  }
  if (
    /time|date|created|updated/i.test(name) ||
    /(^|_)at$/i.test(name) ||
    /[a-z]At$/.test(name) ||
    /^\d{10}(\d{3})?$/.test(text)
  ) {
    return 'timestamp';
  }
  return null;
}

function fieldText(value: FieldValue | undefined): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
}

function childPath(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `$.${key}` : `$['${key}']`;
}

/**
 * As condições que a mensagem sugere (WM-31): método e caminho marcados; cada query e cada campo
 * de primeiro nível do corpo JSON, marcados salvo o que parece id, data ou UUID; os cabeçalhos,
 * desmarcados; corpo que não é objeto JSON, "igual ao texto" desmarcado (até 10 KiB).
 */
export function ruleCandidates(request: WebhookRequest): RuleCandidate[] {
  const path = pathAfterToken(request.url, request.token_id);
  const candidates: RuleCandidate[] = [
    candidate('method', request.method, request.method, request.method, true, null),
    candidate('path', path, path, path, true, null),
  ];
  for (const [name, raw] of Object.entries(request.query ?? {})) {
    const value = fieldText(raw);
    const hint = volatileHint(name, value);
    candidates.push(candidate('query', name, value, value, hint === null, hint));
  }
  for (const [name, values] of headersByInterest(Object.entries(request.headers ?? {}))) {
    const value = values.join(', ');
    candidates.push({
      ...candidate('header', name, value, value, false, null),
      transport: isTransportHeader(name),
    });
  }
  candidates.push(...bodyCandidates(request.content ?? ''));
  return candidates;
}

function candidate(
  kind: RuleCandidate['kind'],
  field: string,
  display: string,
  value: unknown,
  checked: boolean,
  hint: VolatileHint | null,
): RuleCandidate {
  return { key: `${kind}:${field}`, kind, display, field, value, checked, hint, transport: false };
}

/**
 * Cabeçalhos que todo cliente manda e raramente decidem a regra (L6, R2-L3), e os `sec-*` que o
 * navegador acrescenta sozinho.
 */
const TRANSPORT_HEADERS = new Set([
  'host',
  'content-length',
  'accept',
  'accept-encoding',
  'accept-language',
  'user-agent',
  'connection',
]);

export function isTransportHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return TRANSPORT_HEADERS.has(lower) || lower.startsWith('sec-');
}

/**
 * Os `x-*` primeiro, os de transporte por último; a ordem da mensagem fica dentro de cada grupo
 * (o painel "From this request" e a folha de F5).
 */
export function headersByInterest<T>(headers: [string, T][]): [string, T][] {
  const rank = (name: string) => {
    if (name.toLowerCase().startsWith('x-')) {
      return 0;
    }
    return isTransportHeader(name) ? 2 : 1;
  };
  return [...headers].sort(([a], [b]) => rank(a) - rank(b));
}

function bodyCandidates(content: string): RuleCandidate[] {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    json = undefined;
  }
  if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
    return Object.entries(json).map(([key, value]) => {
      const hint = volatileHint(key, value);
      return candidate('body', childPath(key), JSON.stringify(value), value, hint === null, hint);
    });
  }
  if (content === '' || new TextEncoder().encode(content).length > BODY_EQUALS_MAX_BYTES) {
    return [];
  }
  return [candidate('bodyText', 'text', content, content, false, null)];
}

/** A regra com as condições marcadas e a resposta da folha; o caminho igual ou "começa com". */
export function ruleFromCandidates(
  request: WebhookRequest,
  candidates: readonly RuleCandidate[],
  pathMode: 'equals' | 'prefix',
  response: CandidateResponse,
): Rule {
  const chosen = candidates.filter(({ checked }) => checked);
  const path = pathAfterToken(request.url, request.token_id);
  const query: Record<string, ValueMatcher> = {};
  const headers: Record<string, ValueMatcher> = {};
  const body: BodyMatcher[] = [];
  let method: string[] = [];
  let pathMatcher: PathMatcher | null = null;
  for (const item of chosen) {
    switch (item.kind) {
      case 'method':
        method = [request.method];
        break;
      case 'path':
        pathMatcher = pathMode === 'prefix' ? { prefix: path } : { equals: path };
        break;
      case 'query':
        query[item.field] = { equals: String(item.value) };
        break;
      case 'header':
        headers[item.field] = { equals: String(item.value) };
        break;
      case 'body':
        body.push({ jsonPath: { path: item.field, equals: item.value } });
        break;
      case 'bodyText':
        body.push({ equals: String(item.value) });
        break;
    }
  }
  return {
    name: `${request.method} ${path}`.slice(0, NAME_MAX_LENGTH),
    enabled: true,
    priority: RULE_DEFAULT_PRIORITY,
    match: { method, path: pathMatcher, query, headers, body },
    response: { status: response.status, headers: response.headers, body: response.body },
  };
}

/**
 * Regra que casa a mensagem sem superajustar (WM-31, CA-6): as condições que `ruleCandidates`
 * marca por padrão, caminho igual, resposta 200 vazia.
 */
export function ruleFromRequest(request: WebhookRequest): Rule {
  return ruleFromCandidates(request, ruleCandidates(request), 'equals', {
    status: RULE_DEFAULT_STATUS,
    body: '',
    headers: {},
  });
}

/**
 * O caminho que as condições enxergam (como o servidor o tira da `url` gravada): depois do
 * token, sem a query, com `%XX` decodificado (`+` fica) e `/` quando vazio.
 */
export function pathAfterToken(url: string, tokenId: string): string {
  const scheme = url.indexOf('://');
  const afterScheme = scheme < 0 ? url : url.slice(scheme + 3);
  const slash = afterScheme.indexOf('/');
  const raw = (slash < 0 ? '' : afterScheme.slice(slash)).split('?')[0];
  const afterToken = raw.startsWith(`/${tokenId}`) ? raw.slice(tokenId.length + 1) : raw;
  let path = afterToken;
  try {
    path = decodeURIComponent(afterToken);
  } catch {
    // Escape inválido: o servidor também deixa o caminho como chegou.
  }
  return path || '/';
}
