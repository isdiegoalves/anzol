import { Component, input } from '@angular/core';

/** Como uma condição foi no último teste (RULES-18): passa, falha, ou não há condição. */
export interface ConditionResult {
  kind: 'passes' | 'fails' | 'none';
  text: string;
}

/**
 * O chip à direita de cada condição da aba Match (C, RULES-18): "Passes 196/200" (verde),
 * "Fails on 4/200" (âmbar) ou "No condition" (cinza), e, editando uma regra salva, quantos near
 * misses gravados dela falharam ali. O tom vem de `kind`, nunca do texto (que muda com o idioma).
 */
@Component({
  selector: 'app-condition-result',
  template: `
    @if (result(); as current) {
      <span class="feedback" [class]="current.kind" [attr.data-condition]="key()">{{
        current.text
      }}</span>
    }
    @if (recorded(); as count) {
      <span class="recorded" [attr.data-condition]="key()" i18n
        >Missed here by
        {count, plural, =1 {1 recorded request} other {{{ count }} recorded requests}}</span
      >
    }
  `,
  styleUrl: './condition-result.scss',
})
export class ConditionResultChip {
  readonly key = input.required<string>();
  readonly result = input<ConditionResult | null>(null);
  /** Near misses gravados desta regra que falharam nesta condição. */
  readonly recorded = input(0);
}
