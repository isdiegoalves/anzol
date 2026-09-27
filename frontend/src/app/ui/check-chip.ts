import { Component, computed, input } from '@angular/core';
import type { CheckResult } from '../pipeline/pipeline';
import { Icon } from './icon';

/**
 * Texto do selo `mini` (lista), curto para os três caberem numa linha; o título vai no `title`.
 * Função, não constante: o `$localize` só vale depois da tradução carregada (§ i18n do padrão).
 */
function shortText(key: string): string | undefined {
  switch (key) {
    case 'signature:valid':
      return $localize`Sig OK`;
    case 'signature:invalid':
      return $localize`Bad sig`;
    case 'signature:stale':
      return $localize`Stale sig`;
    case 'signature:absent':
      return $localize`No sig`;
    case 'signature:unchecked':
      return $localize`No sig check`;
    case 'schema:valid':
      return $localize`Schema OK`;
    case 'schema:invalid':
      return $localize`Bad schema`;
    case 'schema:unchecked':
      return $localize`No schema`;
    case 'rule:near-miss':
      return $localize`Near miss`;
    case 'rule:default':
      return $localize`Default`;
    default:
      return undefined;
  }
}

/**
 * O resultado de uma verificação (assinatura, schema ou regra) no mesmo componente em toda tela:
 * `mini` é o selo da lista (texto curto; o título e o motivo no `title`), `card` o cartão do
 * detalhe (título e motivo). Cor nunca sozinha: todo tom tem ícone e texto (WCAG 1.4.1).
 */
@Component({
  selector: 'app-check-chip',
  imports: [Icon],
  template: `
    <app-icon [name]="result().tone" [size]="size() === 'card' ? 22 : 16" />
    <span class="text">
      @if (size() === 'card') {
        <span class="title">{{ result().title }}</span>
        <span class="detail">{{ result().detail }}</span>
      } @else {
        <span class="title">{{ short() }}</span>
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
  readonly result = input.required<CheckResult>();
  readonly size = input<'mini' | 'card'>('mini');

  /** A regra que respondeu aparece pelo nome. */
  protected readonly short = computed(() => {
    const { kind, state, detail } = this.result();
    return kind === 'rule' && state === 'answered'
      ? detail
      : (shortText(`${kind}:${state}`) ?? this.result().title);
  });
}
