import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CheckResult } from '../pipeline/pipeline';
import { Icon, IconName } from './icon';

/**
 * Link no cartão (WM-10): `text` é o trecho que vira link — o título inteiro ou, no motivo, o
 * nome da regra.
 */
export interface ChipLink {
  part: 'title' | 'detail';
  text: string;
  commands: readonly string[];
  queryParams?: Record<string, string>;
}

/**
 * O resultado de uma verificação (assinatura, schema ou regra) no mesmo componente em toda tela:
 * `mini` é o selo da lista (o `short` do resultado, INBOX-13, com o ícone da verificação, INBOX-28; o
 * título e o motivo no `title`), `card` o cartão do detalhe (ícone do tom, título e motivo). Cor nunca sozinha: todo tom tem ícone e texto (WCAG 1.4.1).
 */
@Component({
  selector: 'app-check-chip',
  imports: [Icon, RouterLink],
  template: `
    <app-icon
      [name]="size() === 'card' ? result().tone : kindIcons[result().kind]"
      [size]="size() === 'card' ? 22 : 16"
    />
    <span class="text">
      @if (size() === 'card') {
        @let target = link();
        @if (target?.part === 'title') {
          <a
            class="title link"
            [routerLink]="target?.commands"
            [queryParams]="target?.queryParams"
            >{{ result().title }}</a
          >
        } @else {
          <span class="title">{{ result().title }}</span>
        }
        @if (detailParts(); as parts) {
          <span class="detail"
            >{{ parts[0]
            }}<a class="link" [routerLink]="target?.commands" [queryParams]="target?.queryParams">{{
              parts[1]
            }}</a
            >{{ parts[2] }}</span
          >
        } @else {
          <span class="detail">{{ result().detail }}</span>
        }
        @if (extra(); as more) {
          <a class="extra link" [routerLink]="more.commands" [queryParams]="more.queryParams">{{
            more.text
          }}</a>
        }
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
  /** Só no cartão, e fora de botão: o selo da lista fica dentro do botão do item (axe). */
  readonly link = input<ChipLink | null>(null);
  /** Um link a mais, numa linha embaixo do motivo (o "Default response" do near miss, WM-10). */
  readonly extra = input<Omit<ChipLink, 'part'> | null>(null);

  /** O motivo partido em volta do trecho que vira link: antes, o link, depois. */
  protected readonly detailParts = computed(() => {
    const link = this.link();
    const detail = this.result().detail;
    const at = link?.part === 'detail' ? detail.indexOf(link.text) : -1;
    return link && at >= 0
      ? [detail.slice(0, at), link.text, detail.slice(at + link.text.length)]
      : null;
  });
}
