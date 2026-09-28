import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom, tap } from 'rxjs';
import { RequestStream } from './request-stream';

/** Espera entre as tentativas, em segundos: 5, 10, 20 e depois 30. */
export const RETRY_SECONDS = [5, 10, 20, 30] as const;
/** Quanto tempo "Connected again." fica na faixa. */
export const RESTORED_NOTE_MS = 5000;

/**
 * A conexão com o servidor (B1, UX-16). Cai quando uma chamada à API falha por rede, ou quando o
 * SSE cai e a primeira reconexão falha. A faixa do shell diz uma vez desde quando, tenta de novo
 * sozinha (com a contagem fora da região viva) e oferece "Try again now". Na volta, diz
 * "Connected again." por 5 s, e quem mostra dados (a Entrada) busca o que chegou no intervalo.
 */
@Injectable({ providedIn: 'root' })
export class Connection {
  private readonly http = inject(HttpClient);
  private readonly stream = inject(RequestStream);

  /** Desde quando não há conexão; `null` com conexão. */
  readonly downSince = signal<Date | null>(null);
  /** O texto da região viva "Connection"; vazio enquanto há conexão. */
  readonly notice = signal('');
  /** Segundos até a próxima tentativa. */
  readonly countdown = signal(0);
  /** Conta as voltas: quem depende do servidor relê o que perdeu a cada uma. */
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

  /** Uma chamada falhou por rede, ou o tempo real não voltou. Só a primeira fala. */
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

  /** "Try again now", e o fim de cada contagem. */
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

/** Falha de rede (sem status) em qualquer chamada à API: a faixa "sem conexão" avisa. */
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
