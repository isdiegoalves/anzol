import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { EventGrouping } from '../requests/event-grouping';
import { FilterChips, ValueTarget } from '../search/filter-chips';
import { ANNOUNCEMENT_MS } from '../ui/live-region';

/** O servidor limita o texto do `match`: valor maior não vira filtro, só se copia. */
export const FILTER_VALUE_MAX = 200;

/**
 * Um valor da requisição aberta que vira filtro, com a aparência de texto. "Exclude this value" só
 * no método, o único campo em que o `match` nega. Filtrar não troca a requisição aberta.
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
      (menuClosed)="keepFocus()"
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

    // O respiro alarga o alvo até 24 px (WCAG 2.5.8) sem mover o texto: a margem negativa o devolve.
    .value {
      display: inline;
      margin: -2px -8px;
      padding: 2px 8px;
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

    // O título do detalhe é uma linha só, e o text-overflow dele não chega ao texto de dentro de um
    // botão: o caminho que não cabe termina em reticências aqui.
    :host-context(.route) .value {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: bottom;
    }
  `,
})
export class ValueActions {
  private readonly chips = inject(FilterChips);
  private readonly grouping = inject(EventGrouping);
  private readonly clipboard = inject(Clipboard);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly menu = viewChild.required(MatMenu);

  readonly target = input.required<ValueTarget>();
  readonly label = input.required<string>();
  /** O literal JSON no corpo; sem ele, o próprio valor. */
  readonly shown = input<string | null>(null);

  /** O valor à vista entra no nome (WCAG 2.5.3). */
  protected readonly name = computed(
    () =>
      $localize`${this.label()}:label:: ${this.shown() ?? this.target().value}:value:. Value actions`,
  );
  protected readonly filterable = computed(
    () => this.target().value.length <= FILTER_VALUE_MAX && this.target().value !== '',
  );
  /** Só cabeçalho e campo do corpo têm caminho para copiar e servem de chave do evento. */
  protected readonly fieldKind = computed(() =>
    ['header', 'body'].includes(this.target().kind) ? this.target().kind : null,
  );

  protected focusFirst(): void {
    this.menu().focusFirstItem('keyboard');
  }

  /**
   * Um Esc logo depois de abrir fecha o menu antes de o Material pôr o foco no primeiro item, e ele
   * põe mesmo assim, num menu que está saindo: o foco cairia no body.
   */
  protected keepFocus(): void {
    afterNextRender(
      () => {
        if (document.activeElement?.closest('.mat-mdc-menu-panel')) {
          this.host.querySelector<HTMLElement>('.value')?.focus();
        }
      },
      { injector: this.injector },
    );
  }

  protected filter(exclude: boolean): void {
    this.chips.filterByValue(this.target(), exclude);
  }

  protected copyValue(): void {
    this.clipboard.copy(this.target().value);
    void this.announcer.announce($localize`Value copied.`, ANNOUNCEMENT_MS);
  }

  protected copyPath(): void {
    this.clipboard.copy(this.target().name);
    void this.announcer.announce($localize`Path copied.`, ANNOUNCEMENT_MS);
  }

  protected group(): void {
    const { kind, name } = this.target();
    this.grouping.choose(kind === 'header' ? name.toLowerCase() : name);
  }
}
