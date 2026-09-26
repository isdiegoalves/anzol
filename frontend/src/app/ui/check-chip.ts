import { Component, input } from '@angular/core';
import type { CheckResult } from '../pipeline/pipeline';
import { Icon } from './icon';

/**
 * O resultado de uma verificação (assinatura, schema ou regra) no mesmo componente em toda tela:
 * `mini` é o selo da lista (só o título), `card` o cartão do detalhe (título e motivo). Cor nunca
 * sozinha: todo tom tem ícone e texto (WCAG 1.4.1).
 */
@Component({
  selector: 'app-check-chip',
  imports: [Icon],
  template: `
    <app-icon [name]="result().tone" [size]="size() === 'card' ? 22 : 16" />
    <span class="text">
      <span class="title">{{ result().title }}</span>
      @if (size() === 'card') {
        <span class="detail">{{ result().detail }}</span>
      }
    </span>
  `,
  styleUrl: './check-chip.scss',
  host: {
    '[class]': '"check " + result().tone + " " + size()',
    '[attr.data-kind]': 'result().kind',
    '[attr.data-state]': 'result().state',
    '[attr.title]': 'size() === "mini" ? result().detail : null',
  },
})
export class CheckChip {
  readonly result = input.required<CheckResult>();
  readonly size = input<'mini' | 'card'>('mini');
}
