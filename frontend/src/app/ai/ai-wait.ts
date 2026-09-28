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

/**
 * A espera de um pedido de IA (B4, UX-42), para o Suggest e para o Explain. A região viva do
 * `group "AI progress"` existe desde a carga, vazia (§4.3), e recebe **uma vez** a frase do começo
 * ("It usually takes about 9 s", com a mediana das últimas chamadas) e, passado o dobro disso, a da
 * demora. O contador de segundos e a barra ficam fora da árvore de acessibilidade. "Cancel" (e o
 * `Esc`) aborta o pedido; o resto da tela continua utilizável enquanto isso.
 */
@Component({
  selector: 'app-ai-wait',
  imports: [LiveRegion, MatButton],
  template: `
    <!-- O nome fica no grupo; a região viva, dentro dele, não tem nome (§4.3). -->
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
  /** O pedido está em curso. */
  readonly waiting = input(false);
  /** O que a região diz quando o pedido termina ("Explanation ready."); vazio, ela só esvazia. */
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

  /** `Esc` durante a espera é "Cancel" (e não fecha mais nada). */
  private cancelByKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.waiting() && !event.defaultPrevented) {
      event.preventDefault();
      this.cancel();
    }
  }
}
