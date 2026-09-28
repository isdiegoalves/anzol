import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { RequestStore } from '../requests/request-store';
import { isTyping } from '../shell/hotkeys';
import { ShellSettings } from '../shell/shell-settings';
import { Icon } from '../ui/icon';
import { LiveRegion } from '../ui/live-region';
import { FilterChips } from './filter-chips';
import { FilterPanel } from './filter-panel';
import { WaitFor } from './wait-for';

/** Espera depois da última tecla antes de buscar. */
export const SEARCH_DEBOUNCE_MS = 300;
/** O resultado é dito uma vez, depois que os filtros param de mudar (guia da combinação, B1). */
export const RESULT_ANNOUNCE_MS = 600;

let nextId = 0;

/**
 * A busca da lista numa linha (B1, UX-04): a pílula do texto e o `button "Filters"`, que abre o
 * painel dos chips (tecla F). Só os filtros ligados ficam à vista, na `list "Active filters"`, cada
 * um com o seu "Remove this filter", e o "Clear filters" no fim. A linha do resultado só existe com
 * filtro, e é ela que o leitor de tela ouve: uma vez, 600 ms depois da última mudança; nada de
 * "Searching…" a cada tecla.
 */
@Component({
  selector: 'app-request-search',
  imports: [FilterPanel, Icon, LiveRegion],
  templateUrl: './request-search.html',
  styleUrl: './request-search.scss',
  host: { '(document:keydown)': 'toggleByKey($event)' },
})
export class RequestSearch {
  protected readonly store = inject(RequestStore);
  protected readonly chips = inject(FilterChips);
  protected readonly waitFor = inject(WaitFor);
  private readonly settings = inject(ShellSettings);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly panel = viewChild(FilterPanel);

  protected readonly panelId = `filters-panel-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly removeHint = $localize`Remove this filter`;
  protected readonly removeLabel = (filter: string) =>
    $localize`Remove this filter: ${filter}:filter:`;

  /** Texto digitado; volta ao do filtro quando ele muda por fora (limpar, trocar de URL). */
  protected readonly draft = linkedSignal(() => this.store.filter().text);
  /** "Filters · 2" à vista; "Filters, 2 active" no nome acessível. */
  protected readonly filtersText = computed(() => {
    const count = this.chips.active().length;
    return count === 0 ? $localize`Filters` : $localize`Filters · ${count}:count:`;
  });
  protected readonly filtersName = computed(() => {
    const count = this.chips.active().length;
    return count === 0 ? $localize`Filters` : $localize`Filters, ${count}:count: active`;
  });
  /** Os filtros ligados e, com texto na busca, o texto: cada um se tira sozinho. */
  protected readonly active = computed(() => {
    const text = this.store.filter().text;
    return [
      ...(text
        ? [
            {
              label: $localize`:active filter, the text being searched:Search: ${text}:text:`,
              remove: () => this.removeText(),
            },
          ]
        : []),
      ...this.chips.active().map((chip) => ({ label: chip.label, remove: chip.toggle })),
    ];
  });
  /** Com filtro e sem resultado: o estado vazio da lista tem o seu "Clear filters" (INBOX-25). */
  protected readonly nothingMatches = computed(
    () => this.store.filtering() && !this.store.searching() && this.store.requests().length === 0,
  );
  /** "2 requests match · search runs on the server over all 3" (INBOX-10). */
  private readonly statusLine = computed(() => {
    const [matched, total] = [this.store.matched(), this.store.total()];
    return matched === 1
      ? $localize`1 request matches · search runs on the server over all ${total}:total:`
      : $localize`${matched}:count: requests match · search runs on the server over all ${total}:total:`;
  });
  /** O que a região do resultado diz agora. */
  protected readonly result = signal('');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wasFiltering = false;
  private tokenId: string | null = null;

  constructor() {
    toObservable(this.draft)
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe((text) => {
        // Se o texto mudou por fora durante a espera (a rota, o "Clear filters"), vale o de agora.
        if (text === untracked(this.draft)) {
          this.chips.apply({ text });
        }
      });

    // O "Copy as anzol wait-for" avisa do texto que está no campo, já aplicado ou não.
    effect(() => this.waitFor.typed.set(this.draft()));
    inject(DestroyRef).onDestroy(() => this.waitFor.typed.set(null));

    // O resultado, uma vez: espera a busca voltar e os filtros pararem de mudar.
    effect(() => {
      const filtering = this.store.filtering();
      const waiting = this.store.searching() || this.store.loading();
      const line = filtering ? this.statusLine() : '';
      const tokenId = this.store.tokenId();
      this.store.filter();
      untracked(() => {
        if (tokenId !== this.tokenId) {
          // Outra URL: o que se disse da anterior não vale, e nada foi "limpo".
          this.tokenId = tokenId;
          this.wasFiltering = false;
          this.result.set('');
        }
        this.say(filtering, waiting, line);
      });
    });
    inject(DestroyRef).onDestroy(() => this.stopTimer());
  }

  /** O botão e a tecla F; pela tecla, o foco vai ao primeiro chip. */
  protected toggle(byKey: boolean): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    if (byKey) {
      afterNextRender(() => this.panel()?.focusFirst(), { injector: this.injector });
    }
  }

  /** Fecha o painel e devolve o foco ao botão. */
  protected close(): void {
    this.open.set(false);
    this.host.querySelector<HTMLElement>('.filters')?.focus();
  }

  protected toggleByKey(event: KeyboardEvent): void {
    if (
      event.key.toLowerCase() !== 'f' ||
      !this.settings.shortcuts() ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      isTyping(event)
    ) {
      return;
    }
    event.preventDefault();
    this.toggle(true);
  }

  protected clearFilters(): void {
    this.draft.set('');
    this.chips.clear();
  }

  private removeText(): void {
    this.draft.set('');
    this.chips.apply({ text: '' });
  }

  private say(filtering: boolean, waiting: boolean, line: string): void {
    this.stopTimer();
    if (waiting) {
      return;
    }
    const cleared = this.wasFiltering && !filtering;
    if (!filtering && !cleared) {
      // Sem filtro desde a carga (ou a troca de URL): nada a dizer.
      return;
    }
    // A região nunca é esvaziada para falar de novo: trocar o texto basta (guia §4.3).
    this.timer = setTimeout(() => {
      this.wasFiltering = filtering;
      this.result.set(cleared ? this.withoutFilter(this.chips.takeCleared()) : line);
    }, RESULT_ANNOUNCE_MS);
  }

  /** "Filters cleared. 34 requests." pelo botão; "No filter. 34 requests." ao desligar o último. */
  private withoutFilter(byButton: boolean): string {
    const total = this.store.total();
    const count = total === 1 ? $localize`1 request` : $localize`${total}:count: requests`;
    return byButton
      ? $localize`Filters cleared. ${count}:requests:.`
      : $localize`No filter. ${count}:requests:.`;
  }

  private stopTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
