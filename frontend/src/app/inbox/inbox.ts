import { LiveAnnouncer } from '@angular/cdk/a11y';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { EMPTY, Subject, debounceTime, switchMap } from 'rxjs';
import { CompareStore } from '../diff/compare-store';
import { RequestStream } from '../realtime/request-stream';
import { RequestDetail } from '../request-detail/request-detail';
import { RequestList } from '../requests/request-list';
import { RequestStore } from '../requests/request-store';
import { RequestCreated, WebhookRequest } from '../requests/webhook-request';
import { filterFromParams, filterToParams, sameFilter } from '../search/request-filter';
import { Onboarding } from '../onboarding/onboarding';
import { Preferences } from '../settings/preferences';
import { Redirector } from '../settings/redirect';
import { isTyping } from '../shell/hotkeys';
import { ShellSettings } from '../shell/shell-settings';
import { Viewport } from '../shell/viewport';
import { TokenStore } from '../token/token-store';
import { isProtectedError } from '../token/url-lock';
import { Icon } from '../ui/icon';
import { Split } from '../ui/split';

/** Com filtro ativo, espera a rajada de mensagens novas acabar antes de refazer a busca. */
export const SEARCH_REFRESH_DEBOUNCE_MS = 300;
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
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly settings = inject(ShellSettings);
  private readonly viewport = inject(Viewport);

  /** Parâmetros da rota (`withComponentInputBinding`). */
  readonly tokenId = input<string>();
  readonly requestId = input<string>();
  readonly page = input<string>();
  /** Filtros da query da rota (`?signature=invalid&schema=valid&methods=POST,GET&q=texto`). */
  readonly signature = input<string>();
  readonly schema = input<string>();
  readonly methods = input<string>();
  readonly q = input<string>();
  private readonly routeFilter = computed(() =>
    filterFromParams({
      signature: this.signature(),
      schema: this.schema(),
      methods: this.methods(),
      q: this.q(),
    }),
  );

  private readonly list = viewChild(RequestList);
  private readonly detail = viewChild(RequestDetail);

  /** Lista e detalhe lado a lado (classes expandida em diante); abaixo, um painel por vez. */
  protected readonly twoPanes = computed(() =>
    ['expanded', 'large', 'extra-large'].includes(this.viewport.windowClass()),
  );
  /** Um painel por vez: o detalhe em tela cheia depois de escolher na lista. */
  protected readonly showDetail = signal(false);
  protected readonly listWidth = signal(380);
  /** A URL pedida que não existia mais e a que a tela criou no lugar (C §2.11). */
  private readonly replaced = signal<{ missing: string; token: string } | null>(null);
  /** O onboarding da URL criada no lugar diz qual não existia mais. */
  protected readonly missingNote = computed(() => {
    const replaced = this.replaced();
    return replaced && replaced.token === this.tokenId() ? replaced.missing : null;
  });

  private readonly streamTokenId = signal<string | null>(null);
  private loading: { tokenId: string; done: Promise<boolean> } | null = null;
  private readonly searchRefresh = new Subject<void>();
  private arrivals = 0;
  /** A mensagem que a própria tela abriu por último (sem o usuário pedir). */
  private chosenByScreen: string | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const unread = this.requests.unread().length;
      this.title.setTitle(unread > 0 ? `(${unread}) Anzol` : 'Anzol');
    });

    effect(() => {
      const tokenId = this.tokenId();
      const requestId = this.requestId();
      const page = Number(this.page() ?? 1);
      untracked(() => void this.openRoute(tokenId, requestId, page));
    });

    // Filtros na rota: a query muda (um link, o "Show in Inbox" do Health) → a lista filtra; a busca
    // muda na tela → a query acompanha (replaceUrl), para o link ser compartilhável.
    effect(() => {
      const filter = this.routeFilter();
      untracked(() => {
        if (this.listReady()) {
          void this.requests.applyFilter(filter);
        }
      });
    });
    effect(() => {
      const filter = this.requests.filter();
      untracked(() => {
        if (this.listReady() && !sameFilter(filter, this.routeFilter())) {
          void this.router.navigate([], {
            queryParams: filterToParams(filter),
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
        }
      });
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
      this.document.removeEventListener('keydown', keys);
      if (this.announceTimer) {
        clearTimeout(this.announceTimer);
      }
    });
  }

  /**
   * Abre a mensagem pela rota. Com `replaceUrl`, é a tela que escolheu (a primeira ao abrir a URL,
   * a que substituiu a cortada): no celular isso não tira a lista da frente.
   */
  protected openRequest(request: WebhookRequest, replaceUrl = false): Promise<boolean> {
    this.chosenByScreen = replaceUrl ? request.uuid : null;
    const page = this.requests.pageOf(request.uuid);
    // O filtro da rota fica: abrir uma mensagem não desfaz a busca.
    return this.router.navigate(['/', request.token_id, request.uuid, page], {
      replaceUrl,
      queryParamsHandling: 'preserve',
    });
  }

  /** Clicar na lista fecha a comparação aberta e abre a mensagem (em tela cheia, no celular). */
  protected openFromList(request: WebhookRequest): void {
    this.compare.close();
    this.showDetail.set(true);
    void this.openRequest(request);
  }

  protected backToList(): void {
    this.showDetail.set(false);
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

  private async openRoute(
    tokenId: string | undefined,
    requestId: string | undefined,
    page: number,
  ) {
    if (!tokenId) {
      await this.openSavedOrNewToken();
      return;
    }
    // Sem stream (Inbox recriado ao voltar de outro destino), a lista também está velha.
    const stale = this.requests.tokenId() !== tokenId || this.streamTokenId() !== tokenId;
    if (stale && !(await this.loadToken(tokenId, page))) {
      return;
    }
    const list = this.requests.requests();
    if (requestId && list.some((request) => request.uuid === requestId)) {
      this.requests.select(requestId);
      // Link permanente, Newer/Older, Follow new: no celular, o detalhe vem para a frente.
      if (requestId !== this.chosenByScreen) {
        this.showDetail.set(true);
      }
      if (requestId === this.requests.newest()?.uuid) {
        this.list()?.clearNew();
      }
    } else if (list.length > 0) {
      await this.openRequest(list[0], true);
    }
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
    } catch (error) {
      // URL protegida sem acesso: a tela de desbloqueio assume (`UrlLock`); não é URL apagada.
      if (!isProtectedError(error)) {
        await this.replaceMissingToken(tokenId, error);
      }
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

  /**
   * URL apagada ou inválida: cria outra, como o app atual, e o onboarding dela diz qual não
   * existia mais e por quê (C §2.11), no lugar do snackbar de 10 s.
   */
  private async replaceMissingToken(missing: string, error: unknown): Promise<void> {
    const token = await this.tokens.create();
    this.requests.resetUnread();
    if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410)) {
      this.replaced.set({ missing, token: token.uuid });
    }
    await this.router.navigate(['/', token.uuid], { replaceUrl: true });
  }

  private async receive({ request, total, truncated, removed }: RequestCreated): Promise<void> {
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
    const replacement = this.requests.append(complete, total, removed);
    const list = this.requests.requests();
    if (replacement) {
      await this.openRequest(replacement, true);
    } else if (!this.requests.selected()) {
      // A primeira de uma Inbox vazia é a tela que abre (como a primeira ao abrir a URL): no celular
      // a lista fica à frente, e quem mandou (o "Send a test request") a vê chegar.
      await this.openRequest(list[0], true);
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
      this.snackBar
        .open($localize`Request received`, $localize`View`, { duration: RECEIVED_NOTICE_MS })
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
