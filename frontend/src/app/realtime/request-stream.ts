import { Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { RequestCreated } from '../requests/webhook-request';

/**
 * `idle`: ninguém assina; `connecting`: abrindo pela primeira vez; `open`: recebendo;
 * `reconnecting`: caiu e o navegador tenta de novo; `closed`: o servidor recusou.
 */
export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

interface Shared {
  source: EventSource;
  readonly events: Subject<RequestCreated>;
  status: StreamStatus;
  users: number;
  /** Assinantes que aparecem no "Live" do cabeçalho. */
  loud: number;
}

/**
 * Tempo real por SSE: `GET /token/{id}/stream`, evento `request.created`. Uma conexão por URL,
 * dividida por todos os assinantes.
 *
 * O estado da conexão é um signal. Os eventos saem como Observable, e não como signal, porque
 * um signal guarda só o último valor: duas mensagens que chegam antes da próxima detecção de
 * mudanças virariam uma, e a segunda sumiria da lista.
 */
@Injectable({ providedIn: 'root' })
export class RequestStream {
  private readonly streams = new Map<string, Shared>();
  private readonly state = signal<StreamStatus>('idle');
  readonly status = this.state.asReadonly();
  /** Quedas seguidas; zera quando a conexão abre. */
  readonly drops = signal(0);

  /**
   * Abre o `EventSource` com o primeiro assinante e o fecha com o último. `quiet`: a assinatura não
   * mexe no `status` (a tela de Regras só relê os hits).
   */
  connect(tokenId: string, { quiet = false } = {}): Observable<RequestCreated> {
    return new Observable<RequestCreated>((subscriber) => {
      const shared = this.streams.get(tokenId) ?? this.open(tokenId);
      shared.users++;
      shared.loud += quiet ? 0 : 1;
      this.publish();
      const subscription = shared.events.subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        shared.users--;
        shared.loud -= quiet ? 0 : 1;
        if (shared.users === 0) {
          shared.source.close();
          this.streams.delete(tokenId);
        }
        this.publish();
      };
    });
  }

  /** Fecha a conexão da URL sem esquecer quem assina; o `retry()` a reabre. */
  pause(tokenId: string): void {
    this.streams.get(tokenId)?.source.close();
  }

  /** Reabre as conexões sem esperar a próxima tentativa do navegador. */
  retry(): void {
    for (const [tokenId, shared] of this.streams) {
      shared.source.close();
      shared.source = this.source(tokenId, shared);
    }
    this.publish();
  }

  private open(tokenId: string): Shared {
    const shared = { events: new Subject<RequestCreated>(), users: 0, loud: 0 } as Shared;
    shared.source = this.source(tokenId, shared);
    this.streams.set(tokenId, shared);
    return shared;
  }

  private source(tokenId: string, shared: Shared): EventSource {
    const source = new EventSource(`/token/${tokenId}/stream`);
    const set = (status: StreamStatus) => {
      if (shared.source === source) {
        shared.status = status;
        this.publish();
      }
    };
    shared.status = 'connecting';
    source.onopen = () => {
      this.drops.set(0);
      set('open');
    };
    // O EventSource reconecta sozinho; só fica 'closed' quando o servidor recusa (ex.: 404).
    source.onerror = () => {
      const closed = source.readyState === EventSource.CLOSED;
      if (!closed && shared.source === source) {
        this.drops.update((drops) => drops + 1);
      }
      set(closed ? 'closed' : 'reconnecting');
    };
    source.addEventListener('request.created', (event: MessageEvent<string>) =>
      shared.events.next(JSON.parse(event.data) as RequestCreated),
    );
    return source;
  }

  private publish(): void {
    const loud = [...this.streams.values()].find((shared) => shared.loud > 0);
    this.state.set(loud?.status ?? 'idle');
  }
}
