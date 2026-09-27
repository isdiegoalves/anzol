import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import {
  Component,
  DestroyRef,
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
import { CheckResult, pipelineOf } from '../pipeline/pipeline';
import { localDate } from '../request-detail/dates';
import { RequestSearch } from '../search/request-search';
import { ShellSettings } from '../shell/shell-settings';
import { TokenStore } from '../token/token-store';
import { CheckChip } from '../ui/check-chip';
import { EmptyState } from '../ui/empty-state';
import { Icon } from '../ui/icon';
import { MethodBadge } from '../ui/method-badge';
import { SkeletonList } from '../ui/skeleton-list';
import { RequestStore } from './request-store';
import { WebhookRequest } from './webhook-request';

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
    CdkVirtualScrollViewport,
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    CheckChip,
    EmptyState,
    Icon,
    MatButton,
    MatProgressSpinner,
    MethodBadge,
    RequestSearch,
    SkeletonList,
  ],
  templateUrl: './request-list.html',
  styleUrl: './request-list.scss',
  host: { '[class.compact]': "settings.density() === 'compact'" },
})
export class RequestList {
  protected readonly store = inject(RequestStore);
  protected readonly compare = inject(CompareStore);
  private readonly tokens = inject(TokenStore);
  protected readonly settings = inject(ShellSettings);
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(Injector);
  private readonly viewport = viewChild(CdkVirtualScrollViewport);

  readonly openRequest = output<WebhookRequest>();
  protected readonly itemHeight = computed(() =>
    this.settings.density() === 'compact' ? ITEM_HEIGHT_COMPACT : ITEM_HEIGHT,
  );
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
    return limit === null ? `${this.store.total()}` : `${this.store.total()} / ${limit}`;
  });
  /** Consulta por linha desenhada: com milhares de não lidas, `includes` na lista pesaria. */
  private readonly unreadIds = computed(() => new Set(this.store.unread()));

  protected readonly items = computed<ItemView[]>(() =>
    this.store.requests().map((request) => this.itemOf(request)),
  );

  /** Mensagens novas que chegaram abaixo da vista (a pílula "N new requests"). */
  readonly newBelow = signal(0);
  /** As que acabaram de chegar, destacadas por alguns segundos. */
  protected readonly fresh = signal<ReadonlySet<string>>(new Set());

  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
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
   * Uma mensagem chegou (já está no fim da lista): fica destacada; se o fim da lista estava à
   * vista, a lista acompanha. Se a tela não a abriu (`opened`), ela conta na pílula das novas.
   * Devolve se a nova ficou à vista na lista.
   */
  receive(request: WebhookRequest, opened = false): boolean {
    this.fresh.update((fresh) => new Set([...fresh, request.uuid]));
    this.later(
      () => this.fresh.update((fresh) => new Set([...fresh].filter((id) => id !== request.uuid))),
      FRESH_MS,
    );
    const inView = this.wasAtEnd();
    if (inView) {
      afterNextRender(() => this.scrollToEnd(), { injector: this.injector });
    }
    if (!opened) {
      this.newBelow.update((count) => count + 1);
    }
    return inView;
  }

  /** A pílula: vai ao fim da lista, onde estão as novas. */
  showNew(): void {
    this.newBelow.set(0);
    this.scrollToEnd();
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

  private scrollToEnd(): void {
    const viewport = this.viewport();
    viewport?.scrollToIndex(this.store.requests().length - 1);
  }

  private itemOf(request: WebhookRequest): ItemView {
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
    return { request, route: pipeline.route, seals, label };
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
