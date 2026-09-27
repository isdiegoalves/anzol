import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { CompareStore } from '../diff/compare-store';

/**
 * A faixa da lista enquanto se escolhe a B do Compare ("Choose a request to compare with #…", com
 * Cancel). Fora da lista para o estilo dela não pesar no orçamento do componente.
 */
@Component({
  selector: 'app-compare-band',
  imports: [MatButton],
  template: `
    @if (compare.picking(); as base) {
      <div class="band" role="status">
        <span i18n>Choose a request to compare with #{{ base.uuid.substring(0, 5) }}</span>
        <button i18n mat-button type="button" (click)="compare.close()">Cancel</button>
      </div>
    }
  `,
  styles: `
    .band {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 0 16px;
      padding: 4px 4px 4px 12px;
      border-radius: var(--mat-sys-corner-small);
      background: var(--app-warning-container);
      color: var(--app-on-warning-container);
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class CompareBand {
  protected readonly compare = inject(CompareStore);
}
