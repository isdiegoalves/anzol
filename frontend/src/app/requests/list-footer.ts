import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RequestStore } from './request-store';

/**
 * O rodapé da lista (INBOX-16): a faixa "1–50 of 128" à esquerda e "Previous page" e "Next page"
 * sempre no mesmo lugar, para o leiaute não pular. Sem página, o botão fica desabilitado e focável
 * (`disabledInteractive`: `aria-disabled`, sem o `disabled`), e o leitor de tela acha os dois.
 */
@Component({
  selector: 'app-list-footer',
  imports: [MatButton],
  template: `
    @let range = store.range();
    <footer class="footer">
      <span i18n class="range">{{ range.from }}–{{ range.to }} of {{ range.of }}</span>
      <span class="pages">
        <button
          i18n
          mat-button
          type="button"
          disabledInteractive
          [disabled]="!store.hasPreviousPage()"
          (click)="previous()"
        >
          Previous page
        </button>
        <button
          i18n
          mat-button
          type="button"
          disabledInteractive
          [disabled]="!store.hasNextPage()"
          (click)="next()"
        >
          Next page
        </button>
      </span>
    </footer>
  `,
  styles: `
    .footer {
      display: flex;
      flex: none;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 4px 8px;
      padding: 0 8px 8px 16px;
    }

    .range {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .pages {
      display: flex;
      gap: 4px;
    }

    button {
      min-height: 44px;
    }
  `,
})
export class ListFooter {
  protected readonly store = inject(RequestStore);

  protected previous(): void {
    if (this.store.hasPreviousPage()) {
      void this.store.loadPreviousPage();
    }
  }

  protected next(): void {
    if (this.store.hasNextPage()) {
      void this.store.loadNextPage();
    }
  }
}
