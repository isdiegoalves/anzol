import { DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { LiveRegion } from '../ui/live-region';
import { AiClient, AiKind } from './ai-client';

/** A espera de um pedido de IA, no Suggest e no Explain; `Esc` durante ela é "Cancel". */
@Component({
  selector: 'app-ai-wait',
  imports: [LiveRegion, MatButton],
  template: `
    <!-- A região viva fica sem nome: o nome é do grupo. -->
    <div role="group" aria-label="AI progress" i18n-aria-label>
      <app-live-region class="phrase" [text]="spoken()" />
      @if (waiting()) {
        <div class="line">
          <span class="bar" aria-hidden="true"><span class="run"></span></span>
          <span class="seconds" aria-hidden="true" i18n>{{ elapsed() }} s</span>
          <button mat-stroked-button type="button" class="cancel" (click)="cancel()" i18n>
            Cancel
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './ai-wait.scss',
})
export class AiWait {
  private readonly ai = inject(AiClient);
  private readonly document = inject(DOCUMENT);

  readonly kind = input.required<AiKind>();
  readonly waiting = input(false);
  /** A frase ao terminar; vazia, a região só esvazia. */
  readonly outcome = input('');
  readonly cancelled = output<void>();

  protected readonly elapsed = signal(0);
  private readonly cancelledNow = signal(false);
  private readonly usual = signal(0);
  protected readonly spoken = computed(() => {
    if (this.waiting()) {
      return this.elapsed() >= 2 * this.usual()
        ? $localize`Still waiting. It can take up to 90 s.`
        : $localize`Asking the local model. It usually takes about ${this.usual()}:seconds: s.`;
    }
    return this.cancelledNow() ? $localize`Cancelled. Nothing was changed.` : this.outcome();
  });
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    effect(() => {
      clearInterval(this.timer);
      if (this.waiting()) {
        this.usual.set(this.ai.usualSeconds(this.kind()));
        this.elapsed.set(0);
        this.cancelledNow.set(false);
        this.timer = setInterval(() => this.elapsed.update((seconds) => seconds + 1), 1000);
      }
    });
    // Na captura: o editor de regra escuta o `keydown` do documento desde antes e fecharia com o
    // mesmo Esc; assim ele recebe o evento já tratado.
    const byKey = (event: KeyboardEvent) => this.cancelByKey(event);
    this.document.addEventListener('keydown', byKey, true);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.timer);
      this.document.removeEventListener('keydown', byKey, true);
    });
  }

  protected cancel(): void {
    this.cancelledNow.set(true);
    this.cancelled.emit();
  }

  private cancelByKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.waiting() && !event.defaultPrevented) {
      event.preventDefault();
      this.cancel();
    }
  }
}
