import { Component, computed, input, model } from '@angular/core';
import { RuleFilter, isFiltering } from './rule-list';

/**
 * Filtro da lista de regras (WM-03), sempre à vista e compacto: o texto procura no nome, no match,
 * no cenário e nos selos; os chips "No hits" (sem `stats`, desabilitado) e "Off". Ao filtrar, diz
 * quantas das regras sobraram.
 */
@Component({
  selector: 'app-rule-list-filter',
  template: `
    <input
      class="text"
      type="search"
      aria-label="Filter rules"
      i18n-aria-label
      placeholder="Filter rules"
      i18n-placeholder
      [value]="filter().text"
      (input)="setText($event)"
    />
    <button
      type="button"
      class="chip"
      [attr.aria-pressed]="filter().noHits"
      [disabled]="!hitsLoaded()"
      [attr.title]="hitsLoaded() ? null : hitsNotLoaded"
      (click)="toggle('noHits')"
      i18n="filter chip|Rules that answered nothing in the window"
    >
      No hits
    </button>
    <button
      type="button"
      class="chip"
      [attr.aria-pressed]="filter().off"
      (click)="toggle('off')"
      i18n="filter chip|Rules that are turned off"
    >
      Off
    </button>
    <span class="count" role="status">{{ countText() }}</span>
  `,
  styleUrl: './rule-list-filter.scss',
})
export class RuleListFilter {
  readonly filter = model.required<RuleFilter>();
  /** Os hits de `stats` chegaram: sem eles, "No hits" não tem como filtrar. */
  readonly hitsLoaded = input(false);
  readonly shown = input(0);
  readonly total = input(0);

  protected readonly hitsNotLoaded = $localize`Hits not loaded yet`;
  /** "3 of 7 rules" só enquanto filtra (o `status` fica, vazio, para anunciar a mudança). */
  protected readonly countText = computed(() => {
    if (!isFiltering(this.filter())) {
      return '';
    }
    const [shown, total] = [this.shown(), this.total()];
    return total === 1
      ? $localize`${shown}:shown: of 1 rule`
      : $localize`${shown}:shown: of ${total}:total: rules`;
  });

  protected setText(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.filter.update((filter) => ({ ...filter, text }));
  }

  protected toggle(chip: 'noHits' | 'off'): void {
    this.filter.update((filter) => ({ ...filter, [chip]: !filter[chip] }));
  }
}
