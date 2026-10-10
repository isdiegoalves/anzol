import { Component, computed, input, output } from '@angular/core';

/**
 * A leitura da URL da rota falhou sem o servidor dizer que ela não existe (5xx, rede): a página diz
 * isso e que a URL salva continua a mesma, em vez da tela em branco que criava outra URL. Fica no
 * pacote inicial: sem rede, não dá para baixá-la.
 */
@Component({
  selector: 'app-url-failed',
  template: `
    <main class="failed" tabindex="-1" aria-labelledby="url-failed-title">
      <h1 id="url-failed-title">{{ title() }}</h1>
      <p i18n>Your saved URL is unchanged; nothing was created.</p>
      <div class="actions">
        <button type="button" class="again" (click)="again.emit()">
          <span i18n>Try again</span>
        </button>
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

      &:focus-visible {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }
  `,
})
export class UrlFailed {
  /** 0 sem resposta (rede). */
  readonly status = input.required<number>();
  readonly again = output<void>();

  protected readonly title = computed(
    () => $localize`Could not open this URL (${this.status()}:status:).`,
  );
}
