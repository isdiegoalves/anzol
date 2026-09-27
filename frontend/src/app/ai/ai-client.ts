import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { Rule } from '../rules/rule';

/** Dica mostrada com os controles de IA desligados (o servidor respondeu 503). */
export const AI_OFF_HINT = $localize`Set WEBHOOK_AI_* to enable`;

/** Enquanto a chamada roda: o modelo local pode levar ~30 s para carregar na primeira vez. */
export const AI_WAIT_HINT = $localize`Asking the local model… The first call can take up to ~30 s while the model loads.`;

/** Resposta de `POST /token/{id}/rules/suggest`: a regra não foi gravada. */
export interface RuleSuggestion {
  rule: Rule;
  explanation: string;
  attempts: number;
}

/** Resposta de `POST /token/{id}/request/{rid}/explain`: o texto é markdown simples. */
export interface RequestExplanation {
  explanation: string;
  facts?: Record<string, unknown>;
}

/**
 * Rotas de IA local (item 13): sugestão de regra e diagnóstico de mensagem. O idioma pedido é o
 * do navegador. Um 503 (IA não configurada no servidor) desliga os controles de IA da tela até
 * recarregar a página.
 */
@Injectable({ providedIn: 'root' })
export class AiClient {
  private readonly http = inject(HttpClient);
  private readonly lang = inject(DOCUMENT).defaultView?.navigator.language || 'en';

  private readonly off = signal(false);
  /** O servidor respondeu 503: IA desligada. */
  readonly disabled = this.off.asReadonly();

  suggestRule(tokenId: string, prompt: string, requestId?: string): Promise<RuleSuggestion> {
    return this.call(
      this.http.post<RuleSuggestion>(`/token/${tokenId}/rules/suggest`, {
        prompt,
        lang: this.lang,
        ...(requestId && { request_id: requestId }),
      }),
    );
  }

  explain(tokenId: string, requestId: string): Promise<RequestExplanation> {
    return this.call(
      this.http.post<RequestExplanation>(`/token/${tokenId}/request/${requestId}/explain`, {
        lang: this.lang,
      }),
    );
  }

  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 503) {
        this.off.set(true);
      }
      throw error;
    }
  }
}

/** Frases para o usuário a partir do erro de uma rota de IA. */
export function aiErrorMessages(error: unknown): string[] {
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
      return [$localize`AI is not configured on this server. ${AI_OFF_HINT}.`];
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
