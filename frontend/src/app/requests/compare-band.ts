import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { CompareStore } from '../diff/compare-store';

/**
 * As faixas da lista no Compare: enquanto se escolhe a B ("Choose a request to compare with #…",
 * com Cancel) e, na página do Compare, o modo (RULES-35: clicar escolhe a B, o Esc sai). Fora da
 * lista para o estilo delas não pesar no orçamento do componente.
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
    } @else if (compare.pair()) {
      <p i18n class="band mode" role="status">
        <strong>Compare mode.</strong> Click a request to make it <strong>B</strong>. Press
        <kbd>Esc</kbd> to leave.
      </p>
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

    .mode {
      display: block;
      margin-block: 0 8px;
      padding: 8px 12px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    kbd {
      font-family: var(--app-code-family);
    }
  `,
})
export class CompareBand {
  protected readonly compare = inject(CompareStore);
}
