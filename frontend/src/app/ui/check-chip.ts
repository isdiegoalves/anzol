import { NgTemplateOutlet } from '@angular/common';
import { Component, TemplateRef, computed, input } from '@angular/core';
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
  imports: [Icon, NgTemplateOutlet, RouterLink],
  template: `
    <app-icon
      [name]="size() === 'card' ? result().tone : kindIcons[result().kind]"
      [size]="size() === 'card' ? 22 : 16"
    />
    @if (!iconOnly()) {
      <span class="text">
        @if (size() === 'card') {
          @let target = link();
          @if (titleParts(); as parts) {
            <!-- O trecho do título que vira valor clicável (o status); o resto segue o link. -->
            <!-- prettier-ignore -->
            <span class="title">{{ parts.before }}<ng-container [ngTemplateOutlet]="parts.template" [ngTemplateOutletContext]="{ $implicit: parts.value }" />{{ parts.separator }}@if (target?.part === 'title') {<a class="link" [routerLink]="target?.commands" [queryParams]="target?.queryParams">{{ parts.after }}</a>} @else {{{ parts.after }}}</span>
          } @else if (target?.part === 'title') {
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
              }}<a
                class="link"
                [routerLink]="target?.commands"
                [queryParams]="target?.queryParams"
                >{{ parts[1] }}</a
              >{{ parts[2] }}</span
            >
          } @else {
            <span class="detail">{{ result().detail }}</span>
          }
          <!-- O que mais a tela sabe, com a ressalva certa ("Retry-After: 5 (as configured now)"). -->
          @for (note of notes(); track note) {
            <span class="note">{{ note }}</span>
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
    }
  `,
  styleUrl: './check-chip.scss',
  host: {
    '[class]': '"check " + result().tone + " " + size()',
    '[attr.data-kind]': 'result().kind',
    '[attr.data-state]': 'result().state',
    '[attr.title]': 'size() === "mini" ? spoken() : null',
    '[class.icon-only]': 'iconOnly()',
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

  /** F1: um trecho do título (o status respondido) desenhado por quem usa o cartão. */
  readonly titleValue = input<{
    text: string;
    template: TemplateRef<{ $implicit: string }>;
  } | null>(null);

  /** Linhas a mais no cartão, embaixo do motivo. */
  readonly notes = input<readonly string[]>([]);
  /**
   * A verificação que passou ou que não roda fica só no ícone (o veredito no `title`): o texto vai
   * para o que pede atenção. O status respondido é sempre texto.
   */
  readonly quiet = input(false);
  protected readonly iconOnly = computed(() => {
    const { tone, kind } = this.result();
    return this.quiet() && (tone === 'ok' || tone === 'none') && kind !== 'rule';
  });

  /** O veredito inteiro, no `title` do selo. */
  protected readonly spoken = computed(() => spokenOf(this.result()));

  /** O título partido em volta do valor: antes, o valor, o separador e o resto. */
  protected readonly titleParts = computed(() => {
    const value = this.titleValue();
    const title = this.result().title;
    const at = value ? title.indexOf(value.text) : -1;
    if (!value || at < 0) {
      return null;
    }
    const rest = title.slice(at + value.text.length);
    const separator = /^\s*·\s*/.exec(rest)?.[0] ?? '';
    return {
      before: title.slice(0, at),
      value: value.text,
      template: value.template,
      separator,
      after: rest.slice(separator.length),
    };
  });

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

/** O veredito como o nome acessível do item o diz: a frase própria, ou "título: motivo". */
export function spokenOf(result: CheckResult): string {
  return result.spoken ?? `${result.title}: ${result.detail}`;
}
