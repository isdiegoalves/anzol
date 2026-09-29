import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom, tap } from 'rxjs';
import { RequestStream } from './request-stream';

export const RETRY_SECONDS = [5, 10, 20, 30] as const;
export const RESTORED_NOTE_MS = 5000;

/** Cai com falha de rede numa chamada à API ou com o SSE que não reconecta. */
@Injectable({ providedIn: 'root' })
export class Connection {
  private readonly http = inject(HttpClient);
  private readonly stream = inject(RequestStream);

  readonly downSince = signal<Date | null>(null);
  readonly notice = signal('');
  readonly countdown = signal(0);
  /** Conta as voltas: quem mostra dados relê o que perdeu a cada uma. */
  readonly restored = signal(0);
  /** A chamada que prova a volta: a URL aberta, que o shell informa. */
  readonly probe = signal('/');

  private attempt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private trying = false;

  constructor() {
    // O navegador reconecta o SSE sozinho: uma queda só não é falta de conexão; a segunda, é.
    effect(() => {
      if (this.stream.drops() >= 2) {
        untracked(() => this.failed());
      }
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
      this.back();
    } catch (error) {
      // Resposta com status (401 da URL trancada, 410): o servidor respondeu, a conexão voltou.
      if (error instanceof HttpErrorResponse && error.status !== 0) {
        this.back();
      } else {
        this.attempt++;
        this.wait();
      }
    } finally {
      this.trying = false;
    }
  }

  private back(): void {
    this.downSince.set(null);
    this.countdown.set(0);
    this.notice.set($localize`Connected again.`);
    this.noteTimer = setTimeout(() => this.notice.set(''), RESTORED_NOTE_MS);
    this.stream.drops.set(0);
    this.stream.retry();
    this.restored.update((count) => count + 1);
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
