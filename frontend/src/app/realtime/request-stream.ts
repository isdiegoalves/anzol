import { Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { RequestCreated } from '../requests/webhook-request';

/**
 * `idle`: ninguém assina; `connecting`: abrindo pela primeira vez; `open`: recebendo;
 * `reconnecting`: caiu ou foi recusado, e o navegador ou a tela tenta de novo; `silent`: aberto,
 * mas sem sinal do servidor por dois intervalos do heartbeat, e a tela reabre.
 */
export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'silent';

/** A espera antes de cada nova tentativa, a partir da primeira, até ficar na última. */
export const RETRY_SECONDS = [5, 10, 20, 30] as const;

/** Traz o que chegou enquanto a conexão não estava aberta; devolve quantas trouxe. */
export type Resume = () => Promise<number>;

/** O heartbeat do servidor até o primeiro `ping` dizer o dele. */
export const HEARTBEAT_MS = 15_000;

/** Silêncio que dá a conexão por morta: dois intervalos do heartbeat e uma folga. */
export function silenceLimit(heartbeatMs: number): number {
  return 2 * heartbeatMs + 5000;
}

interface Shared {
  source: EventSource;
  readonly events: Subject<RequestCreated>;
  readonly resumes: Set<Resume>;
  status: StreamStatus;
  users: number;
  /** Assinantes que aparecem no "Live" do cabeçalho. */
  loud: number;
  /** Recusas seguidas do servidor; zera quando a conexão abre. */
  refusals: number;
  reopening: ReturnType<typeof setTimeout> | null;
  heartbeatMs: number;
  silence: ReturnType<typeof setTimeout> | null;
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
  /** Quantas a retomada trouxe na última vez que a conexão abriu. */
  readonly recovered = signal(0);

  /**
   * Abre o `EventSource` com o primeiro assinante e o fecha com o último. `quiet`: a assinatura não
   * mexe no `status` (a tela de Regras só relê os hits). `resume` roda a cada abertura, antes de o
   * `status` voltar a `open`, e logo na assinatura de uma conexão que já está aberta: o evento do
   * que chegou antes disso não vem mais.
   */
  connect(
    tokenId: string,
    { quiet = false, resume }: { quiet?: boolean; resume?: Resume } = {},
  ): Observable<RequestCreated> {
    return new Observable<RequestCreated>((subscriber) => {
      const shared = this.streams.get(tokenId) ?? this.open(tokenId);
      shared.users++;
      shared.loud += quiet ? 0 : 1;
      this.publish();
      const subscription = shared.events.subscribe(subscriber);
      if (resume) {
        shared.resumes.add(resume);
        if (shared.source.readyState === EventSource.OPEN) {
          void resume();
        }
      }
      return () => {
        subscription.unsubscribe();
        if (resume) {
          shared.resumes.delete(resume);
        }
        shared.users--;
        shared.loud -= quiet ? 0 : 1;
        if (shared.users === 0) {
          this.close(shared);
          this.streams.delete(tokenId);
        }
        this.publish();
      };
    });
  }

  /** Fecha a conexão da URL sem esquecer quem assina; o `retry()` a reabre. */
  pause(tokenId: string): void {
    const shared = this.streams.get(tokenId);
    if (shared) {
      this.close(shared);
    }
  }

  /** Reabre as conexões sem esperar a próxima tentativa do navegador. */
  retry(): void {
    for (const [tokenId, shared] of this.streams) {
      this.close(shared);
      shared.source = this.source(tokenId, shared);
    }
    this.publish();
  }

  private close(shared: Shared): void {
    shared.source.close();
    if (shared.reopening) {
      clearTimeout(shared.reopening);
      shared.reopening = null;
    }
    this.hush(shared);
  }

  private hush(shared: Shared): void {
    if (shared.silence) {
      clearTimeout(shared.silence);
      shared.silence = null;
    }
  }

  private open(tokenId: string): Shared {
    const shared = {
      events: new Subject<RequestCreated>(),
      resumes: new Set<Resume>(),
      users: 0,
      loud: 0,
      refusals: 0,
      reopening: null,
      heartbeatMs: HEARTBEAT_MS,
      silence: null,
    } as Shared;
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
    if (shared.status !== 'reconnecting' && shared.status !== 'silent') {
      shared.status = 'connecting';
    }
    // Conexão meio morta (NAT, Wi-Fi trocado, proxy que segura o socket) não dá erro: só o silêncio a revela.
    const heard = () => {
      this.hush(shared);
      shared.silence = setTimeout(() => {
        if (shared.source === source) {
          this.close(shared);
          shared.status = 'silent';
          shared.source = this.source(tokenId, shared);
          this.publish();
        }
      }, silenceLimit(shared.heartbeatMs));
    };
    heard();
    source.addEventListener('ping', (event: MessageEvent<string>) => {
      const seconds = Number(event.data);
      shared.heartbeatMs = seconds > 0 ? seconds * 1000 : HEARTBEAT_MS;
      heard();
    });
    source.onopen = () => {
      heard();
      this.drops.set(0);
      shared.refusals = 0;
      if (shared.resumes.size === 0) {
        this.recovered.set(0);
        set('open');
        return;
      }
      // O estado só vira `open` com a lista completa: até lá, o chip segue dizendo que reconecta.
      void Promise.all([...shared.resumes].map((resume) => resume().catch(() => 0))).then(
        (counts) => {
          this.recovered.set(counts.reduce((sum, count) => sum + count, 0));
          set('open');
        },
      );
    };
    source.onerror = () => {
      if (shared.source !== source) {
        return;
      }
      // O navegador reconecta sozinho da queda de rede, mas desiste do stream recusado (502/503 de um proxy
      // na frente do app que reinicia): esse a tela reabre.
      if (source.readyState === EventSource.CLOSED) {
        this.hush(shared);
        this.reopenLater(tokenId, shared);
      } else {
        this.drops.update((drops) => drops + 1);
      }
      set('reconnecting');
    };
    source.addEventListener('request.created', (event: MessageEvent<string>) => {
      heard();
      shared.events.next(JSON.parse(event.data) as RequestCreated);
    });
    return source;
  }

  private reopenLater(tokenId: string, shared: Shared): void {
    const seconds = RETRY_SECONDS[Math.min(shared.refusals, RETRY_SECONDS.length - 1)];
    shared.refusals++;
    shared.reopening = setTimeout(() => {
      shared.reopening = null;
      shared.source = this.source(tokenId, shared);
      this.publish();
    }, seconds * 1000);
  }

  private publish(): void {
    const loud = [...this.streams.values()].find((shared) => shared.loud > 0);
    this.state.set(loud?.status ?? 'idle');
  }
}
