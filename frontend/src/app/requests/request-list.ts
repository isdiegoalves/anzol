import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
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
import { CheckChip } from '../ui/check-chip';
import { EmptyState } from '../ui/empty-state';
import { Icon } from '../ui/icon';
import { MethodBadge } from '../ui/method-badge';
import { SkeletonList } from '../ui/skeleton-list';
import { NewPill } from './new-pill';
import { NO_FILTER } from '../search/request-filter';
import { RequestStore } from './request-store';
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
 * O resumo do corpo na linha 2 do item (protótipo C, INBOX-11): o tipo do evento do JSON, senão o
 * user-agent.
 */
export function bodySummary(request: WebhookRequest): string {
  return eventType(request) ?? request.user_agent ?? '';
}

/** Altura fixa de um item (três linhas: rota, origem e data, selos), para a rolagem virtual. */
export const ITEM_HEIGHT = 84;
/** Na densidade compacta (S17, C §3.6), os selos sobem para a linha da origem. */
export const ITEM_HEIGHT_COMPACT = 60;
/** Quanto tempo a mensagem que acabou de chegar fica destacada. */
export const FRESH_MS = 3000;
/** Quanto tempo o "Undo" do apagar fica disponível antes de apagar no servidor. */
export const UNDO_MS = 4000;

/** O que a linha mostra de uma mensagem. */
interface ItemView {
  request: WebhookRequest;
  route: string;
  /** Tempo relativo ("a few seconds ago"), na linha 1. */
  ago: string;
  /** Resumo do corpo na linha 2 (INBOX-11). */
  summary: string;
  /** Selos que dizem algo (a verificação existia): assinatura, schema, regra. */
  seals: CheckResult[];
  label: string;
}

/**
 * Lista da Inbox: itens de três linhas (método, `#id` e rota; origem e data; selos de assinatura,
 * schema e regra), busca e filtros, rodapé "1–50 of N" com as páginas, não lidas, a lixeira com
 * "Undo" e a pílula das novas que chegaram fora da vista. No "Compare with…", clicar escolhe a B.
 */
@Component({
  selector: 'app-request-list',
  imports: [
    CompareBand,
    ListFooter,
    CdkVirtualScrollViewport,
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    CheckChip,
    EmptyState,
    Icon,
    MatButton,
    MatProgressSpinner,
    MethodBadge,
    NewPill,
    RequestSearch,
    SkeletonList,
  ],
  templateUrl: './request-list.html',
  styleUrl: './request-list.scss',
  host: { '[class.compact]': 'twoLineItems()' },
})
export class RequestList {
  protected readonly store = inject(RequestStore);
  protected readonly compare = inject(CompareStore);
  private readonly tokens = inject(TokenStore);
  protected readonly settings = inject(ShellSettings);
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly windowClass = inject(Viewport).windowClass;
  private readonly viewport = viewChild(CdkVirtualScrollViewport);

  readonly openRequest = output<WebhookRequest>();
  /**
   * Itens de duas linhas, com os selos na linha da origem: a densidade compacta (S17) e o celular
   * (INBOX-32), onde o dobro de mensagens cabe na tela.
   */
  protected readonly twoLineItems = computed(
    () => this.settings.density() === 'compact' || this.windowClass() === 'compact',
  );
  protected readonly itemHeight = computed(() =>
    this.twoLineItems() ? ITEM_HEIGHT_COMPACT : ITEM_HEIGHT,
  );
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
  protected readonly items = computed<ItemView[]>(() => {
    const now = this.now();
    return this.store.requests().map((request) => this.itemOf(request, now));
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
    void this.store.applyFilter(NO_FILTER);
  }

  protected changeOrder(): void {
    this.newBelow.set(0);
    void this.store.toggleSorting();
  }

  protected isUnread(request: WebhookRequest): boolean {
    return this.unreadIds().has(request.uuid);
  }

  protected choose(request: WebhookRequest): void {
    if (this.compare.picking()) {
      this.compare.choose(request);
    } else {
      this.openRequest.emit(request);
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

  /** Põe o foco no item aberto (a volta do detalhe em tela cheia), rolando até ele. */
  focusSelected(): void {
    const index = this.store.selectedIndex();
    if (index < 0) {
      return;
    }
    this.viewport()?.scrollToIndex(index);
    // A lista virtual desenha os itens alguns quadros depois de medir o viewport.
    const tryFocus = (left: number) => {
      const button = this.host.querySelector<HTMLElement>('.item .select[aria-current="true"]');
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
    const index = this.store.requests().findIndex((request) => request.uuid === requestId);
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

  protected trackByUuid(_index: number, item: ItemView): string {
    return item.request.uuid;
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
    const previousEnd = (this.store.requests().length - 1) * height;
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
    viewport?.scrollToIndex(this.store.newestFirst() ? 0 : this.store.requests().length - 1);
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
    const seals = [pipeline.signature, pipeline.schema, pipeline.rule].filter(
      (check) => check.tone !== 'none',
    );
    const label = [
      `${request.method} ${pipeline.route}`,
      `#${request.uuid.substring(0, 5)}`,
      $localize`from ${request.ip}:ip:`,
      localDate(request.created_at),
      ...seals.map((seal) => `${seal.title}: ${seal.detail}`),
      ...(this.isUnread(request) ? [$localize`unread`] : []),
      ...this.compareRole(request),
    ].join(', ');
    return {
      request,
      route: pipeline.route,
      ago: fromNow(request.created_at, now),
      summary: bodySummary(request),
      seals,
      label,
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
