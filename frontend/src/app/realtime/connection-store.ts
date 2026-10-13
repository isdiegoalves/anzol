import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom, tap } from 'rxjs';
import { RETRY_SECONDS, RequestStream, StreamStatus } from './request-stream';

export const RESTORED_NOTE_MS = 5000;
/** Até aqui fora de "Live", só o chip muda; passou disso, a faixa aparece e fala uma vez. */
export const QUIET_DROP_MS = 5000;

const TROUBLE: readonly StreamStatus[] = ['reconnecting', 'silent'];

/** Cai com falha de rede numa chamada à API ou com o tempo real fora de "Live" por mais de 5 s. */
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
  private troubleTimer: ReturnType<typeof setTimeout> | null = null;
  private trying = false;
  /** A faixa veio de uma chamada à API sem resposta, ou do tempo real. */
  private cause: 'api' | 'stream' | null = null;
  /** O tempo real já abriu nesta URL e depois caiu: a volta dele é dita, com o que chegou no intervalo. */
  private opened = false;
  private dropped = false;

  constructor() {
    effect(() => {
      const status = this.stream.status();
      untracked(() => this.follow(status));
    });
  }

  failed(): void {
    // A prova da volta que cai depois de o tempo real abrir não é queda nova.
    if (this.downSince() || this.trying) {
      return;
    }
    const since = new Date();
    this.show(
      'api',
      since,
      $localize`No connection to the server since ${clock(since)}:time:. What you typed is kept.`,
    );
    this.stream.doubt();
  }

  async retry(): Promise<void> {
    if (!this.downSince() || this.trying) {
      return;
    }
    this.stop();
    if (this.cause === 'stream') {
      // A API responde com o `/stream` caído ou mudo: provar a volta por ela faria a faixa piscar.
      this.reopen();
      return;
    }
    this.trying = true;
    const answered = await this.answers();
    this.trying = false;
    // O tempo real pode abrir sozinho com a prova a caminho: a volta já foi dita.
    if (!this.downSince()) {
      return;
    }
    if (answered) {
      this.reopen();
    } else {
      this.attempt++;
      this.wait();
    }
  }

  /** Resposta com status (401 da URL trancada, 410) conta: o servidor respondeu, a conexão voltou. */
  private async answers(): Promise<boolean> {
    try {
      await firstValueFrom(this.http.get(this.probe(), { responseType: 'text' }));
      return true;
    } catch (error) {
      return error instanceof HttpErrorResponse && error.status !== 0;
    }
  }

  /**
   * A volta só é dita quando o tempo real abre de novo com o que faltou, e não quando a API responde.
   * Até lá, a contagem segue.
   */
  private reopen(): void {
    if (this.stream.status() === 'idle') {
      this.back(0);
      return;
    }
    this.stream.retry();
    this.attempt++;
    this.wait();
  }

  private follow(status: StreamStatus): void {
    if (status === 'open') {
      this.clearTrouble();
      if (this.dropped || this.downSince()) {
        this.back(this.stream.recovered());
      }
      [this.opened, this.dropped] = [true, false];
    } else if (TROUBLE.includes(status)) {
      this.dropped ||= this.opened;
      if (!this.troubleTimer) {
        const began = new Date();
        this.troubleTimer = setTimeout(() => this.troubled(began), QUIET_DROP_MS);
      }
    } else if (status === 'idle') {
      this.clearTrouble();
      [this.opened, this.dropped] = [false, false];
    }
  }

  /** Passou de 5 s fora de "Live": a faixa diz por quê, uma vez, e a contagem reabre o stream. */
  private troubled(began: Date): void {
    this.troubleTimer = null;
    const status = this.stream.status();
    if (this.downSince() || !TROUBLE.includes(status)) {
      return;
    }
    if (status === 'silent') {
      const since = this.stream.heardAt ?? began;
      this.show(
        'stream',
        since,
        $localize`No signal from the server since ${clock(since)}:time:. The list may be incomplete.`,
      );
    } else {
      this.show('stream', began, $localize`Live updates dropped; reconnecting.`);
    }
  }

  private show(cause: 'api' | 'stream', since: Date, text: string): void {
    this.clearNote();
    this.cause = cause;
    this.downSince.set(since);
    this.notice.set(text);
    this.attempt = 0;
    this.wait();
  }

  /** Uma fala só para a volta: com a faixa, "Connected again." e o que chegou; sem ela, só se chegou algo. */
  private back(recovered: number): void {
    const shown = this.downSince() !== null;
    this.stop();
    this.clearNote();
    this.cause = null;
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

  private clearTrouble(): void {
    if (this.troubleTimer) {
      clearTimeout(this.troubleTimer);
      this.troubleTimer = null;
    }
  }

  private clearNote(): void {
    if (this.noteTimer) {
      clearTimeout(this.noteTimer);
      this.noteTimer = null;
    }
  }
}

export function clock(date: Date): string {
  return date.toLocaleTimeString(document.documentElement.lang || 'en', {
    hour: '2-digit',
    minute: '2-digit',
  });
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
