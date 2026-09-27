import { Component, computed, input } from '@angular/core';

/**
 * Esqueleto de uma lista carregando (C §2.11): linhas com a forma do item, sem animação (nada se
 * move, com ou sem movimento reduzido). Decorativo: quem carrega marca `aria-busy` na região.
 */
@Component({
  selector: 'app-skeleton-list',
  template: `
    @for (row of rows(); track row) {
      <div class="ghost" [style.height.px]="itemHeight()">
        <span class="wide"></span>
        <span></span>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .ghost {
      display: grid;
      align-content: center;
      gap: 8px;
      padding: 0 48px 0 16px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    span {
      width: 50%;
      height: 10px;
      border-radius: var(--mat-sys-corner-extra-small);
      background: var(--mat-sys-surface-container-highest);
    }

    .wide {
      width: 80%;
    }
  `,
  host: { 'aria-hidden': 'true' },
})
export class SkeletonList {
  readonly count = input(6);
  readonly itemHeight = input.required<number>();

  protected readonly rows = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
