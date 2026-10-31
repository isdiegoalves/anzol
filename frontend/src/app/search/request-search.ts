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
import { EventGrouping } from '../requests/event-grouping';
import { eventCount } from '../requests/event-key';
import { RequestStore } from '../requests/request-store';
import { isTyping } from '../shell/hotkeys';
import { ShellSettings } from '../shell/shell-settings';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { LiveRegion } from '../ui/live-region';
import { SlowNotice } from '../ui/slow-notice';
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
  imports: [FilterPanel, Icon, LiveRegion, SlowNotice],
  templateUrl: './request-search.html',
  styleUrl: './request-search.scss',
  host: { '(document:keydown)': 'toggleByKey($event)' },
})
export class RequestSearch {
  protected readonly store = inject(RequestStore);
  protected readonly chips = inject(FilterChips);
  protected readonly waitFor = inject(WaitFor);
  private readonly grouping = inject(EventGrouping);
  private readonly settings = inject(ShellSettings);
  private readonly tokens = inject(TokenStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly panel = viewChild(FilterPanel);

  protected readonly panelId = `filters-panel-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly removeHint = $localize`Remove this filter`;
  protected readonly removeLabel = (filter: string) =>
    $localize`Remove this filter: ${filter}:filter:`;

  /** Com a decifra na URL, o texto também procura no valor decifrado (só a API REST e a tela). */
  protected readonly placeholder = computed(() =>
    this.tokens.shown()?.e2ee
      ? $localize`Search path, IP, header, body or decrypted value`
      : $localize`Search path, IP, header or body`,
  );
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
      ...this.chips.active().map((chip) => ({
        label: chip.active ?? chip.label,
        remove: chip.toggle,
      })),
      // O recusado fica à vista, marcado, mas não conta nos ligados.
      ...this.chips.rejected().map((chip) => ({ label: chip.label, remove: chip.toggle })),
    ];
  });

  /** Com filtro e sem resultado: o estado vazio da lista tem o seu "Clear filters" (INBOX-25). */
  protected readonly nothingMatches = computed(
    () => this.store.filtering() && !this.store.searching() && this.store.requests().length === 0,
  );
  /** "2 requests match · search runs on the server over all 3" (INBOX-10). */
  private readonly statusLine = computed(() => {
    const [matched, total] = [this.store.matched(), this.store.total()];
    const windowed = this.chips.windowResult();
    if (windowed) {
      return windowed;
    }
    const key = this.grouping.key();
    if (key) {
      // A busca conta requisições; a tela agrupa o resultado e diz em quantos eventos.
      const events = eventCount(this.store.requests(), key);
      const found =
        matched === 1 ? $localize`1 request matches` : $localize`${matched}:count: requests match`;
      const inEvents =
        events === 1 ? $localize`in 1 event` : $localize`in ${events}:events: events`;
      return $localize`${found}:found:, ${inEvents}:events: · search runs on the server over all ${total}:total:`;
    }
    return matched === 1
      ? $localize`1 request matches · search runs on the server over all ${total}:total:`
      : $localize`${matched}:count: requests match · search runs on the server over all ${total}:total:`;
  });
  /** O tamanho da janela da rota, com requisições anteriores a ela por procurar; `null` sem elas. */
  protected readonly before = computed(() => {
    const more = this.store.newestWindow()?.more ?? false;
    const idle = !this.store.searching() && !this.store.windowReading();
    return more && idle ? (this.store.filter().window ?? null) : null;
  });
  /** O que a região do resultado diz agora. */
  protected readonly result = signal('');
  /** Troca a cada linha posta sem fala: a região de resultado nasce de novo, já com o texto. */
  protected readonly quietTurn = signal(0);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wasFiltering = false;
  private recounted = this.store.recounted();
  private tokenId: string | null = null;
  /** Aberta por um link filtrado (Métricas, Saúde): o primeiro resultado diz o filtro. */
  private arrivedFiltered = false;

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
      const failure = this.store.failure();
      const line =
        failure?.kind === 'search'
          ? $localize`Could not search (${failure.status}:status:).`
          : filtering
            ? this.statusLine()
            : '';
      const tokenId = this.store.tokenId();
      const recounted = this.store.recounted();
      this.store.filter();
      untracked(() => {
        if (tokenId !== this.tokenId) {
          // Outra URL: o que se disse da anterior não vale, e nada foi "limpo".
          this.tokenId = tokenId;
          this.wasFiltering = false;
          this.arrivedFiltered = filtering;
          this.result.set('');
        }
        const byEvent = recounted !== this.recounted;
        this.recounted = recounted;
        if (byEvent && filtering && !waiting && !failure && !this.timer) {
          this.showQuietly(line);
        } else {
          this.say(filtering, waiting, line);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => this.stopTimer());

    // Com esta linha na tela, é ela que fala o resultado do filtro por valor, e não o anunciador.
    inject(DestroyRef).onDestroy(this.chips.listen());

    effect(() => {
      const said = this.grouping.said();
      if (said) {
        untracked(() => this.result.set(said.text));
      }
    });

    // O painel pedido de fora (o "+N regras" do circuito): abre, ou fica aberto, com o foco no primeiro chip.
    let asked = untracked(this.chips.panelAsked);
    effect(() => {
      const now = this.chips.panelAsked();
      if (now !== asked) {
        asked = now;
        untracked(() => this.openWithFocus());
      }
    });
  }

  /** O botão e a tecla F; pela tecla, o foco vai ao primeiro chip. */
  protected toggle(byKey: boolean): void {
    if (this.open()) {
      this.close();
      return;
    }
    if (byKey) {
      this.openWithFocus();
    } else {
      this.open.set(true);
    }
  }

  private openWithFocus(): void {
    this.open.set(true);
    afterNextRender(() => this.panel()?.focusFirst(), { injector: this.injector });
  }

  /** Fecha o painel e devolve o foco ao botão. */
  protected close(): void {
    this.open.set(false);
    this.focusFilters();
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
    this.focusFilters();
  }

  /** O botão do filtro tirado sai da tela: o foco vai a "Filters". */
  protected remove(remove: () => void): void {
    remove();
    this.focusFilters();
  }

  private focusFilters(): void {
    this.host.querySelector<HTMLElement>('.filters')?.focus();
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
      this.timer = null;
      this.wasFiltering = filtering;
      this.result.set(cleared ? this.withoutFilter(this.chips.takeCleared()) : this.said(line));
    }, RESULT_ANNOUNCE_MS);
  }

  /**
   * A contagem mudou porque uma requisição foi apagada, devolvida ou chegou, e disso quem fala é o
   * aviso da requisição ou o anúncio da chegada: a região nasce de novo com a linha nova, e região
   * que nasce com texto não é anunciada.
   */
  private showQuietly(line: string): void {
    const region = () => this.host.querySelector<HTMLElement>('app-live-region.count');
    const focused = region() === this.host.ownerDocument.activeElement;
    this.result.set(line);
    this.quietTurn.update((turn) => turn + 1);
    if (focused) {
      afterNextRender(() => region()?.focus(), { injector: this.injector });
    }
  }

  /** Na chegada por um link filtrado, diz também onde a pessoa está ("Inbox. Filtered by …"). */
  private said(line: string): string {
    const added = this.chips.takeAdded();
    if (this.arrivedFiltered) {
      this.arrivedFiltered = false;
      return $localize`Inbox. Filtered by ${this.chips.describe()}:filters:. ${line}:result:`;
    }
    return added ? $localize`Filtered by ${added}:filter:. ${line}:result:` : line;
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
