import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HitsView, hitsText } from './rule-list';

/**
 * Linha 3 do item da lista (RULES-01), fora do botão da linha: "Answered 4 of the last 8" e
 * "3 near misses" levam à Entrada filtrada pelas mensagens que a regra respondeu, ou de que foi
 * quase acerto (C2, WM-27). Sem hits (desligada, diagnóstico, sem `stats`), só o texto.
 */
@Component({
  selector: 'app-rule-hits',
  imports: [RouterLink],
  template: `
    @if (parts(); as view) {
      @if (view.prefix) {
        {{ view.prefix }} ·&ngsp;
      }
      <a [routerLink]="['/', tokenId()]" [queryParams]="filter('rule')">{{ view.answered }}</a>
      @if (view.near) {
        &ngsp;·&ngsp;<a [routerLink]="['/', tokenId()]" [queryParams]="filter('near_miss')">{{
          view.near
        }}</a>
      }
    } @else {
      {{ text() }}
    }
  `,
  styleUrl: './rule-hits.scss',
  host: { class: 'line3 hits', '[class.warn]': 'warn()' },
})
export class RuleHits {
  readonly view = input.required<HitsView | string | null>();
  readonly tokenId = input.required<string>();
  readonly ruleId = input<string | undefined>(undefined);
  readonly ruleName = input('');
  /** A linha é a causa de um diagnóstico (nunca casa, sombreada). */
  readonly warn = input(false);

  /** As contagens como links, quando há o que filtrar. */
  protected readonly parts = computed(() => {
    const view = this.view();
    return view && typeof view !== 'string' && !('text' in view) && this.ruleId() ? view : null;
  });
  protected readonly text = computed(() => {
    const view = this.view();
    return view === null ? '' : typeof view === 'string' ? view : hitsText(view);
  });

  protected filter(outcome: 'rule' | 'near_miss'): Record<string, string> {
    return { outcome, rule: this.ruleId() ?? '', ruleName: this.ruleName() };
  }
}
