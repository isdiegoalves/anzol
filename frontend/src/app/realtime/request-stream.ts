import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { RequestCreated } from '../requests/webhook-request';

/**
 * `idle`: ninguém assina (a página não é a Inbox); `connecting`: abrindo pela primeira vez;
 * `open`: recebendo; `reconnecting`: caiu e o navegador tenta de novo; `closed`: o servidor recusou.
 */
export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Tempo real por SSE: `GET /token/{id}/stream`, evento `request.created`.
 *
 * O estado da conexão é um signal. Os eventos saem como Observable, e não como signal, porque
 * um signal guarda só o último valor: duas mensagens que chegam antes da próxima detecção de
 * mudanças virariam uma, e a segunda sumiria da lista.
 */
@Injectable({ providedIn: 'root' })
export class RequestStream {
  private readonly state = signal<StreamStatus>('idle');
  readonly status = this.state.asReadonly();

  /**
   * Abre o `EventSource` ao assinar e o fecha ao cancelar a assinatura. `quiet`: a assinatura não
   * mexe no `status` (o "Live" do cabeçalho é o da Inbox); a tela de Regras só relê os hits (WM-38).
   */
  connect(tokenId: string, { quiet = false } = {}): Observable<RequestCreated> {
    return new Observable<RequestCreated>((subscriber) => {
      const source = new EventSource(`/token/${tokenId}/stream`);
      const set = (status: StreamStatus) => {
        if (!quiet) {
          this.state.set(status);
        }
      };
      set('connecting');
      source.onopen = () => set('open');
      // O EventSource reconecta sozinho; só fica 'closed' quando o servidor recusa (ex.: 404).
      source.onerror = () =>
        set(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
      source.addEventListener('request.created', (event: MessageEvent<string>) =>
        subscriber.next(JSON.parse(event.data) as RequestCreated),
      );
      return () => {
        source.close();
        set('idle');
      };
    });
  }
}
