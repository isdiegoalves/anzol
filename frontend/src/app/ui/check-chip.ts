import { Component, input } from '@angular/core';
import type { CheckResult } from '../pipeline/pipeline';
import { Icon, IconName } from './icon';

/**
 * O resultado de uma verificação (assinatura, schema ou regra) no mesmo componente em toda tela:
 * `mini` é o selo da lista (o `short` do resultado, INBOX-13, com o ícone da verificação, INBOX-28; o
 * título e o motivo no `title`), `card` o cartão do detalhe (ícone do tom, título e motivo). Cor nunca sozinha: todo tom tem ícone e texto (WCAG 1.4.1).
 */
@Component({
  selector: 'app-check-chip',
  imports: [Icon],
  template: `
    <app-icon
      [name]="size() === 'card' ? result().tone : kindIcons[result().kind]"
      [size]="size() === 'card' ? 22 : 16"
    />
    <span class="text">
      @if (size() === 'card') {
        <span class="title">{{ result().title }}</span>
        <span class="detail">{{ result().detail }}</span>
      } @else {
        <span class="title">{{ result().short }}</span>
      }
    </span>
  `,
  styleUrl: './check-chip.scss',
  host: {
    '[class]': '"check " + result().tone + " " + size()',
    '[attr.data-kind]': 'result().kind',
    '[attr.data-state]': 'result().state',
    '[attr.title]': 'size() === "mini" ? result().title + ": " + result().detail : null',
  },
})
export class CheckChip {
  /** INBOX-28: no selo mini, o ícone diz a verificação; o tom fica na cor e no texto. */
  protected readonly kindIcons: Record<CheckResult['kind'], IconName> = {
    signature: 'checks',
    schema: 'braces',
    rule: 'bolt',
  };
  readonly result = input.required<CheckResult>();
  readonly size = input<'mini' | 'card'>('mini');
}
