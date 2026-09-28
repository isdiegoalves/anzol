import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * O pedaço de um destino não carregou (B1, UX-16): o `main` diz qual, sem instrução de operador,
 * com "Try again" e "Back to the Inbox". Fica no pacote inicial: sem rede, não dá para baixá-lo.
 */
@Component({
  selector: 'app-open-failed',
  imports: [RouterLink],
  template: `
    <main class="failed" tabindex="-1" aria-labelledby="failed-title">
      <h1 id="failed-title">{{ title() }}</h1>
      <p i18n>The server did not answer. Nothing was changed.</p>
      <div class="actions">
        <button type="button" class="again" (click)="again.emit()">
          <span i18n>Try again</span>
        </button>
        @if (tokenId(); as id) {
          <a class="back" [routerLink]="['/', id]" (click)="back.emit()" i18n>Back to the Inbox</a>
        }
      </div>
    </main>
  `,
  styles: `
    .failed {
      box-sizing: border-box;
      max-width: 720px;
      padding: 40px 32px;

      &:focus {
        outline: none;
      }
    }

    h1 {
      margin: 0 0 12px;
      font: var(--mat-sys-headline-small);
      font-variation-settings: 'ROND' 100;
    }

    p {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-large);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
      margin-top: 24px;
    }

    .again {
      min-height: 40px;
      padding: 0 24px;
      border: 0;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      font: var(--mat-sys-label-large);
      cursor: pointer;
    }

    .back {
      padding: 8px 0;
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-large);
    }

    .again,
    .back {
      &:focus-visible {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }
  `,
})
export class OpenFailed {
  /** O nome do destino, como o rail o mostra. */
  readonly destination = input.required<string>();
  readonly tokenId = input<string | null>(null);
  readonly again = output<void>();
  readonly back = output<void>();

  protected readonly title = computed(
    () => $localize`Could not open ${this.destination()}:destination:`,
  );
}
