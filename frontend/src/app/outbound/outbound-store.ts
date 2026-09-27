import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RequestPage, WebhookRequest } from '../requests/webhook-request';
import { OutboundResult, ReplayPayload, SendPayload } from './outbound';

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
      this.http.post<OutboundResult>(`/token/${tokenId}/request/${requestId}/replay`, payload),
    );
    this.record(tokenId, result);
    return result;
  }

  async send(tokenId: string, payload: SendPayload): Promise<OutboundResult> {
    const result = await firstValueFrom(
      this.http.post<OutboundResult>(`/token/${tokenId}/send`, payload),
    );
    this.record(tokenId, result);
    return result;
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

  request(tokenId: string, requestId: string): Promise<WebhookRequest> {
    return firstValueFrom(this.http.get<WebhookRequest>(`/token/${tokenId}/request/${requestId}`));
  }

  private record(tokenId: string, result: OutboundResult): void {
    if (this.tokenId() === tokenId) {
      this.history.update((list) => [result, ...list].slice(0, HISTORY_SIZE));
    }
  }
}
