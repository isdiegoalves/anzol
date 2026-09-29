import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { Component, computed, inject, input, viewChild } from '@angular/core';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { EventGrouping } from '../requests/event-grouping';
import { FilterChips, ValueTarget } from '../search/filter-chips';

/** O servidor limita o texto do `match`: valor maior não vira filtro, só se copia. */
export const FILTER_VALUE_MAX = 200;

/**
 * Um valor da requisição aberta que vira filtro (F1, CA-12): sem caixa, com a aparência de texto;
 * a pista fica no ponteiro (sublinhado pontilhado) e no foco. O clique abre o `menu "Value
 * actions"` com o primeiro item já em foco: "Filter by this value", "Exclude this value" (só no
 * método, onde o `match` nega), "Copy value", "Copy path" (cabeçalho e corpo) e, com a E1, "Group
 * by this field". Filtrar não troca a requisição aberta, e o foco volta ao valor.
 */
@Component({
  selector: 'app-value',
  imports: [MatMenu, MatMenuItem, MatMenuTrigger],
  template: `
    <button
      type="button"
      class="value"
      [attr.aria-label]="name()"
      [matMenuTriggerFor]="menu"
      (menuOpened)="focusFirst()"
    >
      <ng-content />
    </button>
    <mat-menu #menu="matMenu" aria-label="Value actions" i18n-aria-label>
      @if (filterable()) {
        <button mat-menu-item type="button" (click)="filter(false)">
          <ng-container i18n>Filter by this value</ng-container>
        </button>
      }
      @if (target().kind === 'method') {
        <button mat-menu-item type="button" (click)="filter(true)">
          <ng-container i18n>Exclude this value</ng-container>
        </button>
      }
      <button mat-menu-item type="button" (click)="copyValue()">
        <ng-container i18n>Copy value</ng-container>
      </button>
      @if (fieldKind()) {
        <button mat-menu-item type="button" (click)="copyPath()">
          <ng-container i18n>Copy path</ng-container>
        </button>
        <button mat-menu-item type="button" (click)="group()">
          <ng-container i18n>Group by this field</ng-container>
        </button>
      }
    </mat-menu>
  `,
  styles: `
    :host {
      display: inline;
    }

    .value {
      display: inline;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: inherit;
      cursor: pointer;

      &:hover {
        text-decoration: underline dotted;
        text-underline-offset: 3px;
      }

      &:focus-visible {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: 1px;
      }
    }
  `,
})
export class ValueActions {
  private readonly chips = inject(FilterChips);
  private readonly grouping = inject(EventGrouping);
  private readonly clipboard = inject(Clipboard);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly menu = viewChild.required(MatMenu);

  readonly target = input.required<ValueTarget>();
  /** O rótulo do valor no nome acessível: o cabeçalho, o parâmetro, o JSONPath, "Method"… */
  readonly label = input.required<string>();
  /** Como o valor aparece (o literal JSON no corpo); sem ele, o próprio valor. */
  readonly shown = input<string | null>(null);

  /** "{label}: {value}. Value actions" (o valor à vista está no nome, WCAG 2.5.3). */
  protected readonly name = computed(
    () =>
      $localize`${this.label()}:label:: ${this.shown() ?? this.target().value}:value:. Value actions`,
  );
  protected readonly filterable = computed(
    () => this.target().value.length <= FILTER_VALUE_MAX && this.target().value !== '',
  );
  /** Cabeçalho e campo do corpo: têm caminho para copiar e servem de chave do evento (E1). */
  protected readonly fieldKind = computed(() =>
    ['header', 'body'].includes(this.target().kind) ? this.target().kind : null,
  );

  protected focusFirst(): void {
    this.menu().focusFirstItem('keyboard');
  }

  protected filter(exclude: boolean): void {
    this.chips.filterByValue(this.target(), exclude);
  }

  protected copyValue(): void {
    this.clipboard.copy(this.target().value);
    void this.announcer.announce($localize`Value copied.`);
  }

  protected copyPath(): void {
    this.clipboard.copy(this.target().name);
    void this.announcer.announce($localize`Path copied.`);
  }

  protected group(): void {
    const { kind, name } = this.target();
    this.grouping.choose(kind === 'header' ? name.toLowerCase() : name);
  }
}
