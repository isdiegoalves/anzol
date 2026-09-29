import { CdkVirtualForOf, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { CompareStore } from '../diff/compare-store';
import { CompareBand } from './compare-band';
import { ListFooter } from './list-footer';
import { CheckResult, pipelineOf } from '../pipeline/pipeline';
import { fromNow, localDate } from '../request-detail/dates';
import { RequestSearch } from '../search/request-search';
import { ShellSettings } from '../shell/shell-settings';
import { Viewport } from '../shell/viewport';
import { TokenStore } from '../token/token-store';
import { CheckChip, spokenOf } from '../ui/check-chip';
import { EmptyState } from '../ui/empty-state';
import { Icon } from '../ui/icon';
import { MethodBadge } from '../ui/method-badge';
import { SkeletonList } from '../ui/skeleton-list';
import { NewPill } from './new-pill';
import { FilterChips } from '../search/filter-chips';
import { EventBar } from './event-bar';
import { EventGrouping } from './event-grouping';
import { groupByEvent } from './event-key';
import { EventLine } from './event-line';
import { EventNote } from './event-note';
import { ListRow, routeCut, rowsOf } from './list-rows';
import { RequestStore } from './request-store';
import { RowSizes } from './row-sizes';
import { SealFilter } from './seal-filter';
import { WebhookRequest } from './webhook-request';

/** De quanto em quanto tempo o tempo relativo dos itens ("2 minutes ago") é refeito. */
export const AGO_REFRESH_MS = 30_000;
/** Campos do JSON que dizem o tipo do evento, na ordem em que os provedores costumam usar. */
const EVENT_FIELDS = ['type', 'event', 'event_type', 'action', 'topic'] as const;

/**
 * O tipo do evento do JSON (`type`, `event`…), ou `null`. Corpo grande não é lido (a lista não
 * paga o parse).
 */
export function eventType(request: WebhookRequest): string | null {
  const content = request.content;
  if (content && content.length <= 100_000 && content.trimStart().startsWith('{')) {
    try {
      const body = JSON.parse(content) as Record<string, unknown>;
      const event = EVENT_FIELDS.map((field) => body[field]).find(
        (value) => typeof value === 'string' && value !== '',
      );
      return typeof event === 'string' ? event : null;
    } catch {
      // Não é JSON.
    }
  }
  return null;
}

/**
 * O resumo do corpo (protótipo C, INBOX-11): o tipo do evento do JSON, senão o user-agent. Na lista
 * (B1) só o tipo aparece; o agente fica no detalhe e no Compare.
 */
export function bodySummary(request: WebhookRequest): string {
  return eventType(request) ?? request.user_agent ?? '';
}

/** Altura fixa de um item de duas linhas (B1, lista densa), para a rolagem virtual. */
export const ITEM_HEIGHT = 40;
/**
 * Na densidade compacta de Settings (S17), as mesmas duas linhas em 36 px: o conteúdo cabe inteiro
 * (17 px + 18 px de linha) e o alvo do item e o da lixeira (32 px) seguem acima de 24 px.
 */
export const ITEM_HEIGHT_COMPACT = 36;
/** No celular, o item de duas linhas tem alvo de toque maior, em qualquer densidade. */
export const ITEM_HEIGHT_TOUCH = 64;
/** Quanto tempo a mensagem que acabou de chegar fica destacada. */
export const FRESH_MS = 3000;
/** Quanto tempo o "Undo" do apagar fica disponível antes de apagar no servidor. */
export const UNDO_MS = 4000;

/** O que a linha mostra de uma mensagem. */
export interface ItemView {
  request: WebhookRequest;
  route: string;
  /** O caminho em duas partes: o começo cede (reticências) e o fim fica. */
  head: string;
  tail: string;
  /** Tempo relativo ("a few seconds ago"), na linha 1. */
  ago: string;
  /** O tipo do evento do JSON, na linha 2 (INBOX-11); vazio sem ele. */
  summary: string;
  /** Selos que dizem algo (a verificação existia): assinatura, schema, regra. */
  seals: CheckResult[];
  label: string;
  /** `null` na falha de rede e sem registro: não há status para filtrar. */
  status: string | null;
}

/**
 * Lista da Inbox: itens de duas linhas e 40 px (método, caminho e tempo; selos, tipo do evento e
 * `#id`), busca e filtros, rodapé "1–50 of N" com as páginas, não lidas, a lixeira com "Undo" e a
 * pílula das novas, numa faixa acima da lista. A lista é uma parada só do Tab: ↑ e ↓ andam entre os
 * itens sem abrir, Enter abre. No "Compare with…", clicar escolhe a B.
 */
@Component({
  selector: 'app-request-list',
  imports: [
    CompareBand,
    ListFooter,
    CdkVirtualScrollViewport,
    CdkVirtualForOf,
    CheckChip,
    EmptyState,
    EventBar,
    EventLine,
    EventNote,
    Icon,
    MatButton,
    MatProgressSpinner,
    MethodBadge,
    NewPill,
    RequestSearch,
    RowSizes,
    SealFilter,
    SkeletonList,
  ],
  templateUrl: './request-list.html',
  styleUrl: './request-list.scss',
  host: { '[class.touch]': 'touch()', '[class.dense]': 'dense()' },
})
export class RequestList {
  protected readonly store = inject(RequestStore);
  protected readonly compare = inject(CompareStore);
  private readonly chips = inject(FilterChips);
  protected readonly grouping = inject(EventGrouping);
  private readonly document = inject(DOCUMENT);
  private readonly tokens = inject(TokenStore);
  protected readonly settings = inject(ShellSettings);
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly windowClass = inject(Viewport).windowClass;
  private readonly viewport = viewChild(CdkVirtualScrollViewport);

  readonly openRequest = output<WebhookRequest>();
  /** Aberta pelo teclado (Enter no item): o foco vai ao título do detalhe. */
  readonly openedByKey = output<WebhookRequest>();
  /** Celular: o item de duas linhas tem 64 px. */
  protected readonly touch = computed(() => this.windowClass() === 'compact');
  /** Densidade compacta de Settings, fora do celular. */
  protected readonly dense = computed(() => !this.touch() && this.settings.density() === 'compact');
  protected readonly itemHeight = computed(() =>
    this.touch() ? ITEM_HEIGHT_TOUCH : this.dense() ? ITEM_HEIGHT_COMPACT : ITEM_HEIGHT,
  );
  /** O item em que o foco do teclado está (ou esteve por último). */
  protected readonly cursor = signal<string | null>(null);
  /**
   * A parada do Tab: a linha do cursor; sem ela na lista, a aberta (ou o evento recolhido dela); sem
   * ela, a primeira.
   */
  protected readonly stop = computed(() => {
    const rows = this.rows().filter((row) => this.focusable(row));
    const has = (id: string | null | undefined) => !!id && rows.some((row) => row.id === id);
    const cursor = this.cursor();
    const selected = this.store.selected()?.uuid;
    if (has(cursor)) {
      return cursor;
    }
    const index = selected ? this.rowIndexOf(selected) : -1;
    return index >= 0 ? this.rows()[index].id : rows[0]?.id;
  });
  /** A linha visível do celular (INBOX-34): "57 requests · newest first". */
  protected readonly orderLine = computed(() => {
    const total = this.store.total();
    const count = total === 1 ? $localize`1 request` : $localize`${total}:count: requests`;
    return this.store.newestFirst()
      ? $localize`${count}:count: · newest first`
      : $localize`${count}:count: · oldest first`;
  });
  /** Nomes acessíveis com valor: `$localize` no TS (o `aria-label` interpolado não vira atributo). */
  protected readonly deleteLabel = (uuid: string) => $localize`Delete request ${uuid}:uuid:`;

  /** Limite da limpeza automática da URL aberta, mostrado ao lado do total. */
  protected readonly limit = computed(() => this.tokens.token()?.auto_cleanup ?? null);
  protected readonly cleanupHint = computed(() => {
    const limit = this.limit();
    return limit ? $localize`Auto cleanup keeps the ${limit}:limit: most recent requests` : null;
  });
  protected readonly count = computed(() => {
    const limit = this.limit();
    const total = limit === null ? `${this.store.total()}` : `${this.store.total()} / ${limit}`;
    // Com filtro (texto, chips ou o desfecho do C2), quantas sobraram de quantas (L9).
    return this.store.filtering()
      ? $localize`${this.store.matched()}:matched: of ${total}:total:`
      : total;
  });
  /** Consulta por linha desenhada: com milhares de não lidas, `includes` na lista pesaria. */
  private readonly unreadIds = computed(() => new Set(this.store.unread()));
  /** As não lidas da URL, ao lado do heading (INBOX-07). */
  protected readonly unreadCount = computed(() => this.store.unread().length);

  /** Relógio do tempo relativo, refeito a cada AGO_REFRESH_MS. */
  private readonly now = signal(Date.now());
  protected readonly rows = computed((): ListRow<ItemView>[] => {
    const now = this.now();
    const requests = this.store.requests();
    const itemOf = (request: WebhookRequest) => this.itemOf(request, now);
    const key = this.grouping.key();
    if (!key) {
      return requests.map((request) => ({
        kind: 'item',
        id: request.uuid,
        item: itemOf(request),
        value: null,
        attempt: null,
        event: null,
        hit: false,
      }));
    }
    const limit = this.limit();
    const oldest = this.store.newestFirst() ? requests[requests.length - 1] : requests[0];
    return rowsOf(groupByEvent(requests, this.grouping.context(), key), {
      itemOf,
      expanded: this.grouping.expanded(),
      showingAll: this.grouping.showingAll(),
      compact: this.touch(),
      filtering: this.store.filtering(),
      kept: limit !== null && this.store.total() >= limit,
      cut: !this.store.filtering() && this.store.hasNextPage() && oldest ? oldest.uuid : null,
      askedBy: this.grouping.askedBy,
      language: this.document.documentElement.lang || 'en',
    });
  });
  protected readonly sizes = computed(() => {
    const [item, touch] = [this.itemHeight(), this.touch()];
    const heights: Record<ListRow<ItemView>['kind'], number> = {
      item,
      event: touch ? 84 : item,
      wait: touch ? 64 : 48,
      more: touch ? 48 : 40,
      note: touch ? 64 : 48,
    };
    return this.rows().map((row) => heights[row.kind]);
  });
  /** O botão de ordem do cabeçalho (INBOX-01): diz a ordem atual e que troca. */
  protected readonly orderLabel = computed(() =>
    this.store.newestFirst()
      ? $localize`Sorted newest first. Change order`
      : $localize`Sorted oldest first. Change order`,
  );

  /** Mensagens novas que chegaram abaixo da vista (a pílula "N new requests"). */
  readonly newBelow = signal(0);
  /** As que acabaram de chegar, destacadas por alguns segundos. */
  protected readonly fresh = signal<ReadonlySet<string>>(new Set());

  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    const clock = setInterval(() => this.now.set(Date.now()), AGO_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      this.timers.forEach(clearTimeout);
      clearInterval(clock);
    });
  }

  /** O "Clear filters" do estado vazio (INBOX-25): a lista completa de volta. */
  protected clearFilters(): void {
    this.chips.clear();
  }

  protected changeOrder(): void {
    this.newBelow.set(0);
    void this.store.toggleSorting();
  }

  protected isUnread(request: WebhookRequest): boolean {
    return this.unreadIds().has(request.uuid);
  }

  protected choose(request: WebhookRequest, event?: MouseEvent): void {
    if (this.compare.picking()) {
      this.compare.choose(request);
      return;
    }
    this.openRequest.emit(request);
    // Enter e Espaço chegam como clique sem ponteiro (`detail` 0).
    if (event?.detail === 0) {
      this.openedByKey.emit(request);
    }
  }

  /**
   * ↑ e ↓ (e Home e End) levam o foco a outra linha, sem abrir. Na linha de evento, → expande (e,
   * expandida, vai à primeira tentativa) e ← recolhe; na tentativa, ← volta à linha do evento.
   */
  protected move(event: KeyboardEvent, index: number): void {
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    const rows = this.rows();
    const row = rows[index];
    const stops = rows.flatMap((each, i) => (this.focusable(each) ? [i] : []));
    let to: number | undefined;
    switch (event.key) {
      case 'ArrowDown':
        to = stops.find((i) => i > index) ?? index;
        break;
      case 'ArrowUp':
        to = [...stops].reverse().find((i) => i < index) ?? index;
        break;
      case 'Home':
        to = stops[0];
        break;
      case 'End':
        to = stops[stops.length - 1];
        break;
      case 'ArrowRight':
        if (row?.kind === 'event') {
          if (!row.event.expanded) {
            event.preventDefault();
            this.grouping.expand(row.event.value, true);
            return;
          }
          to = stops.find((i) => i > index);
        }
        break;
      case 'ArrowLeft':
        if (row?.kind === 'event' && row.event.expanded) {
          event.preventDefault();
          this.grouping.expand(row.event.value, false);
          return;
        }
        if (row?.kind === 'item' && row.event !== null) {
          to = rows.findIndex((each) => each.id === `event:${row.event}`);
        }
        break;
    }
    if (to === undefined || to < 0) {
      return;
    }
    event.preventDefault();
    this.focusItem(rows[to].id, to);
  }

  protected focusable(row: ListRow<ItemView>): boolean {
    return row.kind === 'item' || row.kind === 'event' || row.kind === 'more';
  }

  /** A linha que mostra a requisição: a dela, ou a do evento recolhido em que ela está. */
  private rowIndexOf(uuid: string): number {
    const rows = this.rows();
    const own = rows.findIndex((row) => row.id === uuid);
    return own >= 0
      ? own
      : rows.findIndex((row) => row.kind === 'event' && row.event.ids.includes(uuid));
  }

  /** O item aberto mudou por J ou K: a parada do Tab (e o foco, se estava na lista) acompanha. */
  follow(uuid: string): void {
    const index = this.rowIndexOf(uuid);
    if (index < 0) {
      return;
    }
    const id = this.rows()[index].id;
    if (this.host.contains(this.host.ownerDocument.activeElement)) {
      this.focusItem(id, index);
    } else {
      this.cursor.set(id);
    }
  }

  /**
   * Uma mensagem chegou (já está na ponta das novas: o topo, com a mais nova primeiro): fica
   * destacada; se essa ponta estava à vista, a lista acompanha; se não, a vista fica onde estava.
   * Se a tela não a abriu (`opened`), ela conta na pílula das novas. Devolve se a nova ficou à vista.
   */
  receive(request: WebhookRequest, opened = false): boolean {
    this.fresh.update((fresh) => new Set([...fresh, request.uuid]));
    this.later(
      () => this.fresh.update((fresh) => new Set([...fresh].filter((id) => id !== request.uuid))),
      FRESH_MS,
    );
    const inView = this.store.newestFirst() ? this.wasAtTop() : this.wasAtEnd();
    if (inView) {
      afterNextRender(() => this.scrollToNewest(), { injector: this.injector });
    } else if (this.store.newestFirst()) {
      // A nova entrou acima: sem compensar, a vista desceria um item.
      const viewport = this.viewport();
      const offset = viewport?.measureScrollOffset('top') ?? 0;
      afterNextRender(() => viewport?.scrollToOffset(offset + this.itemHeight()), {
        injector: this.injector,
      });
    }
    if (!opened) {
      this.newBelow.update((count) => count + 1);
    }
    return inView;
  }

  /** Põe o foco no item aberto (a volta do detalhe em tela cheia, o Esc), rolando até ele. */
  focusSelected(): void {
    const selected = this.store.selected();
    const index = selected ? this.rowIndexOf(selected.uuid) : -1;
    if (index >= 0) {
      this.focusItem(this.rows()[index].id, index, true);
    }
  }

  /** Leva o foco à linha; se a lista virtual ainda não a desenhou, rola até ela antes. */
  private focusItem(id: string, index: number, scroll = false): void {
    this.cursor.set(id);
    const find = () =>
      [...this.host.querySelectorAll<HTMLElement>('[data-uuid]')].find(
        (element) => element.dataset['uuid'] === id,
      );
    const drawn = find();
    if (drawn && !scroll) {
      drawn.focus();
      return;
    }
    this.viewport()?.scrollToIndex(index);
    // A lista virtual desenha os itens alguns quadros depois de medir o viewport.
    const tryFocus = (left: number) => {
      const button = find();
      if (button) {
        button.focus();
      } else if (left > 0) {
        this.timers.add(setTimeout(() => tryFocus(left - 1), 20));
      }
    };
    afterNextRender(() => tryFocus(10), { injector: this.injector });
  }

  /** A pílula: vai à ponta das novas (o topo, com a mais nova primeiro). */
  showNew(): void {
    this.newBelow.set(0);
    this.scrollToNewest();
  }

  /** A mais nova foi aberta: a pílula não tem mais o que mostrar. */
  clearNew(): void {
    this.newBelow.set(0);
  }

  /** Leva a lista até a mensagem (a aberta pelo "Follow new" ou pelo "View" do aviso). */
  scrollTo(requestId: string): void {
    const index = this.rowIndexOf(requestId);
    if (index >= 0) {
      afterNextRender(() => this.viewport()?.scrollToIndex(index), { injector: this.injector });
    }
  }

  /** Tira da lista na hora; apaga no servidor quando o aviso some sem "Undo". */
  protected deleteRequest(request: WebhookRequest): void {
    const notice = this.snackBar.open($localize`Request deleted`, $localize`Undo`, {
      duration: UNDO_MS,
    });
    const undo = firstValueFrom(notice.afterDismissed()).then(
      ({ dismissedByAction }) => dismissedByAction,
    );
    void this.store.deleteRequest(request, undo);
  }

  protected trackRow(_index: number, row: ListRow<ItemView>): string {
    return row.id;
  }

  /**
   * Antes da nova, o fim da lista estava à vista: a penúltima (a última de antes) cabia na área
   * visível. Sem viewport medido ainda (lista que acabou de aparecer), conta como à vista.
   */
  private wasAtEnd(): boolean {
    const viewport = this.viewport();
    const size = viewport?.getViewportSize() ?? 0;
    if (!viewport || size === 0) {
      return true;
    }
    const visibleEnd = viewport.measureScrollOffset('top') + size;
    const height = this.itemHeight();
    const previousEnd = (this.rows().length - 1) * height;
    return previousEnd <= visibleEnd + height / 2;
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  private scrollToNewest(): void {
    const viewport = this.viewport();
    viewport?.scrollToIndex(this.store.newestFirst() ? 0 : this.rows().length - 1);
  }

  /** O topo estava à vista (com a mais nova primeiro, é onde as novas entram). */
  private wasAtTop(): boolean {
    const viewport = this.viewport();
    if (!viewport || viewport.getViewportSize() === 0) {
      return true;
    }
    return viewport.measureScrollOffset('top') <= this.itemHeight() / 2;
  }

  private itemOf(request: WebhookRequest, now: number): ItemView {
    const pipeline = pipelineOf(request);
    // O status respondido aparece sempre; os outros, só quando dizem algo.
    const seals = [
      pipeline.rule,
      ...[pipeline.signature, pipeline.schema].filter((check) => check.tone !== 'none'),
    ];
    const label = [
      `${request.method} ${pipeline.route}`,
      `#${request.uuid.substring(0, 5)}`,
      $localize`from ${request.ip}:ip:`,
      localDate(request.created_at),
      ...[pipeline.signature, pipeline.schema]
        .filter((check) => check.tone !== 'none')
        .map(spokenOf),
      spokenOf(pipeline.rule),
      ...(this.isUnread(request) ? [$localize`unread`] : []),
      ...this.compareRole(request),
    ].join(', ');
    const cut = routeCut(pipeline.route);
    return {
      request,
      route: pipeline.route,
      head: pipeline.route.slice(0, cut),
      tail: pipeline.route.slice(cut),
      ago: fromNow(request.created_at, now),
      summary: eventType(request) ?? '',
      seals,
      label,
      status: request.response?.status === undefined ? null : String(request.response.status),
    };
  }

  protected readonly localDate = localDate;

  /** No Compare, o item diz que é a A ou a B. */
  private compareRole(request: WebhookRequest): string[] {
    const pair = this.compare.pair();
    if (pair?.a.uuid === request.uuid) {
      return [$localize`compared as A`];
    }
    return pair?.b.uuid === request.uuid ? [$localize`compared as B`] : [];
  }
}
