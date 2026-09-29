import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { ShellSettings } from '../shell/shell-settings';
import { RequestStore } from './request-store';

/**
 * O rodapé da lista (INBOX-16): a faixa "1–50 of 128" à esquerda e "Previous page" e "Next page"
 * sempre no mesmo lugar, para o leiaute não pular. Sem página, o botão fica desabilitado e focável
 * (`disabledInteractive`: `aria-disabled`, sem o `disabled`), e o leitor de tela acha os dois.
 * Abaixo, a linha de dicas: o único lugar em que as teclas únicas ficam à vista; some no celular e
 * com os atalhos de uma tecla desligados.
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
    @if (settings.shortcuts()) {
      <p class="hints">
        <span
          ><kbd>{{ 'F' }}</kbd
          >&ngsp;<ng-container i18n="keyboard hint|F opens the filters">filters</ng-container
          >&ngsp;</span
        >
        <span
          ><kbd>↑</kbd><kbd>↓</kbd>&ngsp;<ng-container
            i18n="keyboard hint|Arrows move in the list without opening"
            >move</ng-container
          >&ngsp;</span
        >
        <span
          ><kbd>{{ 'Enter' }}</kbd
          >&ngsp;<ng-container i18n="keyboard hint|Enter opens the request">open</ng-container
          >&ngsp;</span
        >
        <span
          ><kbd>{{ 'R' }}</kbd
          >&ngsp;<ng-container i18n="keyboard hint|R replays the request">replay</ng-container
          >&ngsp;</span
        >
        <span
          ><kbd>{{ 'D' }}</kbd
          >&ngsp;<ng-container i18n="keyboard hint|D compares with the previous attempt"
            >compare</ng-container
          >&ngsp;</span
        >
        <span
          ><kbd>{{ 'U' }}</kbd
          >&ngsp;<ng-container i18n="keyboard hint|U switches the URL">switch URL</ng-container
          >&ngsp;</span
        >
        <span
          ><kbd>?</kbd>&ngsp;<ng-container i18n="keyboard hint|? shows all the shortcuts"
            >all</ng-container
          >&ngsp;</span
        >
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
      padding-bottom: 4px;
    }

    .footer {
      display: flex;
      flex: none;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 4px 8px;
      padding: 0 8px 0 16px;
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

    // Com mouse bastam 32 px (a WCAG 2.5.8 pede 24): a altura que sobra é da linha de dicas, e a
    // lista continua com 9 requisições inteiras a 1440×900.
    @media (pointer: fine) {
      button {
        height: 32px;
        min-height: 32px;
      }
    }

    .hints {
      display: flex;
      flex-wrap: wrap;
      gap: 0 10px;
      margin: 0;
      padding: 0 8px 0 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      line-height: 15px;
    }

    kbd {
      padding: 0 4px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: var(--mat-sys-corner-extra-small);
      font-family: var(--app-code-family);
      line-height: 12px;
    }

    @media (width < 600px) {
      .hints {
        display: none;
      }
    }
  `,
})
export class ListFooter {
  protected readonly store = inject(RequestStore);
  protected readonly settings = inject(ShellSettings);

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
