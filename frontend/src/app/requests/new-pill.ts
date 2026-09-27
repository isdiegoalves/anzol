import { Component, input, output } from '@angular/core';

/**
 * A pílula das novas que chegaram fora da vista (C §2.8): "↑ 3 new requests" no topo da lista, com
 * a mais nova primeiro (INBOX-01); "↓" embaixo, na ordem inversa. Clicar leva até elas.
 */
@Component({
  selector: 'app-new-pill',
  template: `
    <button type="button" class="new-pill" [class.top]="up()" (click)="show.emit()">
      <span aria-hidden="true">{{ up() ? '↑' : '↓' }}</span>
      <span i18n>{count(), plural, =1 {1 new request} other {{{ count() }} new requests}}</span>
    </button>
  `,
  styles: `
    .new-pill {
      position: absolute;
      bottom: 12px;
      left: 50%;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 16px 0 12px;
      border: 0;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
      box-shadow: var(--mat-sys-level2);
      font: var(--mat-sys-label-large);
      cursor: pointer;
      transform: translateX(-50%);

      &.top {
        top: 12px;
        bottom: auto;
      }

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
