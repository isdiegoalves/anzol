import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, tap } from 'rxjs';
import {
  NO_FILTER,
  RequestFilter,
  RequestSorting,
  ValueFilter,
  answeredMatches,
  isFilterActive,
  sameFilter,
  searchBody,
} from '../search/request-filter';
import { Preferences } from '../settings/preferences';
import { SLOW_READ_MS } from '../ui/slow-notice';
import { RequestPage, WebhookRequest } from './webhook-request';

/** Mensagens por página da listagem (e da busca). */
const REQUESTS_PER_PAGE = 50;

/** O teto de página da busca. */
export const SCAN_PAGE = 100;
/** A mesma janela de Métricas. */
export const SCAN_WINDOW = 500;

/** O alcance do filtro que roda no navegador: a tela nunca diz "0" sem dizer onde procurou. */
export interface StatusScan {
  scanned: number;
  total: number;
  done: boolean;
  /** Com a janela pedida: ela, quando a URL guarda mais que ela; `null` quando não guarda. */
  window?: number | null;
}

/**
 * A requisição aberta sumiu do servidor com a cópia dela na tela. `at` é a hora do navegador
 * quando ele soube; `index` é onde ela estava, para "Newer" e "Older" saírem da cópia.
 */
export interface GoneRequest {
  id: string;
  cause: 'cleanup' | 'deleted' | 'unknown';
  at: Date;
  index: number;
}

/** A primeira carga da lista, ou a busca, falhou: a tela diz o erro, e não "vazio" ou "0 casam". */
export interface ListFailure {
  kind: 'list' | 'search';
  /** 0 sem resposta (rede). */
  status: number;
  /** Quantas vezes seguidas a mesma falhou antes desta: a próxima tentativa sozinha espera mais. */
  attempt: number;
}

export interface UnopenedRequest {
  id: string;
  reason: 'missing' | 'failed';
}

/** Uma página da API já carregada na lista lateral. */
interface LoadedPage {
  page: number;
  data: WebhookRequest[];
}

/**
 * Mensagens da URL aberta: páginas carregadas, mensagem aberta e não lidas. Com filtro ativo, as
 * páginas vêm de `POST /token/{id}/requests/search` em vez de `GET /token/{id}/requests`.
 */
@Injectable({ providedIn: 'root' })
export class RequestStore {
  private readonly http = inject(HttpClient);
  private readonly preferences = inject(Preferences);

  private readonly pages = signal<readonly LoadedPage[]>([]);
  private readonly lastPageReached = signal(true);
  /** Id da mensagem aberta (vem da rota) e o objeto dela no momento em que foi aberta. */
  private readonly selection = signal<{ id: string; request?: WebhookRequest } | undefined>(
    undefined,
  );
  private readonly activeFilter = signal<RequestFilter>(NO_FILTER);
  /** Só vale a resposta da carga mais recente: o filtro pode mudar com uma busca a caminho. */
  private generation = 0;
  /**
   * O `seq` da mais nova da URL que a tela conhece, de onde a volta da conexão retoma com filtro; 0 quando nenhuma
   * tem `seq`. Não é o maior das carregadas: na página 3, na ordem inversa ou com filtro, ele ficaria para trás.
   */
  private newestSeq = 0;
  /**
   * O mesmo, para a lista sem filtro: só sobe com o que entrou nela, ou com uma releitura sem filtro que deu certo.
   * Fica atrás do `newestSeq` quando a chegada contada com filtro não entrou na lista (a releitura falhou).
   */
  private listedSeq = 0;

  private readonly goneState = signal<GoneRequest | null>(null);
  readonly gone = computed(() => {
    const gone = this.goneState();
    return gone && gone.id === this.selection()?.id ? gone : null;
  });
  readonly unopened = signal<UnopenedRequest | null>(null);
  /** Os filtros por valor que a busca recusou (422); a lista voltou ao filtro anterior. */
  readonly rejected = signal<readonly ValueFilter[]>([]);
  readonly scan = signal<StatusScan | null>(null);
  private scanLimit = SCAN_WINDOW;

  /** A lista de uma URL está sendo carregada (`load`): a tela mostra o esqueleto (C §2.11). */
  readonly loading = signal(false);
  /**
   * A URL cuja lista a tela está abrindo no lugar da de `tokenId`, até ela chegar: nada da anterior fica à vista
   * (lista, mensagem aberta, número do título).
   */
  readonly opening = signal<string | null>(null);
  private loads = 0;
  readonly failure = signal<ListFailure | null>(null);
  /** A abertura da lista (com a leitura da URL) passou de 30 s sem resposta. */
  readonly slow = signal(false);
  /** A busca passou de 30 s sem resposta. */
  readonly searchSlow = signal(false);
  private slowTimer: ReturnType<typeof setTimeout> | undefined;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  /** O filtro mudou e o resultado dele ainda não chegou: o que a lista mostra é do filtro anterior. */
  readonly searching = signal(false);
  /**
   * Ordem da lista (INBOX-01, protótipo C): a mais nova no topo por padrão, como o `sorting=newest`
   * da API; o botão do cabeçalho inverte. A página 1 é sempre a da ponta de cima.
   */
  readonly sorting = signal<RequestSorting>('newest');
  readonly newestFirst = computed(() => this.sorting() === 'newest');
  /** Token cuja lista está carregada. */
  readonly tokenId = signal<string | null>(null);
  /** Mensagens da URL, com ou sem filtro (o "M" de "N of M requests"). */
  readonly total = signal(0);
  /** O total de uma URL cuja lista não está carregada (o cabeçalho fora da Entrada, UX-12). */
  private readonly outside = signal<{ tokenId: string; total: number } | null>(null);
  /** Mensagens que casam com o filtro ativo (o "N"). */
  readonly matched = signal(0);
  /** Não lidas da URL da lista carregada. */
  readonly unread = computed(() => this.unreadOf(this.tokenId()));
  readonly filter = this.activeFilter.asReadonly();
  readonly filtering = computed(() => isFilterActive(this.activeFilter()));

  readonly requests = computed(() => this.pages().flatMap((page) => page.data));
  /** A URL tem mensagens, mesmo quando nenhuma casa com o filtro. */
  readonly hasRequests = computed(
    () => this.requests().length > 0 || (this.filtering() && this.total() > 0),
  );
  /** A mais nova carregada: o topo, com a mais nova primeiro; o fim, na ordem inversa. */
  readonly newest = computed(() =>
    this.newestFirst() ? this.requests()[0] : this.requests().at(-1),
  );
  readonly hasPreviousPage = computed(() => (this.pages()[0]?.page ?? 1) > 1);
  readonly hasNextPage = computed(() => this.requests().length > 0 && !this.lastPageReached());

  /**
   * Mensagem aberta, derivada da rota (id) e da lista. Apagar a mensagem aberta não fecha o
   * detalhe (como no app atual): sem ela na lista, fica o objeto guardado ao abrir. O mesmo vale
   * para a aberta que não casa com o filtro.
   */
  readonly selected = computed(() => {
    const selection = this.selection();
    return selection && (this.find(selection.id) ?? selection.request);
  });

  readonly selectedIndex = computed(() => {
    const selected = this.selected();
    return selected ? this.requests().indexOf(selected) : -1;
  });

  /** Quantas a URL guarda, para o cabeçalho: o da lista carregada, ou o lido à parte. */
  totalOf(tokenId: string): number | null {
    if (this.tokenId() === tokenId) {
      // Com a lista em erro, o total só se sabe quando alguma chega pelo tempo real.
      return this.failure()?.kind === 'list' && this.requests().length === 0 ? null : this.total();
    }
    const outside = this.outside();
    return outside?.tokenId === tokenId ? outside.total : null;
  }

  /** Lê só o total da URL (uma requisição por página), sem mexer na lista carregada. */
  async peek(tokenId: string): Promise<void> {
    const page = await firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, { params: { per_page: 1 } }),
    );
    this.outside.set({ tokenId, total: page.total });
  }

  /**
   * Chegou uma requisição com a Entrada fechada: conta no total e nas não lidas. A lista é relida
   * quando a Entrada abrir.
   */
  arrivedOutside(tokenId: string, request: WebhookRequest, total: number): void {
    this.outside.set({ tokenId, total });
    if (this.tokenId() === tokenId) {
      this.total.set(total);
    }
    this.changeUnread(tokenId, (unread) =>
      unread.includes(request.uuid) ? unread : [...unread, request.uuid],
    );
  }

  /**
   * As que chegaram depois da mais nova da URL que a tela conhece (a volta da conexão), da mais antiga para a mais
   * nova; `null` quando nenhuma tem `seq`. Com `after`, a listagem ignora `page`: o laço segue pelo maior `seq`
   * recebido até a última página.
   */
  async arrivedSinceNewest(): Promise<{ data: WebhookRequest[]; total: number } | null> {
    const tokenId = this.tokenId();
    let after = this.filtering() ? this.newestSeq : this.listedSeq;
    if (!tokenId || after === 0) {
      return null;
    }
    const data: WebhookRequest[] = [];
    for (;;) {
      const page = await firstValueFrom(
        this.http.get<RequestPage>(`/token/${tokenId}/requests`, { params: { after } }),
      );
      data.push(...page.data);
      if (page.is_last_page) {
        return { data, total: page.total };
      }
      after = Math.max(after, ...page.data.map(seqOf));
    }
  }

  /**
   * Carrega a URL, sem filtro ou com o da rota (`?signature=…&q=…`): o filtro da tela não passa
   * de uma URL para outra.
   */
  async load(tokenId: string, page = 1, filter: RequestFilter = NO_FILTER): Promise<void> {
    const generation = ++this.generation;
    const run = this.begin(tokenId);
    const first = this.opening() === tokenId || this.failure()?.kind === 'list';
    this.searching.set(false);
    this.activeFilter.set(filter);
    try {
      // A fronteira é lida antes da página: o que chegar entre as duas fica depois dela, e a volta da conexão o
      // traz. Aberta já filtrada (link com a busca), o total da URL vem da listagem sem filtro.
      const unfiltered = this.filtering() ? await this.fetchList(tokenId, 1) : null;
      const top = this.newestFirst() && (unfiltered !== null || page === 1);
      const newest = top ? null : await this.fetchNewestSeq(tokenId);
      const result = await this.fetchPage(tokenId, page);
      if (generation !== this.generation) {
        return;
      }
      this.newestSeq = newest ?? Math.max(0, ...(unfiltered ?? result).data.map(seqOf));
      this.listedSeq = this.newestSeq;
      this.tokenId.set(tokenId);
      this.opening.set(null);
      this.selection.set(undefined);
      this.goneState.set(null);
      this.unopened.set(null);
      this.pages.set([{ page: result.current_page, data: result.data }]);
      this.lastPageReached.set(result.is_last_page);
      this.countPage(result);
      if (unfiltered) {
        this.total.set(unfiltered.total);
      }
      this.failure.set(null);
    } catch (error) {
      if (generation === this.generation && first && !closed(error)) {
        this.failList(tokenId, error);
      }
      throw error;
    } finally {
      if (run === this.loads) {
        clearTimeout(this.slowTimer);
        this.slow.set(false);
        this.loading.set(false);
      }
    }
  }

  /**
   * A tela vai abrir a lista desta URL: a de outra sai da vista na hora, e o esqueleto e o aviso de
   * demora contam daqui, desde a leitura da URL, que vem antes da lista.
   */
  begin(tokenId: string): number {
    const run = ++this.loads;
    this.loading.set(true);
    clearTimeout(this.slowTimer);
    this.slow.set(false);
    this.slowTimer = setTimeout(() => this.slow.set(run === this.loads), SLOW_READ_MS);
    if (tokenId !== (this.opening() ?? this.tokenId())) {
      this.opening.set(tokenId);
      this.pages.set([]);
      this.selection.set(undefined);
      this.goneState.set(null);
      this.unopened.set(null);
      this.scan.set(null);
      this.failure.set(null);
    }
    return run;
  }

  /**
   * A primeira carga falhou: a lista fica a desta URL, em erro, com só o que chegar pelo tempo real, e a
   * retomada parte do que chegou.
   */
  private failList(tokenId: string, error: unknown): void {
    const previous = this.failure();
    if (this.requests().length === 0) {
      this.total.set(0);
    }
    this.tokenId.set(tokenId);
    this.opening.set(null);
    this.lastPageReached.set(true);
    this.newestSeq = Math.max(0, ...this.requests().map(seqOf));
    this.listedSeq = this.newestSeq;
    this.failure.set({
      kind: 'list',
      status: statusOf(error),
      attempt: previous?.kind === 'list' ? previous.attempt + 1 : 0,
    });
  }

  /** O "Try again" da busca que falhou ou demorou. */
  async retrySearch(): Promise<void> {
    const tokenId = this.tokenId();
    if (tokenId && !this.opening()) {
      await this.reapply(tokenId);
    }
  }

  /**
   * Troca o filtro e recarrega a lista a partir da primeira página; sem filtro, volta à lista
   * completa. A mensagem aberta continua aberta, mesmo fora do resultado.
   */
  async applyFilter(filter: RequestFilter): Promise<void> {
    const tokenId = this.tokenId();
    if (!tokenId || this.opening() || sameFilter(filter, this.activeFilter())) {
      return;
    }
    const previous = this.activeFilter();
    this.activeFilter.set(filter);
    this.rejected.set([]);
    this.scanLimit = SCAN_WINDOW;
    const search = this.reapply(tokenId);
    const generation = this.generation;
    try {
      await search;
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status !== 422) {
        throw error;
      }
      if (generation !== this.generation) {
        return;
      }
      const kept = new Set((previous.values ?? []).map((value) => JSON.stringify(value)));
      this.rejected.set((filter.values ?? []).filter((value) => !kept.has(JSON.stringify(value))));
      this.activeFilter.set(previous);
      await this.reapply(tokenId);
    }
  }

  async lookOlder(): Promise<void> {
    const tokenId = this.tokenId();
    if (!tokenId || this.opening() || !this.scan()) {
      return;
    }
    this.scanLimit += SCAN_WINDOW;
    await this.reapply(tokenId);
  }

  private async reapply(tokenId: string): Promise<void> {
    const generation = ++this.generation;
    this.searching.set(true);
    clearTimeout(this.searchTimer);
    this.searchSlow.set(false);
    this.searchTimer = setTimeout(
      () => this.searchSlow.set(generation === this.generation && this.searching()),
      SLOW_READ_MS,
    );
    try {
      const result = await this.fetchPage(tokenId, 1);
      if (generation !== this.generation) {
        return;
      }
      this.pages.set([{ page: result.current_page, data: result.data }]);
      this.lastPageReached.set(result.is_last_page);
      this.countPage(result);
      this.listedAll();
      this.failure.set(null);
    } catch (error) {
      // O 422 é do filtro, não do servidor: quem pediu volta ao anterior.
      if (error instanceof HttpErrorResponse && error.status === 422) {
        throw error;
      }
      if (generation === this.generation) {
        const previous = this.failure();
        this.pages.set([]);
        this.lastPageReached.set(true);
        this.failure.set({
          kind: 'search',
          status: statusOf(error),
          attempt: previous?.kind === 'search' ? previous.attempt + 1 : 0,
        });
      }
    } finally {
      if (generation === this.generation) {
        clearTimeout(this.searchTimer);
        this.searchSlow.set(false);
        this.searching.set(false);
      }
    }
  }

  /**
   * Com filtro ativo, refaz a busca das páginas carregadas (chegou mensagem nova, que pode casar
   * ou não). A mensagem aberta continua aberta, mesmo fora do resultado.
   */
  async refreshSearch(): Promise<void> {
    const tokenId = this.tokenId();
    if (!tokenId || this.opening() || !this.filtering()) {
      return;
    }
    const generation = ++this.generation;
    const loaded = this.pages().map((page) => page.page);
    // Sem resposta, a lista fica como estava; a próxima chegada busca de novo.
    const results = await Promise.all(
      (loaded.length > 0 ? loaded : [1]).map((page) => this.fetchPage(tokenId, page)),
    ).catch(() => null);
    if (!results || generation !== this.generation) {
      return;
    }
    this.searching.set(false);
    const last = results[results.length - 1];
    this.pages.set(results.map((result) => ({ page: result.current_page, data: result.data })));
    this.lastPageReached.set(last.is_last_page);
    this.matched.set(last.total);
    this.failure.set(null);
  }

  async loadPreviousPage(): Promise<void> {
    const tokenId = this.tokenId();
    const first = this.pages()[0];
    if (!tokenId || this.opening() || !first || first.page <= 1) {
      return;
    }
    const generation = this.generation;
    const result = await this.fetchPage(tokenId, first.page - 1);
    if (generation !== this.generation) {
      return;
    }
    this.pages.update((pages) => [{ page: result.current_page, data: result.data }, ...pages]);
  }

  async loadNextPage(): Promise<void> {
    const tokenId = this.tokenId();
    const last = this.pages().at(-1);
    if (!tokenId || this.opening() || !last) {
      return;
    }
    const generation = this.generation;
    const result = await this.fetchPage(tokenId, last.page + 1);
    if (generation !== this.generation) {
      return;
    }
    this.pages.update((pages) => [...pages, { page: result.current_page, data: result.data }]);
    this.lastPageReached.set(result.is_last_page);
  }

  fetchOne(tokenId: string, requestId: string): Promise<WebhookRequest> {
    return firstValueFrom(this.http.get<WebhookRequest>(`/token/${tokenId}/request/${requestId}`));
  }

  /** Página da API onde a mensagem está (vai no permalink). */
  pageOf(requestId: string): number {
    return this.pages().find((page) => page.data.some((r) => r.uuid === requestId))?.page ?? 1;
  }

  /**
   * Abre a mensagem. `read` falso quando foi a tela que a escolheu (a primeira ao abrir a URL, a que
   * substituiu a cortada): ninguém a leu ainda, e ela segue contando nas não lidas (INBOX-02).
   */
  select(requestId: string, read = true): void {
    this.unopened.set(null);
    this.selection.set({ id: requestId, request: this.find(requestId) });
    if (read) {
      this.markAsRead(requestId);
    }
  }

  /**
   * Abre pelo link permanente uma mensagem que não está nas páginas carregadas (a ordem ou as novas
   * a levaram para outra página): ela vem da API e fica aberta sem entrar na lista.
   */
  selectOutsideList(request: WebhookRequest): void {
    this.unopened.set(null);
    this.selection.set({ id: request.uuid, request });
    this.markAsRead(request.uuid);
  }

  /** Nada fica selecionado, e nenhuma outra é aberta no lugar. */
  leaveUnopened(requestId: string, reason: UnopenedRequest['reason']): void {
    this.selection.set(undefined);
    this.unopened.set({ id: requestId, reason });
  }

  noticeGone(requestId: string): void {
    const selection = this.selection();
    if (selection?.id === requestId && selection.request && !this.gone()) {
      this.markGone('unknown');
    }
  }

  /**
   * A mais antiga que ficou na URL. A limpeza automática corta as mais antigas: quando a aberta
   * fora da lista (link permanente) some, é ela a vizinha. Com a mais nova no topo e páginas por
   * carregar, vem da API.
   */
  async oldestKept(): Promise<WebhookRequest | undefined> {
    const tokenId = this.tokenId();
    if (!tokenId || !this.newestFirst()) {
      return this.requests()[0];
    }
    if (this.lastPageReached()) {
      return this.requests().at(-1);
    }
    const oldest = await firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
        params: { page: 1, sorting: 'oldest' },
      }),
    );
    return oldest.data[0];
  }

  /** Inverte a ordem e relê a primeira página, com a mensagem aberta mantida. */
  async toggleSorting(): Promise<void> {
    this.sorting.update((sorting) => (sorting === 'newest' ? 'oldest' : 'newest'));
    await this.reload();
  }

  /**
   * Mensagem nova chegando em tempo real: entra na ponta das novas (o topo, com a mais nova
   * primeiro; o fim, na ordem inversa), na ordem do `seq`, e fica como não lida; a que já está na
   * lista não entra de novo (o evento e a volta da conexão podem trazer a mesma). As que a
   * limpeza automática cortou (`removed`) saem da lista e das não lidas. Se a mensagem aberta
   * saiu, ela segue na tela como cópia, com o aviso (`gone`); nenhuma outra é aberta.
   */
  append(request: WebhookRequest, total: number, removed: readonly string[] = []): void {
    const cut = new Set(removed);
    const known = this.find(request.uuid) !== undefined;
    this.noticeCut(removed);
    this.pages.update((pages) => {
      const kept = pages.map((page) => ({
        ...page,
        data: page.data.filter((r) => !cut.has(r.uuid)),
      }));
      if (known) {
        return kept;
      }
      if (this.newestFirst()) {
        const first = kept[0] ?? { page: 1, data: [] };
        return [{ ...first, data: bySeq(first.data, request) }, ...kept.slice(1)];
      }
      const last = kept.at(-1) ?? { page: 1, data: [] };
      const data = bySeq([...last.data].reverse(), request).reverse();
      return [...kept.slice(0, -1), { ...last, data }];
    });
    if (known) {
      this.total.set(total);
      this.changeUnread(this.tokenId(), (unread) => unread.filter((id) => !cut.has(id)));
      return;
    }
    this.listedSeq = Math.max(this.listedSeq, seqOf(request));
    this.countArrival(request, total, removed);
  }

  /**
   * Mensagem nova com filtro ativo: conta no total e nas não lidas, mas só entra na lista pela
   * busca (`refreshSearch`), que diz se ela casa.
   */
  countArrival(request: WebhookRequest, total: number, removed: readonly string[] = []): void {
    const cut = new Set(removed);
    this.noticeCut(removed);
    this.total.set(total);
    this.newestSeq = Math.max(this.newestSeq, seqOf(request));
    this.changeUnread(this.tokenId(), (unread) => [
      ...unread.filter((id) => !cut.has(id) && id !== request.uuid),
      request.uuid,
    ]);
  }

  /**
   * Busca de novo a primeira página, mantendo a mensagem aberta: depois de reduzir a limpeza
   * automática no `PUT`, que corta sem gerar evento. Com filtro, o total da URL vem da listagem
   * sem filtro.
   */
  async reload(): Promise<void> {
    const tokenId = this.tokenId();
    if (!tokenId || this.opening()) {
      return;
    }
    const generation = ++this.generation;
    const result = await this.fetchPage(tokenId, 1);
    const total = this.filtering() ? (await this.fetchList(tokenId, 1)).total : result.total;
    if (generation !== this.generation) {
      return;
    }
    this.searching.set(false);
    this.pages.set([{ page: result.current_page, data: result.data }]);
    this.lastPageReached.set(result.is_last_page);
    this.total.set(total);
    this.countPage(result);
    this.listedAll();
    this.failure.set(null);
  }

  /**
   * Tira a mensagem da lista na hora. Com `undo` (o "Undo" do aviso), só apaga no servidor se ele
   * resolver `false`; com `true`, nada é apagado e a mensagem volta ao mesmo lugar, se a lista ainda
   * é a de quando ela saiu (`kept`: a tela está em outra URL, e ela fica só no servidor).
   */
  async deleteRequest(
    request: WebhookRequest,
    undo?: Promise<boolean>,
  ): Promise<'deleted' | 'restored' | 'kept'> {
    const generation = this.generation;
    const pageIndex = this.pages().findIndex((page) =>
      page.data.some((r) => r.uuid === request.uuid),
    );
    const position = this.pages()[pageIndex]?.data.findIndex((r) => r.uuid === request.uuid) ?? -1;
    const listed = pageIndex >= 0;
    const counted = listed && this.filtering();
    // A aberta: a cópia fica na tela, com o aviso de que foi esta aba que a apagou.
    const open = this.selection()?.id === request.uuid;
    if (open) {
      this.selection.set({ id: request.uuid, request });
      this.markGone('deleted');
    }
    this.pages.update((pages) =>
      pages.map((page) => ({ ...page, data: page.data.filter((r) => r.uuid !== request.uuid) })),
    );
    this.total.update((total) => total - 1);
    if (counted) {
      this.matched.update((matched) => matched - 1);
    }
    this.markAsRead(request.uuid);
    if (undo && (await undo)) {
      if ((this.opening() ?? this.tokenId()) !== request.token_id) {
        return 'kept';
      }
      if (this.goneState()?.id === request.uuid) {
        this.goneState.set(null);
      }
      // Relida depois do apagar, a lista já a trouxe de volta: o DELETE ainda não tinha saído.
      if (generation !== this.generation) {
        return 'restored';
      }
      this.pages.update((pages) =>
        pages.map((page, index) =>
          index === pageIndex
            ? {
                ...page,
                data: [...page.data.slice(0, position), request, ...page.data.slice(position)],
              }
            : page,
        ),
      );
      this.total.update((total) => total + 1);
      if (counted) {
        this.matched.update((matched) => matched + 1);
      }
      return 'restored';
    }
    await firstValueFrom(this.http.delete(`/token/${request.token_id}/request/${request.uuid}`));
    return 'deleted';
  }

  /** Posição do que está carregado, para o rodapé "1–50 of N" (N com filtro é o que casa). */
  readonly range = computed(() => {
    const count = this.requests().length;
    const first = this.pages()[0]?.page ?? 1;
    const from = count === 0 ? 0 : (first - 1) * REQUESTS_PER_PAGE + 1;
    return {
      from,
      to: count === 0 ? 0 : from + count - 1,
      of: this.filtering() ? this.matched() : this.total(),
    };
  });

  async deleteAll(): Promise<void> {
    const tokenId = this.tokenId();
    // A aberta segue na tela como cópia, com o aviso.
    const open = this.selected();
    if (open) {
      this.selection.set({ id: open.uuid, request: open });
      this.markGone('deleted');
    }
    this.pages.set([]);
    this.lastPageReached.set(true);
    this.total.set(0);
    this.matched.set(0);
    if (tokenId) {
      this.resetUnread(tokenId);
      await firstValueFrom(this.http.delete(`/token/${tokenId}/request`));
    }
  }

  /** Não lidas de uma URL; lê o signal, então serve num `computed`. */
  unreadOf(tokenId: string | null): readonly string[] {
    return tokenId ? (this.preferences.unread()[tokenId] ?? []) : [];
  }

  resetUnread(tokenId: string): void {
    this.changeUnread(tokenId, () => []);
  }

  /** A URL sem não lidas sai do mapa: o localStorage não guarda URL vazia. */
  private changeUnread(
    tokenId: string | null,
    change: (unread: readonly string[]) => readonly string[],
  ): void {
    if (!tokenId) {
      return;
    }
    this.preferences.unread.update(({ [tokenId]: current = [], ...others }) => {
      const next = change(current);
      return next.length > 0 ? { ...others, [tokenId]: next } : others;
    });
  }

  private noticeCut(removed: readonly string[]): void {
    const selection = this.selection();
    if (selection && removed.includes(selection.id) && this.goneState()?.id !== selection.id) {
      this.selection.set({ id: selection.id, request: this.selected() });
      this.markGone('cleanup');
    }
  }

  private markGone(cause: GoneRequest['cause']): void {
    const id = this.selection()?.id;
    if (id) {
      this.goneState.set({ id, cause, at: new Date(), index: this.selectedIndex() });
    }
  }

  private find(requestId: string): WebhookRequest | undefined {
    return this.requests().find((request) => request.uuid === requestId);
  }

  private markAsRead(requestId: string): void {
    this.changeUnread(this.tokenId(), (unread) => unread.filter((id) => id !== requestId));
  }

  /** A lista sem filtro acabou de ser lida: tem tudo o que a tela sabe que existe. */
  private listedAll(): void {
    if (!this.filtering()) {
      this.listedSeq = this.newestSeq;
    }
  }

  /** O `total` da página é o da URL sem filtro, ou o de mensagens que casam com ele. */
  private countPage(result: RequestPage): void {
    if (this.filtering()) {
      this.matched.set(result.total);
    } else {
      this.total.set(result.total);
      this.matched.set(0);
    }
  }

  /** Página da lista: pela busca com filtro ativo, pela listagem sem ele. */
  private fetchPage(tokenId: string, page: number): Promise<RequestPage> {
    const { answered, window: span } = this.activeFilter();
    if (answered?.length || span) {
      return this.scanInBrowser(tokenId, this.generation);
    }
    this.scan.set(null);
    if (!this.filtering()) {
      return this.fetchList(tokenId, page);
    }
    return firstValueFrom(
      this.http.post<RequestPage>(
        `/token/${tokenId}/requests/search`,
        searchBody(this.activeFilter(), page, this.sorting()),
      ),
    );
  }

  /**
   * O status respondido e a janela das mais novas, no navegador: pede as mais novas em páginas de
   * 100 (pela busca, com os outros filtros; pela listagem, sem eles) até o teto, e devolve as que
   * casam numa página só. Com a janela e filtro do servidor, o resultado da busca fica só com as que
   * estão entre as n mais novas da URL.
   */
  private async scanInBrowser(tokenId: string, generation: number): Promise<RequestPage> {
    const filter = this.activeFilter();
    const span = filter.window ?? null;
    const limit = span ?? this.scanLimit;
    const others = { ...filter, answered: null, window: null };
    const listed = (page: number) =>
      firstValueFrom(
        this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
          params: { page, per_page: SCAN_PAGE, sorting: 'newest' },
        }),
      );
    const searched = (page: number) =>
      firstValueFrom(
        this.http.post<RequestPage>(`/token/${tokenId}/requests/search`, {
          ...searchBody(others, page, 'newest'),
          per_page: SCAN_PAGE,
        }),
      );
    const byServer = isFilterActive(others);
    const found = await this.newestUpTo(byServer ? searched : listed, limit, generation);
    let [scanned, looked, total] = [found.data, found.data.length, found.total];
    if (span !== null && byServer) {
      const kept = await this.newestUpTo(listed, span, generation);
      const inWindow = new Set(kept.data.map((request) => request.uuid));
      scanned = scanned.filter((request) => inWindow.has(request.uuid));
      [looked, total] = [kept.data.length, kept.total];
    }
    const answered = filter.answered ?? [];
    const matches = answered.length
      ? scanned.filter((request) => answeredMatches(request, answered))
      : scanned;
    if (generation === this.generation) {
      this.scan.set({
        scanned: looked,
        total,
        done: true,
        ...(span !== null && { window: total > span ? span : null }),
      });
    }
    return {
      data: this.newestFirst() ? matches : [...matches].reverse(),
      total: matches.length,
      per_page: SCAN_PAGE,
      current_page: 1,
      is_last_page: true,
      from: 1,
      to: matches.length,
    };
  }

  private async newestUpTo(
    fetch: (page: number) => Promise<RequestPage>,
    limit: number,
    generation: number,
  ): Promise<{ data: RequestPage['data']; total: number }> {
    const first = await fetch(1);
    const pages = Math.ceil(Math.min(first.total, limit) / SCAN_PAGE);
    if (generation === this.generation) {
      this.scan.set({ scanned: first.data.length, total: first.total, done: pages <= 1 });
    }
    const rest = await Promise.all(
      Array.from({ length: Math.max(pages - 1, 0) }, (_, i) => fetch(i + 2)),
    );
    return {
      data: [first, ...rest].flatMap((page) => page.data).slice(0, limit),
      total: first.total,
    };
  }

  /** Para a trilha de um evento que o filtro pega só em parte vir inteira. */
  unfilteredPage(tokenId: string): Promise<RequestPage> {
    return this.fetchList(tokenId, 1);
  }

  private fetchList(tokenId: string, page: number): Promise<RequestPage> {
    return firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
        params: { page, sorting: this.sorting() },
      }),
    );
  }

  private async fetchNewestSeq(tokenId: string): Promise<number> {
    const newest = await firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
        params: { per_page: 1, sorting: 'newest' },
      }),
    );
    return Math.max(0, ...newest.data.map(seqOf));
  }
}

const seqOf = (request: WebhookRequest): number => request.seq ?? 0;

const statusOf = (error: unknown): number =>
  error instanceof HttpErrorResponse ? error.status : 0;

/** URL trancada (401) ou que não existe (404, 410): quem mostra é o shell, e não a lista. */
const closed = (error: unknown): boolean => [401, 404, 410].includes(statusOf(error));

/** Põe a mensagem na lista da mais nova para a mais antiga pelo `seq`; sem `seq`, no topo. */
function bySeq(newestFirst: readonly WebhookRequest[], request: WebhookRequest): WebhookRequest[] {
  const at =
    request.seq === undefined ? 0 : newestFirst.findIndex((r) => seqOf(r) < seqOf(request));
  const index = at < 0 ? newestFirst.length : at;
  return [...newestFirst.slice(0, index), request, ...newestFirst.slice(index)];
}

/** `GET /token/{id}/request/{rid}` e o que vem embaixo dele (o trace, o raw). */
const REQUEST_CALL = /^\/token\/[^/?]+\/request\/([^/?]+)([/?].*)?$/;

/** Qualquer `GET` da requisição aberta que responde 404 diz que ela sumiu do servidor. */
export const requestGoneInterceptor: HttpInterceptorFn = (request, next) => {
  const requestId = request.method === 'GET' ? REQUEST_CALL.exec(request.url)?.[1] : undefined;
  if (!requestId) {
    return next(request);
  }
  const store = inject(RequestStore);
  return next(request).pipe(
    tap({
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          store.noticeGone(decodeURIComponent(requestId));
        }
      },
    }),
  );
};
