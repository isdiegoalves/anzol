import { LiveAnnouncer } from '@angular/cdk/a11y';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PRIMARY_OUTLET, Router, RouterLink } from '@angular/router';
import { EMPTY, Subject, debounceTime, switchMap } from 'rxjs';
import { Circuit } from '../circuit/circuit';
import { CompareStore } from '../diff/compare-store';
import type { Guide, GuideName } from '../guides/guide';
import { routeOf } from '../pipeline/pipeline';
import { RequestStream } from '../realtime/request-stream';
import { ActionPanel } from '../request-detail/action-panel';
import { ActionPanelStore, ActionTab } from '../request-detail/action-panel-store';
import { RequestDetail } from '../request-detail/request-detail';
import { parseUtc } from '../request-detail/dates';
import { RequestUnopened } from '../request-detail/request-unopened';
import { PendingDelete } from '../requests/pending-delete';
import { RequestList } from '../requests/request-list';
import { EventGrouping } from '../requests/event-grouping';
import { chronological, eventValueOf, isEventKey } from '../requests/event-key';
import { RequestStore } from '../requests/request-store';
import { RequestCreated, WebhookRequest } from '../requests/webhook-request';
import { FilterChips } from '../search/filter-chips';
import {
  NO_FILTER,
  RequestFilter,
  ValueFilter,
  filterFromParams,
  filterToParams,
  isFilterActive,
  sameFilter,
} from '../search/request-filter';
import { WaitFor, WaitForButton } from '../search/wait-for';
import { Onboarding } from '../onboarding/onboarding';
import { Preferences } from '../settings/preferences';
import { Redirector } from '../settings/redirect';
import { isTyping } from '../shell/hotkeys';
import { ScreenState } from '../shell/screen-state';
import { ShellSettings } from '../shell/shell-settings';
import { Viewport } from '../shell/viewport';
import { TokenStore } from '../token/token-store';
import { isProtectedError } from '../token/url-lock';
import { Icon } from '../ui/icon';
import { ANNOUNCEMENT_MS, LiveRegion } from '../ui/live-region';
import { NOTICE_MS } from '../ui/notice';
import { Split } from '../ui/split';

const GUIDES_KEY = (tokenId: string) => `anzol.guides.${tokenId}`;
/** Marca, no estado da entrada do histórico, a que a tela criou ao escolher a requisição sozinha. */
const SCREEN_CHOICE = 'screenChoice';

/** Os filtros por valor ficam na aba: o dado da requisição não vai para o endereço. */
const VALUE_FILTERS_KEY = (tokenId: string) => `anzol.valueFilters.${tokenId}`;

function readValueFilters(tokenId: string): ValueFilter[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(VALUE_FILTERS_KEY(tokenId)) ?? '[]') as unknown;
    return Array.isArray(saved) ? (saved as ValueFilter[]) : [];
  } catch {
    return [];
  }
}

function writeValueFilters(tokenId: string | null, values: readonly ValueFilter[]): void {
  if (!tokenId) {
    return;
  }
  try {
    if (values.length > 0) {
      sessionStorage.setItem(VALUE_FILTERS_KEY(tokenId), JSON.stringify(values));
    } else {
      sessionStorage.removeItem(VALUE_FILTERS_KEY(tokenId));
    }
  } catch {
    // Sem sessionStorage, o filtro por valor vale até recarregar.
  }
}

export const LOADING_NOTICE_MS = 1000;

/** Com filtro ativo, espera a rajada de mensagens novas acabar antes de refazer a busca. */
export const SEARCH_REFRESH_DEBOUNCE_MS = 300;
/** Quanto tempo a tela espera o eco de uma navegação que ela mesma fez. */
export const ECHO_MS = 5000;
/**
 * Para o leitor de tela, a primeira chegada de uma leva fala na hora, e as seguintes falam somadas no máximo a esta
 * distância (WCAG 4.1.3, sem inundar).
 */
export const ANNOUNCE_EVERY_MS = 10_000;
/** O aviso "Request received" (M3: 4 s), só quando a nova não está à vista. */
export const RECEIVED_NOTICE_MS = 4000;
/** Limites da lista ao lado do detalhe, em px, e a chave da largura que a pessoa deixou. */
export const LIST_MIN = 300;
export const LIST_MAX = 720;
export const LIST_WIDTH_KEY = 'inboxListWidth';

/** A largura inicial da lista: 28 % da janela, entre os limites, até a pessoa mexer na divisória. */
export function defaultListWidth(windowWidth: number): number {
  return Math.round(Math.min(LIST_MAX, Math.max(LIST_MIN, windowWidth * 0.28)));
}

/**
 * Inbox: lista e detalhe lado a lado com a divisória redimensionável (a partir de 840 px); abaixo,
 * um painel por vez, com o detalhe em tela cheia. A rota (`/`, `/{tokenId}`,
 * `/{tokenId}/{requestId}/{page}`) é a fonte da verdade: clicar numa mensagem navega, e a navegação
 * abre a mensagem. Tempo real: a nova fica destacada; fora da vista, a pílula e o aviso; "Follow
 * new" abre cada uma que chega; o leitor de tela ouve a primeira na hora e as seguintes somadas.
 */
@Component({
  selector: 'app-inbox',
  imports: [
    ActionPanel,
    Circuit,
    Icon,
    MatButton,
    MatIconButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatSlideToggle,
    NgTemplateOutlet,
    Onboarding,
    RequestDetail,
    RouterLink,
    LiveRegion,
    RequestList,
    RequestUnopened,
    Split,
    WaitForButton,
  ],
  templateUrl: './inbox.html',
  styleUrl: './inbox.scss',
  host: { '(window:resize)': 'fitList()' },
})
export class Inbox {
  protected readonly tokens = inject(TokenStore);
  protected readonly requests = inject(RequestStore);
  protected readonly preferences = inject(Preferences);
  protected readonly compare = inject(CompareStore);
  private readonly stream = inject(RequestStream);
  private readonly redirector = inject(Redirector);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly settings = inject(ShellSettings);
  private readonly viewport = inject(Viewport);
  private readonly screen = inject(ScreenState);
  protected readonly grouping = inject(EventGrouping);
  protected readonly panel = inject(ActionPanelStore);
  protected readonly waitFor = inject(WaitFor);
  protected readonly deleting = inject(PendingDelete);
  private readonly chips = inject(FilterChips);
  protected readonly firstArrival = signal<{ method: string; path: string; time: string } | null>(
    null,
  );
  protected readonly missingValues = computed(() => {
    const missing = this.chips.missingValues();
    if (missing === 0) {
      return '';
    }
    return missing === 1
      ? $localize`This link does not carry 1 filter by value.`
      : $localize`This link does not carry ${missing}:count: filters by value.`;
  });

  /** Parâmetros da rota (`withComponentInputBinding`). */
  readonly tokenId = input<string>();
  readonly requestId = input<string>();
  readonly page = input<string>();
  /** A página do link; a 0 (`/…/0`) vira a 1. */
  private readonly pageNumber = computed(() => Math.max(1, Number(this.page() ?? 1)));
  /** O `created_at` que o link permanente leva, para dizer de quando era a que sumiu. */
  readonly at = input<string>();
  /** Filtros da query da rota (`?signature=invalid&schema=valid&methods=POST,GET&q=texto`). */
  readonly signature = input<string>();
  readonly schema = input<string>();
  readonly decryption = input<string>();
  readonly methods = input<string>();
  readonly q = input<string>();
  /** Desfecho (C2): `?outcome=rule|near_miss|default&rule={id}&ruleName={nome}`. */
  readonly outcome = input<string>();
  readonly rule = input<string>();
  readonly ruleName = input<string>();
  /** M1: o motivo exato de assinatura e o caminho do erro de schema (`?signatureReason=&schemaPath=`). */
  readonly signatureReason = input<string>();
  readonly schemaPath = input<string>();
  /** O motivo da decifra inválida (`?decryptionReason=`), o link dos motivos de Métricas. */
  readonly decryptionReason = input<string>();
  readonly answered = input<string>();
  /** Quantos filtros por valor a tela tinha; os valores ficam no `sessionStorage` da aba. */
  readonly values = input<string>();
  readonly window = input<string>();
  /** O valor do evento e o nome da chave; num navegador sem a chave, a oferta a propõe. */
  readonly event = input<string>();
  readonly key = input<string>();
  readonly guide = input<string>();
  protected readonly guideName = computed((): GuideName | null => {
    const guide = this.guide();
    return guide === 'first' || guide === 'retry' ? guide : null;
  });
  /** Onde o roteiro entra, criado à mão: a folha vem num pedaço à parte, por `import()`. */
  private readonly guideHost = viewChild('guideHost', { read: ViewContainerRef });
  private readonly routeFilter = computed(() =>
    filterFromParams({
      signature: this.signature(),
      schema: this.schema(),
      decryption: this.decryption(),
      methods: this.methods(),
      q: this.q(),
      outcome: this.outcome(),
      rule: this.rule(),
      ruleName: this.ruleName(),
      signatureReason: this.signatureReason(),
      decryptionReason: this.decryptionReason(),
      schemaPath: this.schemaPath(),
      answered: this.answered(),
      window: this.window(),
    }),
  );
  private readonly routeFilterWithValues = computed((): RequestFilter => {
    const filter = this.routeFilter();
    const count = Number(this.values() ?? 0);
    const tokenId = this.tokenId();
    const values = count > 0 && tokenId ? readValueFilters(tokenId).slice(0, count) : [];
    return values.length > 0 ? { ...filter, values } : filter;
  });

  private readonly list = viewChild(RequestList);
  private readonly detail = viewChild(RequestDetail);
  private readonly requestNotice = viewChild<ElementRef<HTMLElement>>('requestNotice');

  /** Lista e detalhe lado a lado (classes expandida em diante); abaixo, um painel por vez. */
  protected readonly twoPanes = computed(() =>
    ['expanded', 'large', 'extra-large'].includes(this.viewport.windowClass()),
  );
  protected readonly compact = computed(() => this.viewport.windowClass() === 'compact');
  /** A requisição aberta não está no resultado do filtro de agora (UX-05). */
  protected readonly outsideFilter = computed(
    () =>
      this.requests.filtering() &&
      !this.requests.searching() &&
      !this.requests.loading() &&
      !!this.requests.selected() &&
      this.requests.selectedIndex() < 0,
  );
  protected readonly notice = computed(() => {
    const gone = this.requests.gone();
    const deleting = this.deleting.pending();
    const loading = this.loadingRequest();
    if (deleting && deleting.request.uuid !== gone?.id) {
      return $localize`You deleted ${deleting.request.method}:method: ${deleting.route}:route:. Undo is in the request notice.`;
    }
    if (!gone) {
      return loading ? $localize`Loading request #${loading.slice(0, 5)}:id:…` : '';
    }
    const time = gone.at.toLocaleTimeString(this.document.documentElement.lang || 'en', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const copy = $localize`You are seeing the copy this page had loaded.`;
    const leaves = $localize`This copy goes away when you leave it.`;
    const keeps = this.tokens.shown()?.auto_cleanup;
    const causes: Record<typeof gone.cause, string> = {
      cleanup: keeps
        ? $localize`This request was deleted from the server by auto cleanup (keeps the newest ${keeps}:limit:), noticed at ${time}:time:. ${copy}:copy:`
        : $localize`This request was deleted from the server by auto cleanup, noticed at ${time}:time:. ${copy}:copy:`,
      deleted: $localize`You deleted this request at ${time}:time:. ${copy}:copy:`,
      unknown: $localize`This request is no longer on the server, noticed at ${time}:time:. It may have been deleted or cut by auto cleanup.`,
    };
    return `${causes[gone.cause]} ${leaves}`;
  });
  /** Com a apagada aberta, a frase do "Undo" vai no fim do aviso da cópia, enquanto ele vale. */
  protected readonly undoHint = computed(() => {
    const deleting = this.deleting.pending();
    return deleting && deleting.request.uuid === this.requests.gone()?.id
      ? $localize`Undo is in the request notice.`
      : '';
  });
  private readonly loadingRequest = signal<string | null>(null);
  /** Um painel por vez: o detalhe em tela cheia depois de escolher na lista. */
  protected readonly showDetail = signal(false);
  protected readonly listMin = LIST_MIN;
  protected readonly listMax = LIST_MAX;
  protected readonly listWidthKey = LIST_WIDTH_KEY;
  protected readonly listWidth = signal(
    defaultListWidth(this.document.defaultView?.innerWidth ?? 0),
  );
  private readonly streamTokenId = signal<string | null>(null);
  private loading: { tokenId: string; done: Promise<boolean> } | null = null;
  private readonly searchRefresh = new Subject<void>();
  /** As chegadas depois da que abriu a janela do anúncio, e a última delas. */
  private arrivals = 0;
  private lastArrival: WebhookRequest | null = null;
  /** Com filtro, a chegada espera a busca dizer se ela aparece na lista para ser dita. */
  private readonly unseenArrivals = new Map<string, WebhookRequest>();
  /** A mensagem que a própria tela abriu por último (sem o usuário pedir). */
  private chosenByScreen: string | null = null;
  private left = false;
  /** A que a tela abriu sem ninguém a ver: segue nas não lidas (INBOX-02). */
  private keepUnread: string | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  /** O roteiro aberto no lugar do detalhe; a conferência do retry anuncia as chegadas dela. */
  private shownGuide: Guide | null = null;
  /** Os filtros que a tela mandou para a rota e cujo eco ainda não voltou. */
  private readonly pushed: { filter: RequestFilter; at: number }[] = [];

  constructor() {
    effect((onCleanup) => {
      const [host, name, tokenId] = [this.guideHost(), this.guideName(), this.tokens.shown()?.uuid];
      if (host && name && tokenId) {
        onCleanup(untracked(() => this.showGuide(host, name, tokenId)));
      }
    });
    // O detalhe em tela cheia (um painel por vez) tira o cartão da URL e a barra do topo (INBOX-30).
    effect(() =>
      this.screen.detailFullscreen.set(
        !this.twoPanes() && this.showDetail() && !!this.requests.selected(),
      ),
    );

    effect(() => {
      const tokenId = this.tokenId();
      const requestId = this.requestId();
      const page = this.pageNumber();
      untracked(() => void this.openRoute(tokenId, requestId, page, false, this.cameBack()));
    });
    effect(() => {
      const key = this.key();
      untracked(() => this.grouping.linkKey.set(key && isEventKey(key) ? key : null));
    });

    // Filtros na rota: a query muda (um link, o "Show in Inbox" do Health) → a lista filtra; a busca
    // muda na tela → a query acompanha (replaceUrl), para o link ser compartilhável.
    // O eco da própria navegação pode chegar atrasado, com a tela já em outro filtro (a pessoa
    // seguiu digitando): ele não desfaz o filtro da tela; a rota é que volta a acompanhá-la.
    effect(() => {
      const filter = this.routeFilterWithValues();
      untracked(() => {
        if (!this.listReady()) {
          return;
        }
        if (!this.takeEcho(filter)) {
          void this.requests.applyFilter(filter);
          return;
        }
        this.pushToRoute(this.requests.filter());
      });
    });
    effect(() => {
      const filter = this.requests.filter();
      untracked(() => {
        if (this.listReady()) {
          // Antes da rota: o eco dela procura os valores na aba.
          writeValueFilters(this.requests.tokenId(), filter.values ?? []);
          this.pushToRoute(filter);
        }
      });
    });
    effect(() => {
      const count = Number(this.values() ?? 0);
      const tokenId = this.tokenId();
      untracked(() => {
        const kept = count > 0 && tokenId ? readValueFilters(tokenId).length : 0;
        this.chips.missingValues.set(Math.max(0, count - kept));
      });
    });

    effect(() => {
      // Outra URL: a faixa da primeira chegada e as chegadas à espera da busca são da anterior.
      this.tokenId();
      this.firstArrival.set(null);
      this.unseenArrivals.clear();
    });

    // Por um número de outro destino (Métricas, Saúde), o link saiu com a página e o foco caiu no body: ele vai à
    // linha de status do filtro, que diz o resultado quando a busca voltar.
    const byLink = this.router.navigated;
    afterNextRender(
      () => {
        if (
          byLink &&
          isFilterActive(this.routeFilter()) &&
          this.document.activeElement === this.document.body
        ) {
          this.document
            .querySelector<HTMLElement>('app-request-search app-live-region.count')
            ?.focus();
        }
      },
      { injector: this.injector },
    );

    toObservable(this.streamTokenId)
      .pipe(
        switchMap((tokenId) =>
          tokenId ? this.stream.connect(tokenId, { resume: () => this.resume() }) : EMPTY,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((event) => void this.receive(event));

    this.searchRefresh
      .pipe(
        debounceTime(SEARCH_REFRESH_DEBOUNCE_MS),
        switchMap(() => this.requests.refreshSearch()),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.announceFound());

    // J e K: a mensagem mais antiga e a mais nova (C §3.2), fora dos campos e se ligados.
    const keys = (event: KeyboardEvent) => this.navigateByKey(event);
    this.document.addEventListener('keydown', keys);
    effect(() => this.deleting.noticeShown.set(!!this.requestNotice()));
    inject(DestroyRef).onDestroy(() => {
      this.left = true;
      this.deleting.noticeShown.set(false);
      this.screen.detailFullscreen.set(false);
      this.screen.searchOpen.set(false);
      this.document.removeEventListener('keydown', keys);
      if (this.announceTimer) {
        clearTimeout(this.announceTimer);
      }
    });
  }

  /**
   * A rota que chegou é o eco de uma navegação da própria tela? Cada eco vale uma vez. O que foi
   * mandado há mais de `ECHO_MS` não volta mais (a navegação foi cancelada por outra).
   */
  private takeEcho(filter: RequestFilter): boolean {
    const since = Date.now() - ECHO_MS;
    const waiting = this.pushed.filter((pushed) => pushed.at >= since);
    const echo = waiting.findIndex((pushed) => sameFilter(pushed.filter, filter));
    if (echo >= 0) {
      waiting.splice(echo, 1);
    }
    this.pushed.splice(0, this.pushed.length, ...waiting);
    return echo >= 0;
  }

  /** A rota passa a dizer o filtro da tela (`replaceUrl`), para o link ser compartilhável. */
  private pushToRoute(filter: RequestFilter): void {
    if (sameFilter(filter, this.routeFilterWithValues())) {
      return;
    }
    this.pushed.push({ filter, at: Date.now() });
    void this.router.navigate([], {
      queryParams: filterToParams(filter),
      queryParamsHandling: 'merge',
      replaceUrl: true,
      // A entrada do histórico é a mesma: o que ela guarda (a escolha da tela) fica.
      state: this.router.lastSuccessfulNavigation()?.extras.state,
    });
  }

  /**
   * Abre a mensagem pela rota. Com `replaceUrl`, é a tela que escolheu (a primeira ao abrir a URL,
   * a que substituiu a cortada): no celular isso não tira a lista da frente, e ela segue não lida
   * (salvo `read`, quando o detalhe a mostra a quem esperava por ela). A entrada do histórico guarda
   * essa escolha, para o voltar do navegador devolver a lista.
   */
  protected openRequest(
    request: WebhookRequest,
    replaceUrl = false,
    read = !replaceUrl,
  ): Promise<boolean> {
    // A resposta de uma busca pode chegar depois de a pessoa ter ido a outro destino.
    if (this.left) {
      return Promise.resolve(false);
    }
    this.chosenByScreen = replaceUrl ? request.uuid : null;
    this.keepUnread = read ? null : request.uuid;
    const page = this.requests.pageOf(request.uuid);
    // O filtro da rota fica: abrir uma mensagem não desfaz a busca.
    return this.router.navigate(['/', request.token_id, request.uuid, page], {
      replaceUrl,
      queryParamsHandling: 'preserve',
      ...(replaceUrl && { state: { [SCREEN_CHOICE]: true } }),
    });
  }

  /** O voltar ou o avançar do navegador chegou à entrada do histórico que a tela criou por escolha própria. */
  private cameBack(): boolean {
    const navigation = this.router.getCurrentNavigation() ?? this.router.lastSuccessfulNavigation();
    return (
      navigation?.trigger !== 'imperative' && navigation?.extras.state?.[SCREEN_CHOICE] === true
    );
  }

  /** Monta o roteiro pedido no endereço; o pedaço dele só é baixado aqui. */
  /** A lista acompanha a janela enquanto a pessoa não escolheu uma largura na divisória. */
  protected fitList(): void {
    if (localStorage.getItem(LIST_WIDTH_KEY) === null) {
      this.listWidth.set(defaultListWidth(this.document.defaultView?.innerWidth ?? 0));
    }
  }

  private showGuide(host: ViewContainerRef, name: GuideName, tokenId: string): () => void {
    let gone = false;
    void import('../guides/guide').then(({ Guide }) => {
      if (gone) {
        return;
      }
      const guide = host.createComponent(Guide);
      guide.setInput('name', name);
      guide.setInput('tokenId', tokenId);
      guide.instance.closed.subscribe(() => void this.closeGuide());
      guide.instance.openRequest.subscribe((request) => void this.openFromGuide(request));
      this.shownGuide = guide.instance;
    });
    return () => {
      gone = true;
      this.shownGuide = null;
      host.clear();
    };
  }

  /** "Close guide": o endereço perde o `?guide=` e o detalhe volta. */
  protected closeGuide(): Promise<boolean> {
    return this.router.navigate([], {
      queryParams: { guide: null },
      queryParamsHandling: 'merge',
    });
  }

  /** "Open it" do roteiro: abre a requisição e fecha o roteiro. */
  protected openFromGuide(request: WebhookRequest): Promise<boolean> {
    this.showDetail.set(true);
    return this.router.navigate(
      ['/', request.token_id, request.uuid, this.requests.pageOf(request.uuid)],
      { queryParams: { guide: null }, queryParamsHandling: 'merge' },
    );
  }

  /** Clicar na lista fecha a comparação aberta e abre a mensagem (em tela cheia, no celular). */
  protected openFromList(request: WebhookRequest): void {
    this.compare.close();
    this.showDetail.set(true);
    if (this.requests.selected()?.uuid === request.uuid) {
      // A que a tela abriu sozinha: a rota não muda, mas agora alguém a leu.
      this.keepUnread = null;
      this.requests.select(request.uuid);
      return;
    }
    void this.openRequest(request);
  }

  /** Aberta pelo teclado (Enter no item): o foco vai ao título do detalhe. */
  protected focusDetail(): void {
    const focus = (left: number) => {
      const title = this.document.querySelector<HTMLElement>('.detail-pane h2.route');
      if (title) {
        title.focus();
      } else if (left > 0) {
        setTimeout(() => focus(left - 1), 20);
      }
    };
    afterNextRender(() => focus(10), { injector: this.injector });
  }

  /** O "Undo" do aviso sai da tela com ele: o foco vai à linha que voltou, ou ao detalhe sem a lista. */
  protected undoDelete(): void {
    const uuid = this.deleting.pending()?.request.uuid;
    this.deleting.undo();
    afterNextRender(
      () => {
        const list = this.list();
        if (uuid && list) {
          list.focusRequest(uuid);
        } else {
          this.focusDetail();
        }
      },
      { injector: this.injector },
    );
  }

  /** Volta à lista com o foco no item de onde se saiu (sem ele, o foco cairia no body). */
  protected backToList(): void {
    this.showDetail.set(false);
    afterNextRender(() => this.list()?.focusSelected(), { injector: this.injector });
  }

  /** Confirma antes: a confirmação (e o `MatDialog`) vêm sob demanda. */
  protected async deleteAllRequests(): Promise<void> {
    const { confirmDeleteAll } = await import('./confirm-delete-all');
    if (!(await confirmDeleteAll(this.injector, this.requests.total()))) {
      return;
    }
    try {
      await this.requests.deleteAll();
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.snackBar.open(
        $localize`Could not delete (${status}:status:). The requests are still here.`,
        undefined,
        { duration: NOTICE_MS },
      );
    }
  }

  private navigateByKey(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      const target = event.target as HTMLElement | null;
      const popupOpen = target?.getAttribute('aria-expanded') === 'true';
      if (this.panel.open() && !event.defaultPrevented && !popupOpen && this.detail()) {
        event.preventDefault();
        this.panel.close();
        return;
      }
      this.escapeToList(event);
      return;
    }
    if (
      !['j', 'k', 'd', 'r', 'e', 'p'].includes(key) ||
      event.defaultPrevented ||
      !this.settings.shortcuts() ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      isTyping(event)
    ) {
      return;
    }
    const detail = this.detail();
    if (detail) {
      event.preventDefault();
      const tabs: Record<string, ActionTab | 'toggle'> = {
        r: 'replay',
        d: 'compare',
        e: 'explain',
        p: 'toggle',
      };
      if (key === 'j') {
        detail.showOlder();
      } else if (key === 'k') {
        detail.showNewer();
      } else {
        detail.openByKey(tabs[key]);
      }
    }
  }

  /** Esc no detalhe (sem nada por cima que o trate antes): o foco volta ao item da lista. */
  private escapeToList(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    // O Esc de um menu que abriu sobre o botão é do menu: o foco volta ao botão.
    const popupOpen = target?.getAttribute('aria-expanded') === 'true';
    if (
      !event.defaultPrevented &&
      !popupOpen &&
      target?.closest('.detail-pane') &&
      this.twoPanes()
    ) {
      this.list()?.focusSelected();
    }
  }

  private async openRoute(
    tokenId: string | undefined,
    requestId: string | undefined,
    page: number,
    again = false,
    cameBack = false,
  ) {
    if (!tokenId) {
      await this.openSavedOrNewToken();
      return;
    }
    if (cameBack && requestId && !this.twoPanes()) {
      // Voltar pelo histórico à entrada que a tela criou devolve, no celular, o que ela mostrava: a lista, com a
      // requisição que a tela escolheu ainda não lida.
      this.chosenByScreen = requestId;
      this.keepUnread = requestId;
      if (this.showDetail()) {
        this.backToList();
      }
    } else if (requestId !== this.chosenByScreen) {
      // A escolha da tela vale enquanto a rota fica nela: quem chega a essa requisição depois por uma navegação nova
      // (um toque, um link) pediu para vê-la, e ela vem para a frente e conta como lida.
      this.chosenByScreen = null;
      this.keepUnread = null;
    }
    // Voltando à Inbox sem mensagem na rota (o rail, a marca): a que estava aberta nesta URL.
    const previous =
      requestId === undefined && this.requests.tokenId() === tokenId
        ? this.requests.selected()
        : undefined;
    // Sem stream (Inbox recriado ao voltar de outro destino), a lista também está velha; com outra URL abrindo, a
    // desta, que a loja ainda guarda, já saiu da tela.
    const stale =
      again ||
      (this.requests.opening() ?? this.requests.tokenId()) !== tokenId ||
      this.streamTokenId() !== tokenId;
    if (stale && !(await this.loadToken(tokenId, page, again))) {
      return;
    }
    // A rota mudou durante a carga: quem decide é a chamada da rota nova.
    const routed = () => this.routedTo(tokenId) && this.requestId() === requestId;
    if (!routed()) {
      return;
    }
    const list = this.requests.requests();
    if (requestId && list.some((request) => request.uuid === requestId)) {
      this.requests.select(requestId, requestId !== this.keepUnread);
      // J, K, Newer e Older: a parada do Tab da lista (e o foco, se estava nela) acompanha.
      this.list()?.follow(requestId, requestId !== this.chosenByScreen);
      // Link permanente, Newer/Older, Follow new: no celular, o detalhe vem para a frente.
      if (requestId !== this.chosenByScreen) {
        this.showDetail.set(true);
      }
      if (requestId === this.requests.newest()?.uuid) {
        this.list()?.clearNew();
      }
    } else if (previous) {
      // A limpeza reduzida em Checks corta sem evento: se ela saiu, a mais antiga que ficou.
      const again =
        list.find((request) => request.uuid === previous.uuid) ??
        (await this.fetchKept(tokenId, previous.uuid)) ??
        (await this.requests.oldestKept());
      if (again && routed()) {
        await this.openRequest(again, true);
      }
    } else if (requestId !== undefined) {
      // Se a do link não abre, nenhuma outra entra no lugar.
      await this.openOutsideList(tokenId, requestId);
    } else if (list.length > 0) {
      await this.openRequest(list[0], true);
    }
  }

  /** A mensagem pela API; `undefined` se ela sumiu (404: cortada ou apagada). */
  private async fetchKept(tokenId: string, requestId: string): Promise<WebhookRequest | undefined> {
    try {
      return await this.requests.fetchOne(tokenId, requestId);
    } catch {
      return undefined;
    }
  }

  /**
   * Link permanente para uma mensagem fora da página carregada (com a mais nova no topo, as novas
   * empurram as outras de página): busca pela API. Se ela não existe (404) ou o servidor não
   * responde, o detalhe diz isso e **nenhuma outra é aberta no lugar**. Se a rota mudou enquanto
   * isso, a nova rota decide.
   */
  private async openOutsideList(tokenId: string, requestId: string): Promise<void> {
    let request: WebhookRequest;
    const slow = setTimeout(() => this.loadingRequest.set(requestId), LOADING_NOTICE_MS);
    try {
      request = await this.requests.fetchOne(tokenId, requestId);
    } catch (error) {
      if (this.requestId() === requestId && !isProtectedError(error)) {
        const missing = error instanceof HttpErrorResponse && error.status === 404;
        this.requests.leaveUnopened(requestId, missing ? 'missing' : 'failed');
        this.showDetail.set(true);
      }
      return;
    } finally {
      clearTimeout(slow);
      this.loadingRequest.set(null);
    }
    if (this.requestId() === requestId) {
      this.requests.selectOutsideList(request);
      // A que a tela reabriu fora do filtro novo não vem para a frente; o link, sim.
      if (requestId !== this.chosenByScreen) {
        this.showDetail.set(true);
      }
    }
  }

  protected async retryUnopened(): Promise<void> {
    const tokenId = this.tokenId();
    const unopened = this.requests.unopened();
    if (tokenId && unopened) {
      await this.openOutsideList(tokenId, unopened.id);
    }
  }

  /**
   * "Open the event": o link de uma requisição que não existe mais trouxe o evento; abre a
   * tentativa mais nova dele que está carregada, com o evento expandido.
   */
  protected openEvent(value: string): void {
    const key = this.grouping.key() ?? this.grouping.linkKey();
    const attempts = key
      ? this.requests
          .requests()
          .filter((request) => eventValueOf(request, key) === value)
          .sort(chronological)
      : [];
    const newest = attempts[attempts.length - 1];
    if (!newest) {
      void this.searchFor(value);
      return;
    }
    this.grouping.expand(value, true);
    this.openFromList(newest);
  }

  /** "Open the newest request": só quando a pessoa pede. */
  protected openNewest(): void {
    const newest = this.requests.newest();
    if (newest) {
      this.openFromList(newest);
    }
  }

  /**
   * "Search for this id": o identificador vai para a busca da lista, e o endereço deixa o link que
   * não abriu (sem requisição nenhuma aberta; a busca, sem resultado, não abre a primeira). Quem
   * saiu do link enquanto a busca demorava fica onde foi.
   */
  protected async searchFor(requestId: string): Promise<void> {
    const link = this.routePath();
    this.showDetail.set(false);
    await this.requests.applyFilter({ ...NO_FILTER, text: requestId });
    if (this.left || this.routePath() !== link) {
      return;
    }
    this.requests.unopened.set(null);
    await this.router.navigate(['/', this.tokenId()], {
      queryParams: filterToParams(this.requests.filter()),
    });
  }

  /**
   * O caminho da rota, sem a query; com uma navegação em curso (a página de destino ainda
   * carregando), o do destino dela.
   */
  private routePath(): string {
    const url =
      this.router.currentNavigation()?.extractedUrl ?? this.router.parseUrl(this.router.url);
    return (url.root.children[PRIMARY_OUTLET]?.segments ?? []).map((part) => part.path).join('/');
  }

  /** A lista da URL da rota já está carregada (os filtros da rota e da tela podem conversar). */
  private listReady(): boolean {
    const tokenId = this.tokenId();
    return !!tokenId && this.loading === null && this.requests.tokenId() === tokenId;
  }

  /** "Try again" da lista que falhou ou demora: abre a URL da rota de novo. */
  protected reopen(): void {
    void this.openRoute(this.tokenId(), this.requestId(), this.pageNumber(), true);
  }

  /** Várias navegações seguidas para o mesmo token esperam a mesma carga. */
  private loadToken(tokenId: string, page: number, again = false): Promise<boolean> {
    if (again || this.loading?.tokenId !== tokenId) {
      const done: Promise<boolean> = this.fetchToken(tokenId, page).finally(() => {
        if (this.loading?.done === done) {
          this.loading = null;
        }
      });
      this.loading = { tokenId, done };
    }
    return this.loading.done;
  }

  private async fetchToken(tokenId: string, page: number): Promise<boolean> {
    // O "Choose another request" do Compare chega aqui com a A esperando a outra escolha.
    if (this.compare.picking()?.token_id !== tokenId) {
      this.compare.close();
    }
    const shown = this.requests.opening() ?? this.requests.tokenId();
    if (shown !== null && shown !== tokenId) {
      this.panel.dismiss();
    }
    this.requests.begin(tokenId);
    try {
      await this.tokens.load(tokenId);
    } catch {
      // URL protegida sem acesso: a tela de desbloqueio assume (`UrlLock`). URL que não existe: a
      // página única de URL inexistente (`UrlMissing`). Sem resposta: a página de erro da URL. Nenhuma
      // cria outra URL (B1).
      return false;
    }
    if (!this.routedTo(tokenId)) {
      return false;
    }
    // Antes da lista: o que chegar durante a carga, ou com ela em erro, não se perde.
    this.streamTokenId.set(tokenId);
    try {
      await this.requests.load(tokenId, page, untracked(this.routeFilterWithValues));
    } catch {
      // A lista em erro diz isso no lugar dela e tenta de novo sozinha.
      return false;
    }
    return this.routedTo(tokenId) && this.requests.tokenId() === tokenId;
  }

  /** A rota ainda é desta URL. A Entrada que saiu da tela guarda a última rota, e não escreve mais nada. */
  private routedTo(tokenId: string): boolean {
    return !this.left && this.tokenId() === tokenId;
  }

  private async openSavedOrNewToken(): Promise<void> {
    const saved = this.tokens.token();
    const token = saved ?? (await this.tokens.create());
    if (this.tokenId() === undefined) {
      await this.router.navigate(['/', token.uuid], { replaceUrl: true });
    }
  }

  /**
   * O que chegou enquanto o tempo real não entregava (`after=<seq>`): acumula na pílula, sem abrir
   * nem rolar. Calada: quem diz quantas chegaram é a volta da conexão, numa fala só. Devolve quantas.
   */
  private async resume(): Promise<number> {
    const tokenId = this.tokenId();
    // O tempo real abriu antes de a lista chegar: ela pode ter saído do servidor antes da assinatura.
    if (tokenId && this.loading?.tokenId === tokenId) {
      await this.loading.done;
    }
    if (!this.listReady()) {
      return 0;
    }
    const arrived = await this.requests.arrivedSinceNewest();
    if (!this.listReady() || !tokenId || !this.routedTo(tokenId)) {
      return 0;
    }
    if (!arrived) {
      // Mensagens antigas, sem `seq`: relê o que a lista mostra.
      if (this.requests.filtering()) {
        this.searchRefresh.next();
      } else {
        await this.requests.reload();
      }
      return 0;
    }
    const { data, total } = arrived;
    const fresh = data.filter((one) => !this.listed(one.uuid));
    if (this.requests.failure()?.kind === 'search') {
      // A busca que falhou durante a queda é refeita e já traz o que chegou; as chegadas vão para a pílula.
      await this.requests.retrySearch();
      fresh.forEach((request) => this.list()?.receive(request, false));
      return fresh.length;
    }
    let undecided = false;
    for (const request of fresh) {
      if (this.requests.filtering()) {
        undecided = !this.requests.arriveFiltered(request, total) || undecided;
      } else {
        this.requests.append(request, total);
      }
      this.list()?.receive(request, false);
    }
    if (undecided) {
      // Só a busca diz se elas casam: é relida em seguida.
      this.searchRefresh.next();
    }
    return fresh.length;
  }

  private listed(requestId: string): boolean {
    return this.requests.requests().some((request) => request.uuid === requestId);
  }

  private async receive({ request, total, truncated, removed }: RequestCreated): Promise<void> {
    // A lista desta URL a caminho pode já trazê-la: ela entra depois, sem repetir.
    if (this.loading?.tokenId === request.token_id) {
      await this.loading.done;
    }
    // O evento da URL anterior ainda chega até o stream da nova abrir.
    const current = () => this.listReady() && this.routedTo(request.token_id);
    // A reconexão pode repetir a que a volta da conexão já trouxe.
    if (!current() || this.listed(request.uuid)) {
      return;
    }
    // Corpo > 1 MB chega cortado no evento, e o atributo decifrado nunca vem nele: a mensagem
    // completa vem da API; sem ela, fica a do evento.
    const complete =
      truncated || request.decryption?.state === 'valid'
        ? await this.requests.fetchOne(request.token_id, request.uuid).catch(() => request)
        : request;
    if (!current()) {
      return;
    }
    if (this.requests.filtering()) {
      const decided = this.requests.arriveFiltered(complete, total, removed);
      this.notify(complete, false, 'later');
      if (decided) {
        this.announceFound();
      } else {
        // Se a nova casa com o filtro, só a busca diz: ela é relida em seguida.
        this.searchRefresh.next();
      }
      return;
    }
    const first =
      !this.requests.hasRequests() && !this.requests.failure() && !this.guideDismissed('first');
    // A limpeza automática pode ter cortado a mensagem aberta: ela segue na tela, como cópia, com o
    // aviso; nenhuma outra é aberta no lugar.
    this.requests.append(complete, total, removed);
    const list = this.requests.requests();
    if (first) {
      this.welcome(complete);
    }
    if (!this.requests.selected() && !this.requests.unopened()) {
      // A primeira de uma Inbox vazia é a tela que abre (como a primeira ao abrir a URL): no celular
      // a lista fica à frente, e quem mandou (o "Send a test request") a vê chegar; na janela larga,
      // o detalhe a mostra ao lado, e ela conta como lida.
      await this.openRequest(list[0], true, this.twoPanes());
    }
    if (this.preferences.autoNavEnable() && !this.document.hidden) {
      this.list()?.receive(complete, true);
      await this.openRequest(complete);
      this.list()?.scrollTo(complete.uuid);
      this.notify(complete, true);
      return;
    }
    // A que a tela abriu (a primeira numa Inbox vazia, ou a que substituiu a cortada) está à vista.
    const opened = this.requests.selected()?.uuid === complete.uuid;
    const inView = (this.list()?.receive(complete, opened) ?? true) || opened;
    this.notify(complete, inView, first ? 'said' : 'now');
  }

  private welcome(request: WebhookRequest): void {
    const time = parseUtc(request.created_at).toLocaleTimeString(
      this.document.documentElement.lang || 'en',
      { hour: 'numeric', minute: '2-digit' },
    );
    const [path] = routeOf(request.url).split('?');
    this.firstArrival.set({ method: request.method, path, time });
    if (this.claimed(request)) {
      return;
    }
    void this.announcer.announce(
      $localize`First request arrived: ${request.method}:method: ${path}:path:, at ${time}:time:.`,
      'polite',
      ANNOUNCEMENT_MS,
    );
  }

  protected dismissFirst(): void {
    this.firstArrival.set(null);
    const tokenId = this.tokenId();
    if (!tokenId) {
      return;
    }
    try {
      const key = GUIDES_KEY(tokenId);
      const dismissed = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
      localStorage.setItem(key, JSON.stringify([...new Set([...dismissed, 'first'])]));
    } catch {
      // Sem localStorage, a faixa some só nesta visita.
    }
  }

  private guideDismissed(name: string): boolean {
    const tokenId = this.tokenId();
    try {
      const saved = tokenId ? localStorage.getItem(GUIDES_KEY(tokenId)) : null;
      return (JSON.parse(saved ?? '[]') as string[]).includes(name);
    } catch {
      return false;
    }
  }

  protected openGuide(name: GuideName): Promise<boolean> {
    return this.router.navigate([], {
      queryParams: { guide: name },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * O redirect pelo navegador (se ligado), o anúncio e, com a nova fora da vista, o aviso "Request
   * received" com "View", só visual: quem fala a chegada é o anúncio. `speech`: `said` quando outra
   * fala já a disse (as boas-vindas da primeira, o roteiro que a reclama); `later` com filtro, até se
   * saber se ela aparece (`announceFound`).
   */
  private notify(
    request: WebhookRequest,
    inView: boolean,
    speech: 'now' | 'said' | 'later' = 'now',
  ): void {
    if (this.preferences.redirectEnable()) {
      void this.redirector.redirect(request);
    }
    if (speech === 'later') {
      this.unseenArrivals.set(request.uuid, request);
    } else {
      this.announceArrival(request, speech === 'said' || this.claimed(request));
    }
    if (!inView) {
      // INBOX-15: o método e a rota, para decidir se vale abrir sem sair do que está fazendo.
      const route = routeOf(request.url);
      this.snackBar
        .open(
          $localize`Request received · ${request.method}:method: ${route}:route:`,
          $localize`View`,
          { duration: RECEIVED_NOTICE_MS, politeness: 'off' },
        )
        .onAction()
        .subscribe(() => void this.viewNewest());
    }
  }

  /** Já se sabe quais chegadas o filtro mostra: só essas são ditas. */
  private announceFound(): void {
    for (const [requestId, request] of this.unseenArrivals) {
      if (this.listed(requestId)) {
        this.announceArrival(request);
      }
    }
    this.unseenArrivals.clear();
  }

  private claimed(request: WebhookRequest): boolean {
    return this.shownGuide?.claims(request) ?? false;
  }

  private async viewNewest(): Promise<void> {
    const newest = this.requests.newest();
    if (newest) {
      this.list()?.showNew();
      this.showDetail.set(true);
      await this.openRequest(newest);
    }
  }

  /**
   * Borda de entrada: a chegada que encontra o anúncio livre fala na hora e abre uma janela; as que
   * chegam dentro dela falam juntas no fim, e a janela se renova enquanto houver o que dizer.
   * `said`: outra fala já disse esta; ela abre a janela, mas não entra na soma.
   */
  private announceArrival(request: WebhookRequest, said = false): void {
    if (this.announceTimer) {
      if (!said) {
        this.arrivals++;
        this.lastArrival = request;
      }
      return;
    }
    if (!said) {
      this.say(arrivedText(request));
    }
    this.openAnnounceWindow();
  }

  private openAnnounceWindow(): void {
    this.announceTimer = setTimeout(() => {
      const [count, last] = [this.arrivals, this.lastArrival];
      [this.announceTimer, this.arrivals, this.lastArrival] = [null, 0, null];
      if (count > 0 && last) {
        this.say(moreArrivedText(count, last));
        this.openAnnounceWindow();
      }
    }, ANNOUNCE_EVERY_MS);
  }

  private say(message: string): void {
    void this.announcer.announce(message, 'polite', ANNOUNCEMENT_MS);
  }
}

function spokenRoute(request: WebhookRequest): { method: string; route: string; status?: number } {
  const [route] = routeOf(request.url).split('?');
  return { method: request.method, route, status: request.response?.status };
}

function arrivedText(request: WebhookRequest): string {
  const { method, route, status } = spokenRoute(request);
  return status === undefined
    ? $localize`${method}:method: ${route}:route: arrived`
    : $localize`${method}:method: ${route}:route: arrived · answered ${status}:status:`;
}

function moreArrivedText(count: number, last: WebhookRequest): string {
  const { method, route, status } = spokenRoute(last);
  if (count === 1) {
    return status === undefined
      ? $localize`1 more request arrived: ${method}:method: ${route}:route:`
      : $localize`1 more request arrived: ${method}:method: ${route}:route: · answered ${status}:status:`;
  }
  return status === undefined
    ? $localize`${count}:count: more requests arrived, the last ${method}:method: ${route}:route:`
    : $localize`${count}:count: more requests arrived, the last ${method}:method: ${route}:route: · answered ${status}:status:`;
}
