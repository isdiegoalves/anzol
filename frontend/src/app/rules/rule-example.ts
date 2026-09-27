import { FieldValue, WebhookRequest } from '../requests/webhook-request';
import { pathAfterToken } from './rule-from-request';

// A mensagem de exemplo no editor (WM-16, E-12): os campos que viram condição com um clique e o
// testador aproximado de regex e JSONPath. Funções puras; o servidor continua sendo o juiz (a aba
// Test roda a regra de verdade), então o que sai daqui é sempre "approx.".

/** Um campo da mensagem que vira condição (Match) ou helper do template (Response). */
export interface ExampleField {
  kind: 'header' | 'query' | 'body';
  /** Nome do cabeçalho (como gravado), da query, ou o JSONPath do corpo (`$.a.b[0]`). */
  path: string;
  /** Como o botão mostra o valor: texto cru em cabeçalho e query, literal JSON no corpo. */
  display: string;
  /** O valor da condição: texto em cabeçalho e query, o valor JSON no corpo. */
  value: unknown;
}

/** Teto de campos no painel e profundidade no corpo (guia §3.3). */
export const EXAMPLE_MAX_FIELDS = 60;
const BODY_MAX_DEPTH = 4;

function text(value: FieldValue | undefined): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
}

/** Cabeçalhos, query e folhas do corpo JSON (até 4 níveis), no máximo 60 ao todo. */
export function exampleFields(request: WebhookRequest): ExampleField[] {
  const fields: ExampleField[] = [];
  for (const [name, values] of byInterest(Object.entries(request.headers ?? {}))) {
    const value = values.join(', ');
    fields.push({ kind: 'header', path: name, display: value, value });
  }
  for (const [name, raw] of Object.entries(request.query ?? {})) {
    const value = text(raw);
    fields.push({ kind: 'query', path: name, display: value, value });
  }
  const body = parseJson(request.content ?? '');
  if (body.ok && typeof body.value === 'object' && body.value !== null) {
    collectLeaves(body.value, '$', 1, fields);
  }
  return fields.slice(0, EXAMPLE_MAX_FIELDS);
}

/** Cabeçalhos que todo cliente manda e raramente decidem a regra (L6). */
const TRANSPORT_HEADERS = new Set([
  'host',
  'content-length',
  'accept',
  'accept-encoding',
  'user-agent',
  'connection',
]);

/** Os `x-*` primeiro, os de transporte por último; a ordem da mensagem fica dentro de cada grupo. */
function byInterest<T>(headers: [string, T][]): [string, T][] {
  const rank = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('x-')) {
      return 0;
    }
    return TRANSPORT_HEADERS.has(lower) ? 2 : 1;
  };
  return [...headers].sort(([a], [b]) => rank(a) - rank(b));
}

function collectLeaves(value: object, path: string, depth: number, into: ExampleField[]): void {
  const entries = Array.isArray(value)
    ? value.map((child, index): [string, unknown] => [`${path}[${index}]`, child])
    : Object.entries(value).map(([key, child]): [string, unknown] => [childPath(path, key), child]);
  for (const [childPathText, child] of entries) {
    if (into.length >= EXAMPLE_MAX_FIELDS) {
      return;
    }
    if (typeof child === 'object' && child !== null) {
      if (depth < BODY_MAX_DEPTH) {
        collectLeaves(child, childPathText, depth + 1, into);
      }
    } else {
      into.push({
        kind: 'body',
        path: childPathText,
        display: JSON.stringify(child),
        value: child,
      });
    }
  }
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${path}.${key}` : `${path}['${key}']`;
}

/** O caminho da mensagem como a condição o vê (depois do token). */
export function examplePath(request: WebhookRequest): string {
  return pathAfterToken(request.url, request.token_id);
}

/** Valor do cabeçalho na mensagem (nome sem caixa, `_` vale `-`), vários juntos por vírgula. */
export function exampleHeader(request: WebhookRequest, name: string): string | null {
  const wanted = name.trim().toLowerCase().replaceAll('_', '-');
  const entry = Object.entries(request.headers ?? {}).find(
    ([header]) => header.toLowerCase() === wanted,
  );
  return entry ? entry[1].join(', ') : null;
}

export function exampleQuery(request: WebhookRequest, name: string): string | null {
  const value = request.query?.[name];
  return value === undefined ? null : text(value);
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

function parseJson(content: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(content) as unknown };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Construções fora do que dá para conferir aqui com segurança (a regex do servidor é Java). */
const UNSAFE_REGEX = /\(\?|\\[1-9kpPQEGAzZbB]|[*+?}]\+|\[\[|&&|\\u\{/;

/**
 * A regex casa o valor inteiro, como no servidor (`DOT_MATCHES_ALL`)? `null` fora do subconjunto
 * seguro (lookaround, retrovisor, possessivo, classes Unicode…) ou regex inválida.
 */
export function regexMatches(pattern: string, value: string): boolean | null {
  if (pattern.length > 500 || UNSAFE_REGEX.test(pattern)) {
    return null;
  }
  try {
    return new RegExp(`^(?:${pattern})$`, 's').test(value);
  } catch {
    return null;
  }
}

/** Segmentos de um JSONPath simples (`$.a.b[0]`, `$['x y']`); `null` fora dele. */
function simplePath(path: string): (string | number)[] | null {
  if (!path.startsWith('$')) {
    return null;
  }
  const segments: (string | number)[] = [];
  const token = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]|\['([^'\\]*)'\]/y;
  token.lastIndex = 1;
  while (token.lastIndex < path.length) {
    const start = token.lastIndex;
    const found = token.exec(path);
    if (!found || found.index !== start) {
      return null;
    }
    segments.push(found[2] === undefined ? (found[1] ?? found[3]) : Number(found[2]));
  }
  return segments;
}

/** O que o JSONPath simples acha no corpo JSON da mensagem; `unsupported` fora do simples. */
export type PathLookup =
  { kind: 'found'; value: unknown } | { kind: 'missing' } | { kind: 'unsupported' };

export function valueAtPath(content: string, path: string): PathLookup {
  const segments = simplePath(path.trim());
  const body = parseJson(content);
  if (!segments || !body.ok) {
    return segments ? { kind: 'missing' } : { kind: 'unsupported' };
  }
  let current: unknown = body.value;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      return { kind: 'missing' };
    }
    current = (current as Record<string | number, unknown>)[segment];
  }
  return { kind: 'found', value: current };
}

/** Como o "Equals (JSON)" lê o texto: JSON quando é JSON, senão o próprio texto. */
export type ReadAs =
  { kind: 'text'; text: string } | { kind: 'number'; text: string } | { kind: 'json' };

export function readAs(input: string): ReadAs | null {
  if (input.trim() === '') {
    return null;
  }
  const parsed = parseJson(input);
  if (!parsed.ok || typeof parsed.value === 'string') {
    return { kind: 'text', text: parsed.ok ? (parsed.value as string) : input };
  }
  return typeof parsed.value === 'number'
    ? { kind: 'number', text: String(parsed.value) }
    : { kind: 'json' };
}

/** Linha do erro de um corpo que parece JSON (começa com `{` ou `[`); `null` se é JSON válido ou não parece. */
export function jsonErrorLine(body: string): number | null {
  const trimmed = body.trim();
  if (!/^[[{]/.test(trimmed)) {
    return null;
  }
  const parsed = parseJson(body);
  if (parsed.ok) {
    return null;
  }
  const line = /line (\d+)/.exec(parsed.error);
  if (line) {
    return Number(line[1]);
  }
  const position = /position (\d+)/.exec(parsed.error);
  const at = position ? Number(position[1]) : body.length;
  return body.slice(0, at).split('\n').length;
}

/**
 * O corpo é JSON (objeto ou lista)? Com template, os `{{…}}` valem um valor qualquer: é o JSON que
 * sai depois de renderizado.
 */
export function isJsonBody(body: string, template: boolean): boolean {
  const source = template ? body.replace(/\{\{[^}]*\}\}/g, '0') : body;
  const parsed = parseJson(source);
  return parsed.ok && typeof parsed.value === 'object' && parsed.value !== null;
}
