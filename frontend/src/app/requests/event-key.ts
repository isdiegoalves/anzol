import { RetryWait, fixedRetryAfter, retryWait, secondsBetween } from '../pipeline/retry-wait';
import { CapturedRequest, WebhookRequest, signatureState } from './webhook-request';

/** O nome de um cabeçalho (`x-loja-event-id`) ou um JSONPath do corpo (`$.id`). */
export type EventKey = string;

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const JSON_PATH = /^\$(\.[A-Za-z_$][\w$-]*|\[\d+\])+$/;
const FIELD = /^[A-Za-z_$][\w$-]*$/;
const SEGMENT = /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]/g;
/** Corpo acima disto não é lido na lista (o parse custaria a cada linha desenhada). */
const BODY_MAX = 100_000;
/** Repetem entre requisições sem dizer nada do evento. */
const TRANSPORT = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'origin',
  'pragma',
  'referer',
  'user-agent',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
]);
/**
 * Repetem entre as tentativas de um evento sem o identificar: a assinatura e a data se repetem com o
 * mesmo corpo, e o número da tentativa, entre eventos.
 */
const NOT_A_KEY = new Set([
  'signature',
  'assinatura',
  'sig',
  'hmac',
  'digest',
  'authorization',
  'token',
  'secret',
  'date',
  'time',
  'timestamp',
  'nonce',
  'attempt',
  'tentativa',
  'retry',
  'length',
]);
const ID_LIKE = /(^|[_.$-])((event|evento|delivery|message|webhook)[_-]?)?id$|idempotency/i;

/** JSONPath sem filtro nem curinga. */
export function isEventKey(text: string): boolean {
  const key = text.trim();
  return key.startsWith('$') ? JSON_PATH.test(key) : HEADER_NAME.test(key);
}

/** Por partes do nome: `update_id` é chave, `x-hub-signature-256` não. */
function notAKey(name: string): boolean {
  return name
    .toLowerCase()
    .split(/[-_.]+/)
    .some((part) => NOT_A_KEY.has(part));
}

export function isBodyKey(key: EventKey): boolean {
  return key.startsWith('$');
}

const bodies = new WeakMap<CapturedRequest, unknown>();

/** O corpo JSON, lido uma vez por requisição; `undefined` se não é JSON (ou é grande demais). */
function jsonBody(request: CapturedRequest): unknown {
  if (bodies.has(request)) {
    return bodies.get(request);
  }
  const content = request.content?.trimStart() ?? '';
  let body: unknown;
  if (content.length <= BODY_MAX && (content.startsWith('{') || content.startsWith('['))) {
    try {
      body = JSON.parse(content);
    } catch {
      body = undefined;
    }
  }
  bodies.set(request, body);
  return body;
}

function scalar(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return typeof value === 'string' && value !== '' ? value : null;
}

/** O valor da chave nesta requisição; `null` sem o campo (ou com um objeto no lugar). */
export function eventValueOf(request: CapturedRequest, key: EventKey): string | null {
  if (!isBodyKey(key)) {
    const wanted = key.toLowerCase();
    const name = Object.keys(request.headers ?? {}).find((h) => h.toLowerCase() === wanted);
    return name === undefined ? null : scalar(request.headers[name]?.[0]);
  }
  let node = jsonBody(request);
  for (const [, field, index] of key.slice(1).matchAll(SEGMENT)) {
    if (node === null || typeof node !== 'object') {
      return null;
    }
    node =
      field === undefined
        ? (node as unknown[])[Number(index)]
        : (node as Record<string, unknown>)[field];
  }
  return scalar(node);
}

export interface KeyCandidate {
  key: EventKey;
  values: number;
  example: string;
}

/**
 * Os campos que a oferta propõe: cabeçalhos (fora os do transporte, de assinatura, de data e de
 * tentativa) e campos de primeiro nível do corpo cujo valor se repete em 2 ou mais requisições, em
 * pelo menos 3 valores diferentes. Nome de id vem primeiro; depois, o que repete mais; no empate, o
 * cabeçalho.
 */
export function keyCandidates(requests: readonly CapturedRequest[]): KeyCandidate[] {
  const counts = new Map<EventKey, Map<string, number>>();
  const add = (key: EventKey, value: string | null) => {
    if (value === null) {
      return;
    }
    const byValue = counts.get(key) ?? new Map<string, number>();
    byValue.set(value, (byValue.get(value) ?? 0) + 1);
    counts.set(key, byValue);
  };
  for (const request of requests) {
    const names = new Set(Object.keys(request.headers ?? {}).map((name) => name.toLowerCase()));
    for (const name of names) {
      if (!TRANSPORT.has(name) && !notAKey(name)) {
        add(name, eventValueOf(request, name));
      }
    }
    const body = jsonBody(request);
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
      for (const [field, value] of Object.entries(body)) {
        if (FIELD.test(field) && !notAKey(field)) {
          add(`$.${field}`, typeof value === 'object' ? null : scalar(value));
        }
      }
    }
  }
  return [...counts]
    .map(([key, byValue]) => {
      const repeated = [...byValue].filter(([, count]) => count >= 2);
      repeated.sort((a, b) => b[1] - a[1]);
      return { key, values: byValue.size, repeated: repeated.length, example: repeated[0]?.[0] };
    })
    .filter((candidate) => candidate.repeated >= 3)
    .sort(
      (a, b) =>
        Number(ID_LIKE.test(b.key)) - Number(ID_LIKE.test(a.key)) ||
        b.repeated - a.repeated ||
        Number(isBodyKey(a.key)) - Number(isBodyKey(b.key)) ||
        a.key.localeCompare(b.key),
    )
    .map(({ key, values, example }) => ({ key, values, example: example ?? '' }));
}

export function eventCount(requests: readonly CapturedRequest[], key: EventKey): number {
  return new Set(
    requests.map((request) => eventValueOf(request, key)).filter((value) => value !== null),
  ).size;
}

/** O evento tem 2 ou mais tentativas; com uma só, a requisição fica solta. */
export type Grouped =
  | { kind: 'request'; request: WebhookRequest; value: string | null }
  | {
      kind: 'event';
      value: string;
      attempts: WebhookRequest[];
      /** As que casam com o filtro; sem filtro, todas. */
      matching: ReadonlySet<string>;
    };

/** A `seq` só desempata no mesmo segundo. */
export function chronological(a: WebhookRequest, b: WebhookRequest): number {
  return a.created_at.localeCompare(b.created_at) || (a.seq ?? 0) - (b.seq ?? 0);
}

/**
 * A lista agrupada pela chave, na ordem de `shown` (o que a lista mostra): cada evento entra no lugar
 * da primeira tentativa dele que aparece, e a requisição sem o campo fica solta, no lugar dela. As
 * tentativas vêm de `context` (as carregadas sem filtro) e de `shown`: com filtro, a trilha é a
 * inteira, e `matching` diz quais casam.
 */
export function groupByEvent(
  shown: readonly WebhookRequest[],
  context: readonly WebhookRequest[],
  key: EventKey,
): Grouped[] {
  const byValue = new Map<string, WebhookRequest[]>();
  const seen = new Set<string>();
  for (const request of [...context, ...shown]) {
    const value = eventValueOf(request, key);
    if (value !== null && !seen.has(request.uuid)) {
      seen.add(request.uuid);
      byValue.set(value, [...(byValue.get(value) ?? []), request]);
    }
  }
  const matching = new Set(shown.map((request) => request.uuid));
  const placed = new Set<string>();
  const grouped: Grouped[] = [];
  for (const request of shown) {
    const value = eventValueOf(request, key);
    if (value === null) {
      grouped.push({ kind: 'request', request, value });
    } else if (!placed.has(value)) {
      placed.add(value);
      const attempts = [...(byValue.get(value) ?? [request])].sort(chronological);
      grouped.push(
        attempts.length < 2
          ? { kind: 'request', request, value }
          : {
              kind: 'event',
              value,
              attempts,
              matching: new Set(attempts.filter((a) => matching.has(a.uuid)).map((a) => a.uuid)),
            },
      );
    }
  }
  return grouped;
}

export interface TrailSeal {
  text: string;
  /** Quantas tentativas iguais seguidas o selo resume. */
  count: number;
  mark: boolean;
  fault: boolean;
  last: boolean;
}

const TRAIL_MAX = 8;

function troubled(request: CapturedRequest): boolean {
  const signature = request.signature;
  return (
    (!!signature && signatureState(signature) === 'invalid') || request.schema?.valid === false
  );
}

export function trailOf(attempts: readonly CapturedRequest[]): TrailSeal[] {
  const seals = attempts.map((request, i): TrailSeal => {
    const status = request.response?.status;
    return {
      text: status === undefined ? '—' : String(status),
      count: 1,
      mark: troubled(request),
      fault: !!request.response?.fault,
      last: i === attempts.length - 1,
    };
  });
  if (seals.length <= TRAIL_MAX) {
    return seals;
  }
  return seals.reduce<TrailSeal[]>((trail, seal) => {
    const previous = trail[trail.length - 1];
    if (previous && previous.text === seal.text && previous.mark === seal.mark) {
      return [...trail.slice(0, -1), { ...previous, count: previous.count + 1, last: seal.last }];
    }
    return [...trail, seal];
  }, []);
}

export interface AttemptWait {
  gap: number | null;
  /** `null` sem `Retry-After` fixo na resposta anterior. */
  wait: RetryWait | null;
  notFixed: boolean;
}

/** O `Retry-After` vem da configuração de agora (`askedBy`), não do que foi respondido. */
export function waitsOf(
  attempts: readonly CapturedRequest[],
  askedBy: (answer: CapturedRequest) => unknown,
): (AttemptWait | null)[] {
  return attempts.map((request, i) => {
    const previous = attempts[i - 1];
    if (!previous) {
      return null;
    }
    const asked = previous.response?.fault ? null : askedBy(previous);
    return {
      gap: secondsBetween(previous.created_at, request.created_at),
      wait: retryWait(previous.created_at, request.created_at, asked),
      notFixed:
        asked !== null && asked !== undefined && asked !== '' && fixedRetryAfter(asked) === null,
    };
  });
}
