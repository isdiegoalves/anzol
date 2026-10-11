import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, inject, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { CompareStore } from '../diff/compare-store';
import { LateContent } from '../ui/late-content';
import { ANNOUNCEMENT_MS } from '../ui/live-region';

/**
 * As faixas da lista no Compare: enquanto se escolhe a B ("Choose a request to compare with #…",
 * com Cancel) e, na página do Compare, o modo (RULES-35: clicar escolhe a B, o Esc sai). Fora da
 * lista para o estilo delas não pesar no orçamento do componente.
 */
@Component({
  selector: 'app-compare-band',
  imports: [LateContent, MatButton],
  template: `
    @if (compare.picking(); as base) {
      <div class="band">
        <span role="status">
          <ng-container *appLateContent i18n
            >Choose a request to compare with #{{ base.uuid.substring(0, 5) }}</ng-container
          >
        </span>
        <button i18n mat-button type="button" (click)="cancel(base.uuid)">Cancel</button>
      </div>
    } @else if (compare.pair()) {
      <p class="band mode" role="status">
        <ng-container *appLateContent i18n>
          <strong>Compare mode.</strong> Click a request to make it <strong>B</strong>. Press
          <kbd>Esc</kbd> to leave.
        </ng-container>
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
  private readonly announcer = inject(LiveAnnouncer);
  /** O "Cancel" da escolha da B, com a A, para o foco voltar à linha dela. */
  readonly cancelled = output<string>();

  protected cancel(base: string): void {
    this.compare.close();
    void this.announcer.announce($localize`Comparison cancelled.`, ANNOUNCEMENT_MS);
    this.cancelled.emit(base);
  }
}
