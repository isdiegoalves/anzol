import { LiveAnnouncer } from '@angular/cdk/a11y';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
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
import { MatIconButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { EMPTY, Subject, debounceTime, switchMap } from 'rxjs';
import { CompareStore } from '../diff/compare-store';
import type { GuideName } from '../guides/guide';
import { routeOf } from '../pipeline/pipeline';
import { Connection } from '../realtime/connection-store';
import { RequestStream } from '../realtime/request-stream';
import { RequestDetail } from '../request-detail/request-detail';
import { RequestList } from '../requests/request-list';
import { RequestStore } from '../requests/request-store';
import { RequestCreated, WebhookRequest } from '../requests/webhook-request';
import {
  RequestFilter,
  filterFromParams,
  filterToParams,
  sameFilter,
} from '../search/request-filter';
import { WaitForButton } from '../search/wait-for';
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
import { Split } from '../ui/split';

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
    Icon,
    MatIconButton,
    MatSlideToggle,
    NgTemplateOutlet,
    Onboarding,
    RequestDetail,
    RequestList,
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

  /** Parâmetros da rota (`withComponentInputBinding`). */
  readonly tokenId = input<string>();
  readonly requestId = input<string>();
  readonly page = input<string>();
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
    }),
  );

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

    // Filtros na rota: a query muda (um link, o "Show in Inbox" do Health) → a lista filtra; a busca
    // muda na tela → a query acompanha (replaceUrl), para o link ser compartilhável.
    // O eco da própria navegação pode chegar atrasado, com a tela já em outro filtro (a pessoa
    // seguiu digitando): ele não desfaz o filtro da tela; a rota é que volta a acompanhá-la.
    effect(() => {
      const filter = this.routeFilter();
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
          this.pushToRoute(filter);
        }
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
      .subscribe((replacement) => {
        if (replacement) {
          void this.openRequest(replacement, true);
        }
      });

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
    if (sameFilter(filter, this.routeFilter())) {
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
      this.escapeToList(event);
      return;
    }
    if (
      (key !== 'j' && key !== 'k') ||
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
      if (key === 'j') {
        detail.showOlder();
      } else {
        detail.showNewer();
      }
    }
  }

  /** Esc no detalhe (sem nada por cima que o trate antes): o foco volta ao item da lista. */
  private escapeToList(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (!event.defaultPrevented && target?.closest('.detail-pane') && this.twoPanes()) {
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
    } else {
      const opened = requestId !== undefined && (await this.openOutsideList(tokenId, requestId));
      if (!opened && list.length > 0) {
        await this.openRequest(list[0], true);
      }
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
   * empurram as outras de página): busca pela API. Sumida (404, cortada pela limpeza automática),
   * abre a mais antiga que ficou; se a rota mudou enquanto isso, a nova rota decide. Devolve se
   * abriu alguma.
   */
  private async openOutsideList(tokenId: string, requestId: string): Promise<boolean> {
    const request = await this.fetchKept(tokenId, requestId);
    if (!request) {
      const oldest = await this.requests.oldestKept();
      return oldest !== undefined && this.openRequest(oldest, true);
    }
    if (this.requestId() === requestId) {
      this.requests.selectOutsideList(request);
      this.showDetail.set(true);
    }
    return true;
  }

  /** A aberta fora da lista saiu pela limpeza automática: a vizinha é a mais antiga que ficou. */
  private async replaceCutOutsideList(
    removed: readonly string[] = [],
  ): Promise<WebhookRequest | undefined> {
    const selected = this.requests.selected();
    if (!selected || this.requests.selectedIndex() >= 0 || !removed.includes(selected.uuid)) {
      return undefined;
    }
    return this.requests.oldestKept();
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
    this.compare.close();
    try {
      await this.tokens.load(tokenId);
    } catch {
      // URL protegida sem acesso: a tela de desbloqueio assume (`UrlLock`). URL que não existe: a
      // página única de URL inexistente (`UrlMissing`). Nenhuma das duas cria outra URL (B1).
      return false;
    }
    try {
      await this.requests.load(tokenId, page, untracked(this.routeFilter));
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
    // A limpeza automática pode ter cortado a mensagem aberta: abre a mais próxima que ficou.
    const replacement =
      this.requests.append(complete, total, removed) ?? (await this.replaceCutOutsideList(removed));
    const list = this.requests.requests();
    if (replacement) {
      await this.openRequest(replacement, true);
    } else if (!this.requests.selected()) {
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
    this.notify(complete, inView);
  }

  /**
   * O redirect pelo navegador (se ligado), o anúncio somado e, com a nova fora da vista, o aviso
   * "Request received" com "View".
   */
  private notify(request: WebhookRequest, inView: boolean): void {
    if (this.preferences.redirectEnable()) {
      void this.redirector.redirect(request);
    }
    this.announceArrival();
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
