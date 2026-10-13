import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { RESTORED_NOTE_MS, clock } from './connection-store';
import { RequestStream, StorageState } from './request-stream';

/**
 * O aviso do armazenamento do servidor: enquanto o Redis recusa gravação, a faixa diz desde quando; na
 * volta, diz "Storing again." por 5 s, como a volta da conexão.
 */
@Injectable({ providedIn: 'root' })
export class StorageNotice {
  private readonly stream = inject(RequestStream);

  readonly full = signal(false);
  readonly notice = signal('');

  private noteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const state = this.stream.storage();
      untracked(() => this.follow(state));
    });
  }

  private follow(state: StorageState | null): void {
    if (state?.full) {
      this.clearNote();
      this.full.set(true);
      const since = clock(new Date(`${state.since.replace(' ', 'T')}Z`));
      this.notice.set(
        $localize`Storage is full since ${since}:time:: new requests are being refused.`,
      );
    } else if (this.full()) {
      this.full.set(false);
      this.notice.set($localize`Storing again.`);
      this.noteTimer = setTimeout(() => this.notice.set(''), RESTORED_NOTE_MS);
    }
  }

  private clearNote(): void {
    if (this.noteTimer) {
      clearTimeout(this.noteTimer);
      this.noteTimer = null;
    }
  }
}
