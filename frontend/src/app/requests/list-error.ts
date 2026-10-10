import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ANNOUNCEMENT_MS } from '../ui/live-region';
import { ListFailure } from './request-store';

/** A espera antes de cada nova tentativa sozinha, como a da volta do tempo real. */
const RETRY_SECONDS = [5, 10, 20, 30];

/**
 * A primeira carga da lista falhou: o bloco diz isso, explica as que chegaram pelo tempo real
 * enquanto isso, tenta de novo sozinho em 5, 10, 20 e 30 s, e "Try again now" tenta na hora. A frase
 * sai uma vez pelo anunciador; a contagem fica fora da árvore de acessibilidade.
 */
@Component({
  selector: 'app-list-error',
  template: `
    <p>{{ text() }}</p>
    @if (seconds() > 0) {
      <span class="countdown" aria-hidden="true">{{ countdown() }}</span>
    }
    <button type="button" class="retry" (click)="again()">
      <span i18n>Try again now</span>
    </button>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 16px;
      margin: 8px;
      padding: 8px 16px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font: var(--mat-sys-body-medium);
    }

    p {
      flex: 1 1 200px;
      margin: 0;
    }

    .countdown {
      font: var(--mat-sys-body-small);
    }

    .retry {
      min-height: 36px;
      padding: 0 16px;
      border: 1px solid currentcolor;
      border-radius: var(--mat-sys-corner-full);
      background: transparent;
      color: inherit;
      font: var(--mat-sys-label-large);
      cursor: pointer;

      &:focus-visible {
        outline: var(--app-focus-width) solid var(--app-focus-color);
        outline-offset: var(--app-focus-offset);
      }
    }

    @media (width < 600px) {
      .retry {
        min-height: 44px;
      }
    }
  `,
})
export class ListError {
  readonly failure = input.required<ListFailure>();
  /** As que chegaram pelo tempo real com a lista em erro, e o total que o evento trouxe. */
  readonly arrived = input(0);
  readonly total = input(0);
  readonly retry = output<void>();

  protected readonly seconds = signal(0);
  private timer: ReturnType<typeof setInterval> | undefined;
  protected readonly countdown = computed(
    () => $localize`Trying again in ${this.seconds()}:seconds: s`,
  );
  protected readonly text = computed(() => {
    const status = this.failure().status;
    const [arrived, before] = [this.arrived(), this.total() - this.arrived()];
    if (arrived === 0 || before <= 0) {
      return $localize`Could not load the list (${status}:status:).`;
    }
    const came =
      arrived === 1 ? $localize`1 arrived just now` : $localize`${arrived}:count: arrived just now`;
    const missed =
      arrived === 1
        ? before === 1
          ? $localize`the 1 before it did not load (${status}:status:)`
          : $localize`the ${before}:count: before it did not load (${status}:status:)`
        : before === 1
          ? $localize`the 1 before them did not load (${status}:status:)`
          : $localize`the ${before}:count: before them did not load (${status}:status:)`;
    return $localize`${came}:arrived:; ${missed}:missed:.`;
  });

  constructor() {
    const announcer = inject(LiveAnnouncer);
    effect((onCleanup) => {
      const { attempt } = this.failure();
      if (attempt === 0) {
        untracked(() => void announcer.announce(this.text(), ANNOUNCEMENT_MS));
      }
      this.seconds.set(RETRY_SECONDS[Math.min(attempt, RETRY_SECONDS.length - 1)]);
      this.timer = setInterval(() => {
        this.seconds.update((left) => left - 1);
        if (this.seconds() === 0) {
          this.again();
        }
      }, 1000);
      onCleanup(() => clearInterval(this.timer));
    });
  }

  protected again(): void {
    clearInterval(this.timer);
    this.seconds.set(0);
    this.retry.emit();
  }
}
