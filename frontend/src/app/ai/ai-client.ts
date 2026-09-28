import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { Rule } from '../rules/rule';

/** Razão dos controles de IA desligados: o servidor respondeu 503 "not configured". */
export const AI_OFF_HINT = $localize`This server has no local AI.`;

/**
 * A frase fixa de antes da B4, ainda usada pelo painel Explain da Entrada até ele trocar pela espera
 * do `app-ai-wait`.
 */
export const AI_WAIT_HINT = $localize`Asking the local model… The first call can take up to ~30 s while the model loads.`;

/** Documentação de como ligar a IA local, para quem opera o servidor. */
export const AI_DOCS_URL = 'https://github.com/isdiegoalves/anzol#ia-local';

/** Os dois pedidos de IA: o diagnóstico da requisição e a sugestão de regra. */
export type AiKind = 'explain' | 'suggest';

/** Segundos que cada pedido costuma levar, sem histórico neste navegador (p50 do uso real). */
const USUAL_SECONDS: Record<AiKind, number> = { explain: 9, suggest: 5 };
/** Quantas chamadas entram na mediana. */
const TIMINGS_KEPT = 5;
/** O servidor desiste do modelo em 90 s; a tela também. */
export const AI_TIMEOUT_SECONDS = 90;

const OFF_KEY = 'anzol.ai.off';
const TIMING_KEY = (kind: AiKind) => `anzol.ai.timing.${kind}`;
/** Chave da explicação guardada (guia da combinação, §4.1). */
export const EXPLANATION_KEY = (tokenId: string, requestId: string, lang: string) =>
  `anzol.ai.${tokenId}.${requestId}.${lang}`;

/** Resultado da regra contra a requisição de exemplo, com as frases do `rules/test`. */
export interface SuggestionExample {
  matches: boolean;
  failed: string[];
  conditions: string[];
}

/** Aviso do servidor sobre a regra sugerida; o conjunto de códigos é fechado. */
export interface SuggestionWarning {
  code: 'example_not_matched' | 'template_disabled' | 'path_never_seen' | 'sequence_as_single_rule';
  message: string;
}

/** A regra conferida pelo servidor, sem o modelo (DX-29). */
export interface SuggestionCheck {
  /** `null` sem requisição de exemplo. */
  example: SuggestionExample | null;
  /** A regra contra as requisições recentes (a janela do `rules/test`). */
  recent: { evaluated: number; matched: number };
  warnings: SuggestionWarning[];
}

/** Resposta de `POST /token/{id}/rules/suggest`: a regra não foi gravada. */
export interface RuleSuggestion {
  rule: Rule;
  explanation: string;
  attempts: number;
  /** Ausente em servidor anterior à conferência: a tela confere o que consegue sozinha. */
  check?: SuggestionCheck | null;
}

/** Resposta de `POST /token/{id}/request/{rid}/explain`: o texto é markdown simples. */
export interface RequestExplanation {
  explanation: string;
  facts?: Record<string, unknown>;
}

/** Explicação guardada na aba, com a hora e a duração do pedido. */
export interface KeptExplanation extends RequestExplanation {
  /** Quando a resposta chegou (ms desde a época). */
  answeredAt: number;
  seconds: number;
}

/** O pedido foi cancelado pela pessoa ("Cancel", `Esc`). */
export class AiCancelled extends Error {
  override readonly name = 'AiCancelled';
}

/** O modelo não respondeu em 90 s. */
export class AiTimedOut extends Error {
  override readonly name = 'AiTimedOut';
}

/**
 * Rotas de IA local (item 13): sugestão de regra e diagnóstico de requisição. O idioma pedido é o
 * **da tela** (Settings), não o do navegador. Um 503 (IA não configurada) desliga os controles de
 * IA pelo resto da sessão da aba: sem rota de capacidades, a sondagem é o primeiro pedido. Cada
 * pedido pode ser cancelado, e a duração dele entra na mediana que a espera mostra.
 */
@Injectable({ providedIn: 'root' })
export class AiClient {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private readonly off = signal(read(sessionStorage, OFF_KEY) === '1');
  /** O servidor respondeu 503 nesta sessão: IA desligada. */
  readonly disabled = this.off.asReadonly();

  /** O idioma escolhido na tela (o `lang` do documento, posto na carga). */
  language(): string {
    return this.document.documentElement.lang || 'en';
  }

  suggestRule(
    tokenId: string,
    prompt: string,
    requestId?: string,
    cancel?: AbortSignal,
  ): Promise<RuleSuggestion> {
    return this.call(
      'suggest',
      this.http.post<RuleSuggestion>(`/token/${tokenId}/rules/suggest`, {
        prompt,
        lang: this.language(),
        ...(requestId && { request_id: requestId }),
      }),
      cancel,
    );
  }

  /** Pede a explicação e a guarda na aba, com a hora e a duração. */
  async explain(
    tokenId: string,
    requestId: string,
    cancel?: AbortSignal,
  ): Promise<KeptExplanation> {
    const lang = this.language();
    const started = Date.now();
    const answer = await this.call(
      'explain',
      this.http.post<RequestExplanation>(`/token/${tokenId}/request/${requestId}/explain`, {
        lang,
      }),
      cancel,
    );
    const kept: KeptExplanation = {
      ...answer,
      answeredAt: Date.now(),
      seconds: secondsSince(started),
    };
    write(sessionStorage, EXPLANATION_KEY(tokenId, requestId, lang), JSON.stringify(kept));
    return kept;
  }

  /** A explicação guardada desta requisição, no idioma da tela; `null` sem nenhuma. */
  keptExplanation(tokenId: string, requestId: string): KeptExplanation | null {
    const text = read(sessionStorage, EXPLANATION_KEY(tokenId, requestId, this.language()));
    try {
      const kept = text ? (JSON.parse(text) as Partial<KeptExplanation>) : null;
      return kept && typeof kept.explanation === 'string' && typeof kept.answeredAt === 'number'
        ? (kept as KeptExplanation)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Quanto o pedido costuma levar, em segundos: a mediana das últimas 5 chamadas do mesmo tipo
   * neste navegador; sem histórico, o p50 medido (9 s no Explain, 5 s no Suggest).
   */
  usualSeconds(kind: AiKind): number {
    const timings = timingsOf(kind);
    if (timings.length === 0) {
      return USUAL_SECONDS[kind];
    }
    const sorted = [...timings].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return Math.max(1, Math.round(median));
  }

  private call<T>(kind: AiKind, request: Observable<T>, cancel?: AbortSignal): Promise<T> {
    const started = Date.now();
    return new Promise<T>((resolve, reject) => {
      if (cancel?.aborted) {
        reject(new AiCancelled());
        return;
      }
      // Cancelar a inscrição aborta o pedido no navegador.
      const timer = setTimeout(() => stop(new AiTimedOut()), AI_TIMEOUT_SECONDS * 1000);
      const subscription = request.subscribe({
        next: (answer) => {
          this.keepTiming(kind, secondsSince(started));
          finish();
          resolve(answer);
        },
        error: (error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 503) {
            this.off.set(true);
            write(sessionStorage, OFF_KEY, '1');
          }
          finish();
          // O `HttpErrorResponse` não é um `Error`: quem chama olha o status dele.
          reject(error as Error);
        },
      });
      const aborted = () => stop(new AiCancelled());
      const finish = () => {
        clearTimeout(timer);
        cancel?.removeEventListener('abort', aborted);
      };
      const stop = (reason: Error) => {
        subscription.unsubscribe();
        finish();
        reject(reason);
      };
      cancel?.addEventListener('abort', aborted);
    });
  }

  private keepTiming(kind: AiKind, seconds: number): void {
    const timings = [...timingsOf(kind), seconds].slice(-TIMINGS_KEPT);
    write(localStorage, TIMING_KEY(kind), JSON.stringify(timings));
  }
}

function secondsSince(started: number): number {
  return Math.round((Date.now() - started) / 100) / 10;
}

function timingsOf(kind: AiKind): number[] {
  try {
    const timings = JSON.parse(read(localStorage, TIMING_KEY(kind)) ?? '[]') as unknown;
    return Array.isArray(timings)
      ? timings.filter((value): value is number => typeof value === 'number' && value >= 0)
      : [];
  } catch {
    return [];
  }
}

/** Sem storage (bloqueado, cheio), a tela funciona sem o que ele guardaria. */
function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Sem espaço ou sem storage.
  }
}

/** Frases para o usuário a partir do erro de uma rota de IA. */
export function aiErrorMessages(error: unknown): string[] {
  if (error instanceof AiTimedOut) {
    return [$localize`The local model did not answer in ${AI_TIMEOUT_SECONDS}:seconds: s.`];
  }
  if (!(error instanceof HttpErrorResponse)) {
    return [$localize`The AI call failed (unknown).`];
  }
  const body = (error.error && typeof error.error === 'object' ? error.error : {}) as {
    error?: unknown;
    errors?: unknown;
  };
  const detail = typeof body.error === 'string' && body.error ? body.error : null;
  switch (error.status) {
    case 503:
      return [AI_OFF_HINT];
    case 502:
      return [
        $localize`The local model did not answer${detail ? `: ${detail}` : '.'}`,
        $localize`Check that it is running and reachable from the server, then try again.`,
      ];
    case 429:
      return [tooManyCalls(error.headers.get('Retry-After'))];
    case 422: {
      // `{"error", "errors": {chave: [msg]}}` ou só `{chave: [msg]}`, como no PUT das regras.
      const fields = fieldErrors('errors' in body ? body.errors : { ...body, error: undefined });
      return detail || fields.length === 0
        ? [detail ?? $localize`The request was not accepted.`, ...fields]
        : fields;
    }
    case 404:
    case 410:
      return [$localize`This URL or request no longer exists (${error.status}).`];
    default:
      return [$localize`The AI call failed (${error.status || 'no answer'}).`];
  }
}

/** Segundos até poder tentar de novo depois do 429 da IA; `null` sem `Retry-After` em segundos. */
export function aiRetrySeconds(error: unknown): number | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 429) {
    return null;
  }
  const retryAfter = error.headers.get('Retry-After');
  return retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
}

function tooManyCalls(retryAfter: string | null): string {
  const when = !retryAfter
    ? $localize`in a moment`
    : /^\d+$/.test(retryAfter)
      ? $localize`in ${retryAfter} s`
      : $localize`after ${retryAfter}`;
  return $localize`Too many AI calls for this URL (up to 10 per minute, one at a time). Try again ${when}.`;
}

/** `{"chave": ["msg"]}` (os erros do parser de regras) ou uma lista de frases. */
function fieldErrors(errors: unknown): string[] {
  if (Array.isArray(errors)) {
    return errors.filter((message): message is string => typeof message === 'string');
  }
  if (!errors || typeof errors !== 'object') {
    return [];
  }
  return Object.entries(errors as Record<string, unknown>).flatMap(([key, messages]) =>
    (Array.isArray(messages) ? messages : [messages])
      .filter((message): message is string => typeof message === 'string')
      .map((message) => `${key}: ${message}`),
  );
}
