import { Component, computed, input } from '@angular/core';
import { CountLink, CountScope } from '../ui/count-link';
import { Part, percent } from './insights';

/**
 * Uma barra de proporção em SVG (assinatura, schema) com a legenda em texto: cada fatia tem cor e
 * também rótulo, número e percentual, então a cor nunca fala sozinha (WCAG 1.4.1). Para leitor de
 * tela, a barra é uma imagem com o mesmo resumo da legenda.
 */
@Component({
  selector: 'app-proportion-bar',
  template: `
    <svg
      class="bar"
      role="img"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      [attr.aria-label]="summary()"
    >
      @for (slice of slices(); track slice.label) {
        <rect [class]="slice.tone" [attr.x]="slice.x" y="0" [attr.width]="slice.width" height="10">
          <title>{{ slice.label }}: {{ slice.count }} ({{ slice.share }})</title>
        </rect>
      }
    </svg>
    @let token = tokenId();
    <ul class="legend">
      @for (part of parts(); track part.label) {
        <li>
          <span class="swatch" [class]="part.tone" aria-hidden="true"></span>
          <span class="label">{{ part.label }}</span>
          @if (token && part.filter) {
            <a
              class="count"
              [appCountLink]="token"
              [countFilter]="part.filter"
              [count]="part.count"
              [what]="label() + ': ' + part.label"
              [countScope]="countScope()"
              >{{ part.count }}</a
            >
          } @else {
            <span class="count">{{ part.count }}</span>
          }
          <span class="share">{{ share(part.count) }}</span>
        </li>
      }
    </ul>
  `,
  imports: [CountLink],
  styleUrl: './proportion-bar.scss',
})
export class ProportionBar {
  /** Nome do que a barra mede ("Signature"), no começo do resumo. */
  readonly label = input.required<string>();
  readonly parts = input.required<readonly Part[]>();
  /** Sem ela, os números ficam só texto, sem link para a Entrada. */
  readonly tokenId = input<string | null>(null);
  readonly countScope = input<CountScope | null>(null);

  private readonly total = computed(() => this.parts().reduce((sum, part) => sum + part.count, 0));
  protected readonly summary = computed(
    () =>
      `${this.label()}: ${this.parts()
        .map((part) => `${part.label} ${part.count} (${this.share(part.count)})`)
        .join(', ')}`,
  );
  /** As fatias com tamanho, com 0,5 de folga entre elas (a superfície aparece entre as cores). */
  protected readonly slices = computed(() => {
    const total = this.total();
    let x = 0;
    return this.parts()
      .filter((part) => part.count > 0)
      .map((part) => {
        const width = (part.count / total) * 100;
        const slice = {
          ...part,
          x,
          width: Math.max(0, width - 0.5),
          share: percent(part.count, total),
        };
        x += width;
        return slice;
      });
  });

  protected share(count: number): string {
    return percent(count, this.total());
  }
}
