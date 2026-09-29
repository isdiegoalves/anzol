import { RetryWait, fixedRetryAfter, retryWait, secondsBetween } from '../pipeline/retry-wait';
import { CapturedRequest, WebhookRequest, signatureState } from './webhook-request';

/**
 * A chave do evento (E1, UX-40): o nome de um cabeçalho (`x-loja-event-id`) ou um JSONPath do corpo
 * (`$.id`) cujo valor identifica o evento. Escolhida pela pessoa e guardada só no navegador.
 */
export type EventKey = string;

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const JSON_PATH = /^\$(\.[A-Za-z_$][\w$-]*|\[\d+\])+$/;
const FIELD = /^[A-Za-z_$][\w$-]*$/;
const SEGMENT = /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]/g;
/** Corpo acima disto não é lido na lista (o parse custaria a cada linha desenhada). */
const BODY_MAX = 100_000;
/** Cabeçalhos do transporte: repetem entre requisições sem dizer nada do evento. */
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

/** Um nome de cabeçalho ou um JSONPath como `$.id` (sem filtro nem curinga). */
export function isEventKey(text: string): boolean {
  const key = text.trim();
  return key.startsWith('$') ? JSON_PATH.test(key) : HEADER_NAME.test(key);
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

/** Um campo que parece identificar o evento, com quantos valores diferentes e um exemplo. */
export interface KeyCandidate {
  key: EventKey;
  values: number;
  example: string;
}

/**
 * Os campos que a oferta propõe: cabeçalhos (fora os do transporte) e campos de primeiro nível do
 * corpo cujo valor se repete em 2 ou mais requisições, em pelo menos 3 valores diferentes. O que
 * repete mais vem primeiro; no empate, o cabeçalho.
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
      if (!TRANSPORT.has(name)) {
        add(name, eventValueOf(request, name));
      }
    }
    const body = jsonBody(request);
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
      for (const [field, value] of Object.entries(body)) {
        if (FIELD.test(field)) {
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
        b.repeated - a.repeated ||
        Number(isBodyKey(a.key)) - Number(isBodyKey(b.key)) ||
        a.key.localeCompare(b.key),
    )
    .map(({ key, values, example }) => ({ key, values, example: example ?? '' }));
}

/** Quantos eventos (valores diferentes da chave) há nas requisições. */
export function eventCount(requests: readonly CapturedRequest[], key: EventKey): number {
  return new Set(
    requests.map((request) => eventValueOf(request, key)).filter((value) => value !== null),
  ).size;
}

/** Uma entrada da lista agrupada: a requisição solta, ou o evento com 2 ou mais tentativas. */
export type Grouped =
  | { kind: 'request'; request: WebhookRequest; value: string | null }
  | {
      kind: 'event';
      value: string;
      /** As tentativas carregadas, da mais antiga para a mais nova. */
      attempts: WebhookRequest[];
      /** As que a lista mostra (casam com o filtro); sem filtro, todas. */
      matching: ReadonlySet<string>;
    };

/** Ordem de chegada: a hora gravada e, no mesmo segundo, a `seq` (só para ordenar). */
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

/** Um selo da trilha de respostas. */
export interface TrailSeal {
  /** O status respondido, ou "—" na falha de rede e na resposta sem registro. */
  text: string;
  /** Quantas tentativas iguais seguidas o selo resume (acima de 8 tentativas). */
  count: number;
  /** Assinatura ou schema inválido em alguma delas. */
  mark: boolean;
  fault: boolean;
  /** A resposta que vale agora. */
  last: boolean;
}

/** Acima disto, as sequências iguais da trilha viram "429 ×14". */
const TRAIL_MAX = 8;

function troubled(request: CapturedRequest): boolean {
  const signature = request.signature;
  return (
    (!!signature && signatureState(signature) === 'invalid') || request.schema?.valid === false
  );
}

/** A trilha das respostas, da mais antiga para a mais nova. */
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

/** O intervalo de uma tentativa desde a anterior, e a conferência contra a espera pedida. */
export interface AttemptWait {
  gap: number | null;
  /** O veredito; `null` sem `Retry-After` fixo na resposta anterior. */
  wait: RetryWait | null;
  /** A resposta anterior pedia uma espera que não é um número fixo de segundos. */
  notFixed: boolean;
}

/**
 * O intervalo de cada tentativa (a primeira não tem) e a conferência contra o `Retry-After` que a
 * resposta anterior pedia, pela configuração de agora (`askedBy`).
 */
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
