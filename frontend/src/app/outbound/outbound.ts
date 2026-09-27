import { HttpErrorResponse } from '@angular/common/http';
import { WebhookRequest } from '../requests/webhook-request';
import { SIGNATURE_PROVIDER_LABELS, SignatureConfig, Token } from '../token/token';

/** Métodos que o `POST /token/{id}/send` aceita. */
export const OUTBOUND_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Timeout de conexão + resposta aceito pelo servidor, em segundos (a API recebe ms). */
export const TIMEOUT_DEFAULT_S = 10;
export const TIMEOUT_MIN_S = 1;
export const TIMEOUT_MAX_S = 30;
export const URL_MAX_LENGTH = 2048;

/** Valor de header: texto, ou a lista de valores quando o servidor a devolve assim. */
export type HeaderValues = Record<string, string | string[]>;

export type OutboundErrorKind = 'blocked' | 'dns' | 'connect' | 'timeout' | 'tls' | 'invalid_url';

/** Erro de saída: não é erro da API (vem com 200), e sim o motivo de a requisição não sair. */
export interface OutboundError {
  kind: OutboundErrorKind | string;
  message: string;
}

/**
 * Resultado de um replay ou send, como a API devolve e grava no histórico da URL. Com `error`,
 * não há `status`, `headers` nem `body`.
 */
export interface OutboundResult {
  id: string;
  kind: 'replay' | 'send';
  at: string;
  /** URL efetiva (com o caminho do replay e o `localhost` já trocado pelo servidor). */
  target: string;
  method: string;
  request_headers: HeaderValues;
  status?: number | null;
  headers?: HeaderValues | null;
  body?: string | null;
  /** Corpo da resposta cortado em 64 KB. */
  truncated?: boolean | null;
  duration_ms: number;
  error?: OutboundError | null;
  /** Mensagem reenviada (só no replay). */
  source_request?: string | null;
}

/** Corpo do `POST /token/{id}/request/{rid}/replay`. */
export interface ReplayPayload {
  url: string;
  keep_path: boolean;
  timeout: number;
}

/** Corpo do `POST /token/{id}/send`. */
export interface SendPayload {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  sign: boolean;
  timeout: number;
}

/** Requisição pronta para o diálogo Send ("Send as new…" a partir de uma mensagem). */
export interface SendDraft {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}

/** Texto para o usuário: o que houve e o que fazer. */
export interface ErrorText {
  title: string;
  detail: string;
  hint: string;
}

const ERROR_TEXTS: Record<OutboundErrorKind, Omit<ErrorText, 'detail'>> = {
  blocked: {
    title: $localize`Blocked`,
    hint: $localize`The server does not send to private, loopback or link-local addresses. For a target on your machine or network, start the server with WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true. Link-local (cloud metadata), multicast and 0.0.0.0 stay blocked.`,
  },
  dns: {
    title: $localize`DNS lookup failed`,
    hint: $localize`Check the host name of the target URL.`,
  },
  connect: {
    title: $localize`Connection failed`,
    hint: $localize`Check that the target is up and listening on that host and port.`,
  },
  timeout: {
    title: $localize`Timed out`,
    hint: $localize`The target did not answer within the timeout. Raise it (up to 30 s) or check the target.`,
  },
  tls: {
    title: $localize`TLS error`,
    hint: $localize`The target's certificate or TLS setup was refused.`,
  },
  invalid_url: {
    title: $localize`Invalid URL`,
    hint: $localize`Use an http:// or https:// URL of up to 2048 characters.`,
  },
};

/** Erro de saída (`error.kind`) em texto claro; tipo desconhecido mostra o `kind` como veio. */
export function outboundErrorText(error: OutboundError): ErrorText {
  const known = ERROR_TEXTS[error.kind as OutboundErrorKind];
  return {
    title: known?.title ?? error.kind,
    // O servidor às vezes repete o tipo no começo ("blocked: link-local address"): sai (OUTBOUND-10).
    detail: error.message.replace(new RegExp(`^${error.kind}:\\s*`, 'i'), ''),
    hint: known?.hint ?? '',
  };
}

/**
 * Erro da API ao disparar: 429 (limite por URL) com o tempo do `Retry-After`, 422 com as
 * mensagens de validação, 404/410 quando a URL ou a mensagem não existe mais.
 */
export function requestErrorText(error: unknown, now: number = Date.now()): string {
  if (!(error instanceof HttpErrorResponse)) {
    return $localize`Could not send the request.`;
  }
  if (error.status === 429) {
    return $localize`Too many sends from this URL (30 per minute). ${retryText(error.headers.get('Retry-After'), now)}`;
  }
  if (error.status === 422) {
    const messages = validationMessages(error.error);
    return messages.length > 0
      ? $localize`Invalid request: ${messages.join(' ')}`
      : $localize`Invalid request (422).`;
  }
  if (error.status === 404 || error.status === 410) {
    return $localize`This URL or request no longer exists (${error.status}).`;
  }
  return $localize`Could not send the request (${error.status || 'no response'}).`;
}

/** `Retry-After` em segundos ou data HTTP (RFC 9110 §10.2.3). */
function retryText(retryAfter: string | null, now: number): string {
  if (retryAfter !== null && /^\d+$/.test(retryAfter.trim())) {
    return $localize`Try again in ${Number(retryAfter.trim())} s.`;
  }
  const date = retryAfter === null ? NaN : Date.parse(retryAfter);
  if (!Number.isNaN(date)) {
    return $localize`Try again in ${Math.max(0, Math.ceil((date - now) / 1000))} s.`;
  }
  return $localize`Try again in a minute.`;
}

/** `{campo: [mensagens]}` (como o resto da API) ou `{message}`; o resto não vira texto. */
function validationMessages(body: unknown): string[] {
  if (!body || typeof body !== 'object') {
    return typeof body === 'string' && body !== '' ? [body] : [];
  }
  return Object.values(body as Record<string, unknown>).flatMap((value) =>
    Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : [],
  );
}

/** Headers em linhas `[nome, valor]`; lista de valores vira um texto separado por vírgula. */
export function headerEntries(headers: HeaderValues | null | undefined): [string, string][] {
  return Object.entries(headers ?? {}).map(([name, value]) => [
    name,
    Array.isArray(value) ? value.join(', ') : value,
  ]);
}

/**
 * Headers que o servidor tira no replay (§1): o "Send as new…" também não os leva, porque
 * descrevem a conexão original e não a requisição.
 */
export function isHopHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    HOP_HEADERS.has(lower) ||
    lower.startsWith('proxy-') ||
    lower.startsWith('x-forwarded-') ||
    lower.startsWith('cf-')
  );
}

const HOP_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'x-real-ip',
]);

/** Headers que carregam uma assinatura de provedor (e o horário que o Slack assina junto). */
const SIGNATURE_HEADERS = new Set([
  'stripe-signature',
  'x-hub-signature-256',
  'x-shopify-hmac-sha256',
  'x-slack-signature',
  'x-slack-request-timestamp',
]);

/**
 * "Send as new with a fresh signature": a mensagem como no "Send as new…", sem os headers da
 * assinatura velha (o de provedor e, no genérico, o da URL); o servidor põe os novos ao assinar.
 */
export function resignedDraft(request: WebhookRequest, url: string, token: Token): SendDraft {
  const generic = token.signature?.header?.toLowerCase();
  const draft = draftFromRequest(request, url);
  return {
    ...draft,
    headers: draft.headers.filter(([name]) => {
      const lower = name.toLowerCase();
      return !SIGNATURE_HEADERS.has(lower) && lower !== generic;
    }),
  };
}

/** "Send as new…": método, headers (sem os de conexão) e corpo da mensagem; a URL é o alvo. */
export function draftFromRequest(request: WebhookRequest, url: string): SendDraft {
  const method = request.method.toUpperCase();
  return {
    method: OUTBOUND_METHODS.includes(method) ? method : 'POST',
    url,
    headers: Object.entries(request.headers)
      .filter(([name]) => !isHopHeader(name))
      .map(([name, values]) => [name, values.join(', ')]),
    body: request.content ?? '',
  };
}

/**
 * Caminho depois do token e query da mensagem, como o replay com "Keep path" acrescenta ao
 * alvo (`/pedidos?x=1`); vazio quando a mensagem chegou na raiz da URL.
 */
export function pathSuffix(request: WebhookRequest): string {
  const scheme = request.url.indexOf('://');
  const afterScheme = scheme < 0 ? request.url : request.url.slice(scheme + 3);
  const slash = afterScheme.indexOf('/');
  const pathAndQuery = slash < 0 ? '' : afterScheme.slice(slash);
  const prefix = `/${request.token_id}`;
  return pathAndQuery.startsWith(prefix) ? pathAndQuery.slice(prefix.length) : pathAndQuery;
}

/**
 * `at` no "Y-m-d H:i:s" UTC do resto da API, que as funções de data da tela leem; aceita também
 * ISO-8601 (`2026-09-26T10:00:00.123Z`, com ou sem fuso).
 */
export function apiDate(at: string): string {
  if (!/[TZz+]/.test(at.slice(10))) {
    return at;
  }
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Tolerância padrão do timestamp assinado (a da Stripe e a do Slack), em segundos. */
export const DEFAULT_TOLERANCE_S = 300;

/** Assinatura com timestamp velho demais para um replay passar na verificação do receptor. */
export interface StaleSignature {
  /** Provedor que assinou com o timestamp ("Stripe", "Slack"). */
  provider: string;
  /** Idade do timestamp assinado, em segundos. */
  age: number;
  /** Tolerância que vale: a da URL, se ela verifica esse provedor; senão a padrão (300 s). */
  tolerance: number;
  /** O horário assinado como chegou ("t=1790438402", "X-Slack-Request-Timestamp: 1790438402"). */
  signed: string;
}

/**
 * O replay reenvia os headers como chegaram: a Stripe (`t=` do `Stripe-Signature`) e o Slack
 * (`X-Slack-Request-Timestamp`) assinam o horário junto, e um receptor que confere o horário
 * recusa o reenvio depois da tolerância. Devolve a assinatura velha, ou `null` se não há.
 */
export function staleSignature(
  request: WebhookRequest,
  token: Token | null,
  now: number = Date.now(),
): StaleSignature | null {
  const header = (name: string) => request.headers[name]?.[0] ?? null;
  const stripe = /(?:^|,)\s*t=(\d+)/.exec(header('stripe-signature') ?? '')?.[1];
  const slack = /^\d+$/.exec(header('x-slack-request-timestamp') ?? '')?.[0];
  const signed = stripe
    ? { provider: 'stripe' as const, at: Number(stripe) }
    : slack
      ? { provider: 'slack' as const, at: Number(slack) }
      : null;
  if (!signed) {
    return null;
  }
  const config = token?.signature?.provider === signed.provider ? token.signature : null;
  const tolerance = config?.toleranceSeconds ?? DEFAULT_TOLERANCE_S;
  const age = Math.floor(now / 1000) - signed.at;
  const shown =
    signed.provider === 'stripe' ? `t=${signed.at}` : `X-Slack-Request-Timestamp: ${signed.at}`;
  return age > tolerance
    ? { provider: SIGNATURE_PROVIDER_LABELS[signed.provider], age, tolerance, signed: shown }
    : null;
}

/** Idade em texto curto: "45 s", "12 min", "5 h", "3 days". */
export function ageText(seconds: number): string {
  if (seconds < 120) {
    return `${seconds} s`;
  }
  if (seconds < 7200) {
    return `${Math.floor(seconds / 60)} min`;
  }
  if (seconds < 172_800) {
    return `${Math.floor(seconds / 3600)} h`;
  }
  return $localize`${Math.floor(seconds / 86_400)}:count: days`;
}

/** Texto entre aspas simples para o shell (a aspa simples vira `'\''`). */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * "Copy as curl" do resultado (OUTBOUND-08): o método, o alvo efetivo, os headers enviados e o
 * corpo (quando a tela o conhece), um argumento por linha.
 */
export function curlOf(
  method: string,
  target: string,
  headers: HeaderValues | null | undefined,
  body: string | null,
): string {
  return [
    `curl -X ${method} ${shellQuote(target)}`,
    ...headerEntries(headers).map(([name, value]) => `  -H ${shellQuote(`${name}: ${value}`)}`),
    ...(body ? [`  --data-raw ${shellQuote(body)}`] : []),
  ].join(' \\\n');
}

/** O header que "Sign with this URL's signature" acrescenta, como o provedor o manda (OUTBOUND-07). */
export function signedHeaderHint(signature: SignatureConfig): string {
  switch (signature.provider) {
    case 'stripe':
      return 'Stripe-Signature: t=…,v1=…';
    case 'github':
      return 'X-Hub-Signature-256: sha256=…';
    case 'shopify':
      return 'X-Shopify-Hmac-Sha256: …';
    case 'slack':
      return 'X-Slack-Signature: v0=… + X-Slack-Request-Timestamp';
    default:
      return `${signature.header ?? 'X-Signature'}: ${signature.prefix ?? ''}…`;
  }
}

/** Como repetir um disparo ("Run again"): o mesmo replay ou o mesmo send. */
export type Repeat =
  | { kind: 'replay'; requestId: string; payload: ReplayPayload }
  | { kind: 'send'; payload: SendPayload };
