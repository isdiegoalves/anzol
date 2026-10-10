import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom, tap } from 'rxjs';
import { RETRY_SECONDS, RequestStream, StreamStatus } from './request-stream';

export const RESTORED_NOTE_MS = 5000;

/** Cai com falha de rede numa chamada à API ou com o SSE que não reconecta. */
@Injectable({ providedIn: 'root' })
export class Connection {
  private readonly http = inject(HttpClient);
  private readonly stream = inject(RequestStream);

  readonly downSince = signal<Date | null>(null);
  readonly notice = signal('');
  readonly countdown = signal(0);
  /** A chamada que prova a volta: a URL aberta, que o shell informa. */
  readonly probe = signal('/');

  private attempt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private trying = false;
  /** O tempo real já abriu nesta URL e depois caiu: a volta dele é dita, com o que chegou no intervalo. */
  private opened = false;
  private dropped = false;

  constructor() {
    // O navegador reconecta o SSE sozinho: uma queda só não é falta de conexão; a segunda, é.
    effect(() => {
      if (this.stream.drops() >= 2) {
        untracked(() => this.failed());
      }
    });
    effect(() => {
      const status = this.stream.status();
      untracked(() => this.follow(status));
    });
  }

  failed(): void {
    if (this.downSince()) {
      return;
    }
    const since = new Date();
    this.clearNote();
    this.downSince.set(since);
    const time = since.toLocaleTimeString(document.documentElement.lang || 'en', {
      hour: '2-digit',
      minute: '2-digit',
    });
    this.notice.set(
      $localize`No connection to the server since ${time}:time:. What you typed is kept.`,
    );
    this.attempt = 0;
    this.wait();
  }

  async retry(): Promise<void> {
    if (!this.downSince() || this.trying) {
      return;
    }
    this.trying = true;
    this.stop();
    try {
      await firstValueFrom(this.http.get(this.probe(), { responseType: 'text' }));
      this.reopen();
    } catch (error) {
      // Resposta com status (401 da URL trancada, 410): o servidor respondeu, a conexão voltou.
      if (error instanceof HttpErrorResponse && error.status !== 0) {
        this.reopen();
      } else {
        this.attempt++;
        this.wait();
      }
    } finally {
      this.trying = false;
    }
  }

  /**
   * O servidor respondeu, mas a volta só é dita quando o tempo real abre de novo com o que faltou: a
   * API pode responder com o `/stream` ainda caído. Até lá, a contagem segue.
   */
  private reopen(): void {
    if (this.stream.status() === 'idle') {
      this.back(0);
      return;
    }
    this.stream.drops.set(0);
    this.stream.retry();
    this.attempt++;
    this.wait();
  }

  private follow(status: StreamStatus): void {
    if (status === 'open') {
      if (this.dropped || this.downSince()) {
        this.back(this.stream.recovered());
      }
      [this.opened, this.dropped] = [true, false];
    } else if (status === 'idle') {
      [this.opened, this.dropped] = [false, false];
    } else if (status !== 'connecting' && this.opened) {
      this.dropped = true;
    }
  }

  /** Uma fala só para a volta: com a faixa, "Connected again." e o que chegou; sem ela, só se chegou algo. */
  private back(recovered: number): void {
    const shown = this.downSince() !== null;
    this.stop();
    this.clearNote();
    this.downSince.set(null);
    this.countdown.set(0);
    const text = shown ? this.connectedAgain(recovered) : this.briefDrop(recovered);
    this.notice.set(text);
    if (text) {
      this.noteTimer = setTimeout(() => this.notice.set(''), RESTORED_NOTE_MS);
    }
  }

  private connectedAgain(recovered: number): string {
    if (recovered === 0) {
      return $localize`Connected again.`;
    }
    return recovered === 1
      ? $localize`Connected again. 1 request arrived meanwhile.`
      : $localize`Connected again. ${recovered}:count: requests arrived meanwhile.`;
  }

  private briefDrop(recovered: number): string {
    if (recovered === 0) {
      return '';
    }
    return recovered === 1
      ? $localize`1 request arrived during a brief connection drop.`
      : $localize`${recovered}:count: requests arrived during a brief connection drop.`;
  }

  private wait(): void {
    this.countdown.set(RETRY_SECONDS[Math.min(this.attempt, RETRY_SECONDS.length - 1)]);
    this.timer = setInterval(() => {
      this.countdown.update((left) => left - 1);
      if (this.countdown() <= 0) {
        void this.retry();
      }
    }, 1000);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private clearNote(): void {
    if (this.noteTimer) {
      clearTimeout(this.noteTimer);
      this.noteTimer = null;
    }
  }
}

/** Status 0: a chamada não teve resposta (falha de rede). */
export const connectionInterceptor: HttpInterceptorFn = (request, next) => {
  const connection = inject(Connection);
  return next(request).pipe(
    tap({
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 0) {
          connection.failed();
        }
      },
    }),
  );
};
