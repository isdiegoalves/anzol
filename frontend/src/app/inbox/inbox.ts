import { LiveAnnouncer } from '@angular/cdk/a11y';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
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
import { Router, RouterLink } from '@angular/router';
import { EMPTY, Subject, debounceTime, switchMap } from 'rxjs';
import { CompareStore } from '../diff/compare-store';
import type { GuideName } from '../guides/guide';
import { routeOf } from '../pipeline/pipeline';
import { Connection } from '../realtime/connection-store';
import { RequestStream } from '../realtime/request-stream';
import { ActionPanel } from '../request-detail/action-panel';
import { ActionPanelStore, ActionTab } from '../request-detail/action-panel-store';
import { RequestDetail } from '../request-detail/request-detail';
import { parseUtc } from '../request-detail/dates';
import { RequestUnopened } from '../request-detail/request-unopened';
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
import { LiveRegion } from '../ui/live-region';
import { Split } from '../ui/split';

const GUIDES_KEY = (tokenId: string) => `anzol.guides.${tokenId}`;

/** F1: os filtros por valor de cada URL, na aba (o dado da requisição não vai para o endereço). */
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

/** B2: o `GET` da requisição pedida pelo link que passa disto ganha "Loading request #…". */
export const LOADING_NOTICE_MS = 1000;

/** Com filtro ativo, espera a rajada de mensagens novas acabar antes de refazer a busca. */
export const SEARCH_REFRESH_DEBOUNCE_MS = 300;
/** Quanto tempo a tela espera o eco de uma navegação que ela mesma fez. */
export const ECHO_MS = 5000;
/** Chegadas somadas num anúncio só para o leitor de tela (WCAG 4.1.3, sem inundar). */
export const ANNOUNCE_EVERY_MS = 5000;
/** O aviso "Request received" (M3: 4 s), só quando a nova não está à vista. */
export const RECEIVED_NOTICE_MS = 4000;

/**
 * Inbox: lista e detalhe lado a lado com a divisória redimensionável (a partir de 840 px); abaixo,
 * um painel por vez, com o detalhe em tela cheia. A rota (`/`, `/{tokenId}`,
 * `/{tokenId}/{requestId}/{page}`) é a fonte da verdade: clicar numa mensagem navega, e a navegação
 * abre a mensagem. Tempo real: a nova fica destacada; fora da vista, a pílula e o aviso; "Follow
 * new" abre cada uma que chega; o leitor de tela ouve as chegadas somadas a cada 5 s.
 */
@Component({
  selector: 'app-inbox',
  imports: [
    ActionPanel,
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
  private readonly connection = inject(Connection);
  protected readonly grouping = inject(EventGrouping);
  protected readonly panel = inject(ActionPanelStore);
  protected readonly waitFor = inject(WaitFor);
  private readonly chips = inject(FilterChips);
  protected readonly firstArrival = signal<{ method: string; path: string; time: string } | null>(
    null,
  );
  /** F1: "This link does not carry 1 filter by value." (os valores não vão no endereço). */
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
  /** B2: o `created_at` que o link permanente leva, para dizer de quando era a que sumiu. */
  readonly at = input<string>();
  /** Filtros da query da rota (`?signature=invalid&schema=valid&methods=POST,GET&q=texto`). */
  readonly signature = input<string>();
  readonly schema = input<string>();
  readonly methods = input<string>();
  readonly q = input<string>();
  /** Desfecho (C2): `?outcome=rule|near_miss|default&rule={id}&ruleName={nome}`. */
  readonly outcome = input<string>();
  readonly rule = input<string>();
  readonly ruleName = input<string>();
  /** M1: o motivo exato de assinatura e o caminho do erro de schema (`?signatureReason=&schemaPath=`). */
  readonly signatureReason = input<string>();
  readonly schemaPath = input<string>();
  /** B2: o status respondido, por classe ou exato (`?answered=4xx,429`), filtrado no navegador. */
  readonly answered = input<string>();
  /** F1: quantos filtros por valor a tela tinha; os valores ficam no `sessionStorage` da aba. */
  readonly values = input<string>();
  readonly window = input<string>();
  /**
   * E1: o link da requisição agrupada leva o valor do evento e o nome da chave
   * (`?event=evt_48213&key=x-loja-event-id`); num navegador sem a chave, a oferta a propõe.
   */
  readonly event = input<string>();
  readonly key = input<string>();
  /** R1: o roteiro aberto no lugar do detalhe (`?guide=first|retry`). */
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
      methods: this.methods(),
      q: this.q(),
      outcome: this.outcome(),
      rule: this.rule(),
      ruleName: this.ruleName(),
      signatureReason: this.signatureReason(),
      schemaPath: this.schemaPath(),
      answered: this.answered(),
      window: this.window(),
    }),
  );
  /** O filtro da rota com os valores que esta aba guardou (o endereço só diz quantos são). */
  private readonly routeFilterWithValues = computed((): RequestFilter => {
    const filter = this.routeFilter();
    const count = Number(this.values() ?? 0);
    const tokenId = this.tokenId();
    const values = count > 0 && tokenId ? readValueFilters(tokenId).slice(0, count) : [];
    return values.length > 0 ? { ...filter, values } : filter;
  });

  private readonly list = viewChild(RequestList);
  private readonly detail = viewChild(RequestDetail);

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
  /**
   * B2 (UX-38): o aviso da requisição aberta que sumiu do servidor, com a causa e a hora em que o
   * navegador soube. Vazio enquanto ela existe.
   */
  protected readonly notice = computed(() => {
    const gone = this.requests.gone();
    const loading = this.loadingRequest();
    if (!gone) {
      return loading ? $localize`Loading request #${loading.slice(0, 5)}:id:…` : '';
    }
    const time = gone.at.toLocaleTimeString(this.document.documentElement.lang || 'en', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const copy = $localize`You are seeing the copy this page had loaded.`;
    const leaves = $localize`This copy goes away when you leave it.`;
    const keeps = this.tokens.token()?.auto_cleanup;
    const causes: Record<typeof gone.cause, string> = {
      cleanup: keeps
        ? $localize`This request was deleted from the server by auto cleanup (keeps the newest ${keeps}:limit:), noticed at ${time}:time:. ${copy}:copy:`
        : $localize`This request was deleted from the server by auto cleanup, noticed at ${time}:time:. ${copy}:copy:`,
      deleted: $localize`You deleted this request at ${time}:time:. ${copy}:copy:`,
      unknown: $localize`This request is no longer on the server, noticed at ${time}:time:. It may have been deleted or cut by auto cleanup.`,
    };
    return `${causes[gone.cause]} ${leaves}`;
  });
  /** O link pede uma requisição cujo `GET` passou de 1 s: o aviso diz que ela está a caminho. */
  private readonly loadingRequest = signal<string | null>(null);
  /** Um painel por vez: o detalhe em tela cheia depois de escolher na lista. */
  protected readonly showDetail = signal(false);
  protected readonly listWidth = signal(380);
  private readonly streamTokenId = signal<string | null>(null);
  private loading: { tokenId: string; done: Promise<boolean> } | null = null;
  private readonly searchRefresh = new Subject<void>();
  private arrivals = 0;
  /** A mensagem que a própria tela abriu por último (sem o usuário pedir). */
  private chosenByScreen: string | null = null;
  /** A que a tela abriu sem ninguém a ver: segue nas não lidas (INBOX-02). */
  private keepUnread: string | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Os filtros que a tela mandou para a rota e cujo eco ainda não voltou. */
  private readonly pushed: { filter: RequestFilter; at: number }[] = [];
  /** A maior `seq` que a tela já viu nesta URL: de onde a volta da conexão retoma. */
  private lastSeq = 0;

  constructor() {
    effect((onCleanup) => {
      const [host, name, tokenId] = [this.guideHost(), this.guideName(), this.tokens.token()?.uuid];
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
      const page = Number(this.page() ?? 1);
      untracked(() => void this.openRoute(tokenId, requestId, page));
    });
    // E1: a chave que o link trouxe vira a oferta, num navegador que ainda não decidiu.
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
          // F1: os valores ficam na aba, antes da rota, para o eco dela os achar.
          writeValueFilters(this.requests.tokenId(), filter.values ?? []);
          this.pushToRoute(filter);
        }
      });
    });
    // F1: o link diz que a tela tinha filtros por valor que esta aba não guardou: a tela avisa.
    effect(() => {
      const count = Number(this.values() ?? 0);
      const tokenId = this.tokenId();
      untracked(() => {
        const kept = count > 0 && tokenId ? readValueFilters(tokenId).length : 0;
        this.chips.missingValues.set(Math.max(0, count - kept));
      });
    });

    effect(() => {
      const seen = this.requests.requests().map((request) => request.seq ?? 0);
      this.lastSeq = Math.max(this.lastSeq, ...seen);
    });
    effect(() => {
      // Outra URL: a contagem recomeça.
      this.tokenId();
      this.lastSeq = 0;
      this.firstArrival.set(null);
    });

    // A conexão voltou: o que chegou no intervalo entra na lista e na pílula, sem mover nada.
    effect(() => {
      if (this.connection.restored() > 0) {
        untracked(() => void this.catchUp());
      }
    });

    toObservable(this.streamTokenId)
      .pipe(
        switchMap((tokenId) => (tokenId ? this.stream.connect(tokenId) : EMPTY)),
        takeUntilDestroyed(),
      )
      .subscribe((event) => void this.receive(event));

    this.searchRefresh
      .pipe(
        debounceTime(SEARCH_REFRESH_DEBOUNCE_MS),
        switchMap(() => this.requests.refreshSearch()),
        takeUntilDestroyed(),
      )
      .subscribe();

    // J e K: a mensagem mais antiga e a mais nova (C §3.2), fora dos campos e se ligados.
    const keys = (event: KeyboardEvent) => this.navigateByKey(event);
    this.document.addEventListener('keydown', keys);
    inject(DestroyRef).onDestroy(() => {
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
    });
  }

  /**
   * Abre a mensagem pela rota. Com `replaceUrl`, é a tela que escolheu (a primeira ao abrir a URL,
   * a que substituiu a cortada): no celular isso não tira a lista da frente, e ela segue não lida
   * (salvo `read`, quando o detalhe a mostra a quem esperava por ela).
   */
  protected openRequest(
    request: WebhookRequest,
    replaceUrl = false,
    read = !replaceUrl,
  ): Promise<boolean> {
    this.chosenByScreen = replaceUrl ? request.uuid : null;
    this.keepUnread = read ? null : request.uuid;
    const page = this.requests.pageOf(request.uuid);
    // O filtro da rota fica: abrir uma mensagem não desfaz a busca.
    return this.router.navigate(['/', request.token_id, request.uuid, page], {
      replaceUrl,
      queryParamsHandling: 'preserve',
    });
  }

  /** Monta o roteiro pedido no endereço; o pedaço dele só é baixado aqui. */
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
    });
    return () => {
      gone = true;
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

  /** Volta à lista com o foco no item de onde se saiu (sem ele, o foco cairia no body). */
  protected backToList(): void {
    this.showDetail.set(false);
    afterNextRender(() => this.list()?.focusSelected(), { injector: this.injector });
  }

  /** Confirma antes: a confirmação (e o `MatDialog`) vêm sob demanda. */
  protected async deleteAllRequests(): Promise<void> {
    const { confirmDeleteAll } = await import('./confirm-delete-all');
    if (await confirmDeleteAll(this.injector, this.requests.total())) {
      await this.requests.deleteAll();
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
    // O Esc de um menu que abriu sobre o botão (o do valor, F1) é do menu: o foco volta ao botão.
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
  ) {
    if (!tokenId) {
      await this.openSavedOrNewToken();
      return;
    }
    // Voltando à Inbox sem mensagem na rota (o rail, a marca): a que estava aberta nesta URL.
    const previous =
      requestId === undefined && this.requests.tokenId() === tokenId
        ? this.requests.selected()
        : undefined;
    // Sem stream (Inbox recriado ao voltar de outro destino), a lista também está velha.
    const stale = this.requests.tokenId() !== tokenId || this.streamTokenId() !== tokenId;
    if (stale && !(await this.loadToken(tokenId, page))) {
      return;
    }
    const list = this.requests.requests();
    if (requestId && list.some((request) => request.uuid === requestId)) {
      this.requests.select(requestId, requestId !== this.keepUnread);
      // J, K, Newer e Older: a parada do Tab da lista (e o foco, se estava nela) acompanha.
      this.list()?.follow(requestId);
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
      if (again) {
        await this.openRequest(again, true);
      }
    } else if (requestId !== undefined) {
      // B2 (CA-5): o link diz qual abrir; se ela não abre, nenhuma outra entra no lugar.
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
   * responde, o detalhe diz isso e **nenhuma outra é aberta no lugar** (B2, CA-5). Se a rota mudou
   * enquanto isso, a nova rota decide.
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

  /** "Try again" do detalhe que não carregou. */
  protected async retryUnopened(): Promise<void> {
    const tokenId = this.tokenId();
    const unopened = this.requests.unopened();
    if (tokenId && unopened) {
      await this.openOutsideList(tokenId, unopened.id);
    }
  }

  /**
   * "Open the event" (B2 com a E1): o link de uma requisição que não existe mais trouxe o evento;
   * abre a tentativa mais nova dele que está carregada, com o evento expandido.
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
   * não abriu (sem requisição nenhuma aberta; a busca, sem resultado, não abre a primeira).
   */
  protected async searchFor(requestId: string): Promise<void> {
    this.showDetail.set(false);
    await this.requests.applyFilter({ ...NO_FILTER, text: requestId });
    this.requests.unopened.set(null);
    await this.router.navigate(['/', this.tokenId()], {
      queryParams: filterToParams(this.requests.filter()),
    });
  }

  /** A lista da URL da rota já está carregada (os filtros da rota e da tela podem conversar). */
  private listReady(): boolean {
    const tokenId = this.tokenId();
    return !!tokenId && this.loading === null && this.requests.tokenId() === tokenId;
  }

  /** Várias navegações seguidas para o mesmo token esperam a mesma carga. */
  private loadToken(tokenId: string, page: number): Promise<boolean> {
    if (this.loading?.tokenId !== tokenId) {
      const done = this.fetchToken(tokenId, page).finally(() => (this.loading = null));
      this.loading = { tokenId, done };
    }
    return this.loading.done;
  }

  private async fetchToken(tokenId: string, page: number): Promise<boolean> {
    // O "Choose another request" do Compare (B2) chega aqui com a A esperando a outra escolha.
    if (this.compare.picking()?.token_id !== tokenId) {
      this.compare.close();
    }
    try {
      await this.tokens.load(tokenId);
    } catch {
      // URL protegida sem acesso: a tela de desbloqueio assume (`UrlLock`). URL que não existe: a
      // página única de URL inexistente (`UrlMissing`). Nenhuma das duas cria outra URL (B1).
      return false;
    }
    try {
      await this.requests.load(tokenId, page, untracked(this.routeFilterWithValues));
    } catch (error) {
      if (!isProtectedError(error)) {
        this.snackBar.open($localize`Requests not found - invalid ID`, undefined, {
          duration: 1000,
        });
      }
      return false;
    }
    this.streamTokenId.set(tokenId);
    return true;
  }

  private async openSavedOrNewToken(): Promise<void> {
    const saved = this.tokens.token();
    const token = saved ?? (await this.tokens.create());
    if (!saved) {
      this.requests.resetUnread();
    }
    await this.router.navigate(['/', token.uuid], { replaceUrl: true });
  }

  /** O que chegou durante a queda (`after=<seq>`): acumula na pílula, sem abrir nem rolar. */
  private async catchUp(): Promise<void> {
    if (!this.listReady()) {
      return;
    }
    if (this.lastSeq === 0) {
      // Mensagens antigas, sem `seq`: relê o que a lista mostra.
      if (this.requests.filtering()) {
        this.searchRefresh.next();
      } else {
        await this.requests.reload();
      }
      return;
    }
    const { data, total } = await this.requests.arrivedAfter(this.lastSeq);
    for (const request of data.filter((arrived) => !this.listed(arrived.uuid))) {
      if (this.requests.filtering()) {
        // Só a busca diz se ela casa: conta agora, e a busca é refeita em seguida.
        this.requests.countArrival(request, total);
      } else {
        this.requests.append(request, total);
      }
      this.lastSeq = Math.max(this.lastSeq, request.seq ?? 0);
      this.list()?.receive(request, false);
      this.announceArrival();
    }
    if (this.requests.filtering()) {
      this.searchRefresh.next();
    }
  }

  private listed(requestId: string): boolean {
    return this.requests.requests().some((request) => request.uuid === requestId);
  }

  private async receive({ request, total, truncated, removed }: RequestCreated): Promise<void> {
    // A reconexão pode repetir a que a volta da conexão já trouxe.
    if (this.listed(request.uuid)) {
      return;
    }
    // Corpo > 1 MB chega cortado no evento: a mensagem completa vem da API.
    const complete = truncated
      ? await this.requests.fetchOne(request.token_id, request.uuid)
      : request;
    if (this.requests.filtering()) {
      // Se a nova casa com o filtro, só a busca diz: conta agora e busca de novo em seguida.
      this.requests.countArrival(complete, total, removed);
      this.searchRefresh.next();
      this.notify(complete, false);
      return;
    }
    const first = !this.requests.hasRequests() && !this.guideDismissed('first');
    // A limpeza automática pode ter cortado a mensagem aberta: ela segue na tela, como cópia, com o
    // aviso (B2); nenhuma outra é aberta no lugar.
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
    this.notify(complete, inView, !first);
  }

  private welcome(request: WebhookRequest): void {
    const time = parseUtc(request.created_at).toLocaleTimeString(
      this.document.documentElement.lang || 'en',
      { hour: 'numeric', minute: '2-digit' },
    );
    const [path] = routeOf(request.url).split('?');
    this.firstArrival.set({ method: request.method, path, time });
    void this.announcer.announce(
      $localize`First request arrived: ${request.method}:method: ${path}:path:, at ${time}:time:.`,
      'polite',
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
   * O redirect pelo navegador (se ligado), o anúncio somado e, com a nova fora da vista, o aviso
   * "Request received" com "View".
   */
  private notify(request: WebhookRequest, inView: boolean, announce = true): void {
    if (this.preferences.redirectEnable()) {
      void this.redirector.redirect(request);
    }
    if (announce) {
      this.announceArrival();
    }
    if (!inView) {
      // INBOX-15: o método e a rota, para decidir se vale abrir sem sair do que está fazendo.
      const route = routeOf(request.url);
      this.snackBar
        .open(
          $localize`Request received · ${request.method}:method: ${route}:route:`,
          $localize`View`,
          {
            duration: RECEIVED_NOTICE_MS,
          },
        )
        .onAction()
        .subscribe(() => void this.viewNewest());
    }
  }

  private async viewNewest(): Promise<void> {
    const newest = this.requests.newest();
    if (newest) {
      this.list()?.showNew();
      this.showDetail.set(true);
      await this.openRequest(newest);
    }
  }

  private announceArrival(): void {
    this.arrivals++;
    this.announceTimer ??= setTimeout(() => {
      const count = this.arrivals;
      this.arrivals = 0;
      this.announceTimer = null;
      void this.announcer.announce(
        count === 1
          ? $localize`1 new request arrived`
          : $localize`${count}:count: new requests arrived`,
        'polite',
      );
    }, ANNOUNCE_EVERY_MS);
  }
}
