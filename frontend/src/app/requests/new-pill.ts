import { Component, input, output } from '@angular/core';

/**
 * A pílula das novas que chegaram fora da vista (C §2.8): "↑ 3 new requests", com a mais nova
 * primeiro (INBOX-01); "↓" na ordem inversa. Fica numa faixa própria de 32 px acima da lista, que só
 * existe enquanto há novas, e não cobre item nenhum (UX-10). Clicar leva até elas.
 */
@Component({
  selector: 'app-new-pill',
  template: `
    <button type="button" class="new-pill" (click)="show.emit()">
      <span aria-hidden="true">{{ up() ? '↑' : '↓' }}</span>
      <span i18n>{count(), plural, =1 {1 new request} other {{{ count() }} new requests}}</span>
    </button>
  `,
  styles: `
    :host {
      display: flex;
      flex: none;
      justify-content: center;
      height: 32px;
    }

    .new-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 16px 0 12px;
      border: 0;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
      font: var(--mat-sys-label-large);
      cursor: pointer;

      &:focus-visible {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }
  `,
})
export class NewPill {
  readonly count = input.required<number>();
  /** A ponta das novas é o topo (a mais nova primeiro). */
  readonly up = input(true);
  readonly show = output<void>();
}
