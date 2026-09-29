import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RequestPage, WebhookRequest } from '../requests/webhook-request';
import {
  OutboundResult,
  ReplayPayload,
  Repeat,
  SendPayload,
  TIMEOUT_DEFAULT_S,
  requestedChaos,
} from './outbound';

/** O servidor guarda as últimas 50 respostas de cada URL. */
const HISTORY_SIZE = 50;

/**
 * Saída pelo servidor: replay de mensagem, send montado na tela e o histórico da URL. Cada
 * disparo feito pela tela entra na hora no topo do histórico carregado, se for da mesma URL.
 */
@Injectable({ providedIn: 'root' })
export class OutboundStore {
  private readonly http = inject(HttpClient);

  readonly tokenId = signal<string | null>(null);
  /** Mais novo primeiro, como a API devolve. */
  readonly history = signal<readonly OutboundResult[]>([]);
  /** O que cada disparo feito nesta tela mandou: o "Run again" repete igual (o send traz o corpo). */
  private readonly repeats = new Map<string, Repeat>();

  async load(tokenId: string): Promise<void> {
    this.tokenId.set(tokenId);
    this.history.set([]);
    this.history.set(
      await firstValueFrom(this.http.get<OutboundResult[]>(`/token/${tokenId}/outbound`)),
    );
  }

  async replay(
    tokenId: string,
    requestId: string,
    payload: ReplayPayload,
  ): Promise<OutboundResult> {
    const result = await firstValueFrom(
      this.http.post<OutboundResult>(
        `/token/${encodeURIComponent(tokenId)}/request/${encodeURIComponent(requestId)}/replay`,
        payload,
      ),
    );
    this.repeats.set(result.id, { kind: 'replay', requestId, payload });
    this.record(tokenId, result);
    return result;
  }

  async send(tokenId: string, payload: SendPayload): Promise<OutboundResult> {
    const result = await firstValueFrom(
      this.http.post<OutboundResult>(`/token/${tokenId}/send`, payload),
    );
    this.repeats.set(result.id, { kind: 'send', payload });
    this.record(tokenId, result);
    return result;
  }

  /**
   * Como repetir o disparo: o que esta tela mandou; ou, no replay do histórico, a mesma mensagem
   * para o alvo efetivo (que já traz o caminho), com o mesmo caos. O send do histórico não guarda
   * o corpo: `null`.
   */
  repeatOf(result: OutboundResult): Repeat | null {
    const known = this.repeats.get(result.id);
    if (known) {
      return known;
    }
    const source = result.source_request;
    if (result.kind !== 'replay' || !isRequestId(source)) {
      return null;
    }
    const chaos = result.chaos;
    // O histórico não guarda o timeout do replay, e o servidor recusa desistência que não fique
    // abaixo dele; com a desistência pedida, o timeout nunca chega a valer.
    const timeout = Math.max(TIMEOUT_DEFAULT_S * 1000, (chaos?.timeout_ms ?? 0) + 1);
    return {
      kind: 'replay',
      requestId: source,
      payload: {
        url: result.target,
        keep_path: false,
        timeout,
        ...(chaos ? { chaos: requestedChaos(chaos) } : {}),
      },
    };
  }

  /** "Run again": repete o replay ou o send; o resultado novo entra no topo do histórico. */
  runAgain(tokenId: string, result: OutboundResult): Promise<OutboundResult> {
    const repeat = this.repeatOf(result);
    if (!repeat) {
      return Promise.reject(new Error('This send cannot be repeated from here.'));
    }
    return repeat.kind === 'replay'
      ? this.replay(tokenId, repeat.requestId, repeat.payload)
      : this.send(tokenId, repeat.payload);
  }

  /** O corpo que o send desta tela mandou (o "Copy as curl" o leva); `null` se não se sabe. */
  sentBody(result: OutboundResult): string | null {
    const repeat = this.repeats.get(result.id);
    return repeat?.kind === 'send' ? repeat.payload.body : null;
  }

  /** Mensagens da primeira página da URL (as 50 mais novas): o seletor do Replay. */
  async recent(tokenId: string): Promise<WebhookRequest[]> {
    const page = await firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
        params: { page: 1, sorting: 'newest' },
      }),
    );
    return page.data;
  }

  /** Uma mensagem da URL; id que não é UUID nem vai ao servidor (`?replay=../../share/x`). */
  request(tokenId: string, requestId: string): Promise<WebhookRequest> {
    if (!isRequestId(requestId)) {
      return Promise.reject(new Error(`Not a request id: ${requestId}`));
    }
    return firstValueFrom(
      this.http.get<WebhookRequest>(
        `/token/${encodeURIComponent(tokenId)}/request/${encodeURIComponent(requestId)}`,
      ),
    );
  }

  private record(tokenId: string, result: OutboundResult): void {
    if (this.tokenId() === tokenId) {
      this.history.update((list) => [result, ...list].slice(0, HISTORY_SIZE));
    }
  }
}

/** Id de mensagem: UUID, como na rota (`app.routes.ts`). Outro texto vindo da URL é ignorado. */
const REQUEST_ID = /^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i;

export function isRequestId(value: string | null | undefined): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}
