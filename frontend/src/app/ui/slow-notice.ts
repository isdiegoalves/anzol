import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, inject, output } from '@angular/core';
import { ANNOUNCEMENT_MS } from './live-region';

/**
 * O servidor passou de 30 s sem responder a uma leitura (C13): a tela diz isso uma vez, pelo
 * anunciador, e oferece tentar de novo; o pedido de antes segue a caminho.
 */
@Component({
  selector: 'app-slow-notice',
  template: `
    <p>{{ text }}</p>
    <button type="button" class="retry" (click)="retry.emit()" i18n>Try again</button>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
      margin: 8px;
      padding: 8px 16px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-body-medium);
    }

    p {
      flex: 1 1 200px;
      margin: 0;
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
export class SlowNotice {
  readonly retry = output<void>();

  protected readonly text = $localize`The server is taking more than 30 s.`;

  constructor() {
    void inject(LiveAnnouncer).announce(this.text, ANNOUNCEMENT_MS);
  }
}
