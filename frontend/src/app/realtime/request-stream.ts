import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { RequestCreated } from '../requests/webhook-request';

export type StreamStatus = 'closed' | 'connecting' | 'open';

/**
 * Tempo real por SSE: `GET /token/{id}/stream`, evento `request.created`.
 *
 * O estado da conexão é um signal. Os eventos saem como Observable, e não como signal, porque
 * um signal guarda só o último valor: duas mensagens que chegam antes da próxima detecção de
 * mudanças virariam uma, e a segunda sumiria da lista.
 */
@Injectable({ providedIn: 'root' })
export class RequestStream {
  private readonly state = signal<StreamStatus>('closed');
  readonly status = this.state.asReadonly();

  /** Abre o `EventSource` ao assinar e o fecha ao cancelar a assinatura. */
  connect(tokenId: string): Observable<RequestCreated> {
    return new Observable<RequestCreated>((subscriber) => {
      const source = new EventSource(`/token/${tokenId}/stream`);
      this.state.set('connecting');
      source.onopen = () => this.state.set('open');
      // O EventSource reconecta sozinho; só fica 'closed' quando o servidor recusa (ex.: 404).
      source.onerror = () =>
        this.state.set(source.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
      source.addEventListener('request.created', (event: MessageEvent<string>) =>
        subscriber.next(JSON.parse(event.data) as RequestCreated),
      );
      return () => {
        source.close();
        this.state.set('closed');
      };
    });
  }
}
