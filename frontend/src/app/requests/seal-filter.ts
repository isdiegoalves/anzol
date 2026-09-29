import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FilterChips } from '../search/filter-chips';

/** WCAG 2.5.8. */
const TARGET_MIN = 24;

/**
 * O selo à vista é o de dentro do botão do item, e um botão não cabe dentro de outro: este botão
 * fica por cima dele, do tamanho dele. Só com ponteiro fino: no toque, o item inteiro abre.
 */
@Component({
  selector: 'app-seal-filter',
  template: `<button
    type="button"
    class="seal"
    [attr.aria-label]="label()"
    [title]="label()"
    (click)="chips.filterByValue({ kind: 'status', name: '', value: status() })"
  ></button>`,
  styles: `
    :host {
      position: absolute;
      z-index: 1;
    }

    .seal {
      display: block;
      width: 100%;
      height: 100%;
      padding: 0;
      border: 0;
      border-radius: var(--mat-sys-corner-extra-small);
      background: none;
      cursor: pointer;

      &:hover {
        box-shadow: inset 0 -2px var(--mat-sys-primary);
      }

      &:focus-visible {
        outline: 3px solid var(--mat-sys-primary);
      }
    }
  `,
  host: {
    '[style.left.px]': 'box().left',
    '[style.top.px]': 'box().top',
    '[style.width.px]': 'box().width',
    '[style.height.px]': 'box().height',
  },
})
export class SealFilter {
  protected readonly chips = inject(FilterChips);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly status = input.required<string>();

  protected readonly label = computed(
    () => $localize`Filter by ${$localize`:filter chip:answered ${this.status()}:status:`}:filter:`,
  );
  protected readonly box = signal({ left: 0, top: 0, width: 0, height: 0 });

  constructor() {
    // Por cima do selo de dentro do botão do item: a posição dele, medida depois de desenhado.
    afterRenderEffect({
      earlyRead: () => {
        this.status();
        const item = this.host.parentElement;
        const seal = item?.querySelector<HTMLElement>('.select app-check-chip[data-kind="rule"]');
        if (!item || !seal) {
          return null;
        }
        const [outer, inner] = [item.getBoundingClientRect(), seal.getBoundingClientRect()];
        const height = Math.max(inner.height, TARGET_MIN);
        return {
          left: inner.left - outer.left,
          top: inner.top - outer.top - (height - inner.height) / 2,
          width: inner.width,
          height,
        };
      },
      write: (measured) => {
        const box = measured();
        if (box) {
          this.box.set(box);
        }
      },
    });
  }
}
