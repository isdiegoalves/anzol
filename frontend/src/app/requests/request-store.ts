import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Preferences } from '../settings/preferences';
import { RequestPage, WebhookRequest } from './webhook-request';

/** Uma página da API já carregada na lista lateral. */
interface LoadedPage {
  page: number;
  data: WebhookRequest[];
}

/** Mensagens da URL aberta: páginas carregadas, mensagem aberta e não lidas. */
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

  /** Token cuja lista está carregada. */
  readonly tokenId = signal<string | null>(null);
  readonly total = signal(0);
  readonly unread = this.preferences.unread.asReadonly();

  readonly requests = computed(() => this.pages().flatMap((page) => page.data));
  readonly hasRequests = computed(() => this.requests().length > 0);
  readonly hasPreviousPage = computed(() => (this.pages()[0]?.page ?? 1) > 1);
  readonly hasNextPage = computed(() => this.hasRequests() && !this.lastPageReached());

  /**
   * Mensagem aberta, derivada da rota (id) e da lista. Apagar a mensagem aberta não fecha o
   * detalhe (como no app atual): sem ela na lista, fica o objeto guardado ao abrir.
   */
  readonly selected = computed(() => {
    const selection = this.selection();
    return selection && (this.find(selection.id) ?? selection.request);
  });

  readonly selectedIndex = computed(() => {
    const selected = this.selected();
    return selected ? this.requests().indexOf(selected) : -1;
  });

  async load(tokenId: string, page = 1): Promise<void> {
    const result = await this.fetchPage(tokenId, page);
    this.tokenId.set(tokenId);
    this.selection.set(undefined);
    this.pages.set([{ page: result.current_page, data: result.data }]);
    this.lastPageReached.set(result.is_last_page);
    this.total.set(result.total);
  }

  async loadPreviousPage(): Promise<void> {
    const tokenId = this.tokenId();
    const first = this.pages()[0];
    if (!tokenId || !first || first.page <= 1) {
      return;
    }
    const result = await this.fetchPage(tokenId, first.page - 1);
    this.pages.update((pages) => [{ page: result.current_page, data: result.data }, ...pages]);
  }

  async loadNextPage(): Promise<void> {
    const tokenId = this.tokenId();
    const last = this.pages().at(-1);
    if (!tokenId || !last) {
      return;
    }
    const result = await this.fetchPage(tokenId, last.page + 1);
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

  select(requestId: string): void {
    this.selection.set({ id: requestId, request: this.find(requestId) });
    this.markAsRead(requestId);
  }

  /**
   * Mensagem nova chegando em tempo real: entra no fim da lista e fica como não lida. As que a
   * limpeza automática cortou (`removed`) saem da lista e das não lidas. Se a mensagem aberta
   * saiu, devolve a mais próxima que ficou, para a tela abri-la.
   */
  append(
    request: WebhookRequest,
    total: number,
    removed: readonly string[] = [],
  ): WebhookRequest | undefined {
    const before = this.requests();
    const cut = new Set(removed);
    this.pages.update((pages) => {
      const kept = pages.map((page) => ({
        ...page,
        data: page.data.filter((r) => !cut.has(r.uuid)),
      }));
      const last = kept.at(-1) ?? { page: 1, data: [] };
      return [...kept.slice(0, -1), { ...last, data: [...last.data, request] }];
    });
    this.total.set(total);
    this.preferences.unread.update((unread) => [
      ...unread.filter((id) => !cut.has(id)),
      request.uuid,
    ]);
    return this.nearestToSelected(before);
  }

  /**
   * Busca de novo a primeira página, mantendo a mensagem aberta: depois de reduzir a limpeza
   * automática no `PUT`, que corta sem gerar evento. Se a aberta foi cortada, devolve a mais
   * próxima que ficou.
   */
  async reload(): Promise<WebhookRequest | undefined> {
    const tokenId = this.tokenId();
    if (!tokenId) {
      return undefined;
    }
    const before = this.requests();
    const result = await this.fetchPage(tokenId, 1);
    this.pages.set([{ page: result.current_page, data: result.data }]);
    this.lastPageReached.set(result.is_last_page);
    this.total.set(result.total);
    return this.nearestToSelected(before);
  }

  async deleteRequest(request: WebhookRequest): Promise<void> {
    this.pages.update((pages) =>
      pages.map((page) => ({ ...page, data: page.data.filter((r) => r.uuid !== request.uuid) })),
    );
    this.total.update((total) => total - 1);
    this.markAsRead(request.uuid);
    await firstValueFrom(this.http.delete(`/token/${request.token_id}/request/${request.uuid}`));
  }

  async deleteAll(): Promise<void> {
    const tokenId = this.tokenId();
    this.pages.set([]);
    this.lastPageReached.set(true);
    this.total.set(0);
    this.selection.set(undefined);
    this.resetUnread();
    if (tokenId) {
      await firstValueFrom(this.http.delete(`/token/${tokenId}/request`));
    }
  }

  resetUnread(): void {
    this.preferences.unread.set([]);
  }

  /**
   * Com a mensagem aberta fora da lista atual, a mais próxima dela na lista anterior que ficou:
   * primeiro as seguintes (a limpeza corta as mais antigas), depois as anteriores; sem nenhuma,
   * a primeira da lista.
   */
  private nearestToSelected(before: readonly WebhookRequest[]): WebhookRequest | undefined {
    const id = this.selection()?.id;
    const after = this.requests();
    const kept = new Set(after.map((request) => request.uuid));
    const index = before.findIndex((request) => request.uuid === id);
    if (index < 0 || kept.has(before[index].uuid)) {
      return undefined;
    }
    const around = [...before.slice(index + 1), ...before.slice(0, index).reverse()];
    return around.find((request) => kept.has(request.uuid)) ?? after[0];
  }

  private find(requestId: string): WebhookRequest | undefined {
    return this.requests().find((request) => request.uuid === requestId);
  }

  private markAsRead(requestId: string): void {
    this.preferences.unread.update((unread) => unread.filter((id) => id !== requestId));
  }

  private fetchPage(tokenId: string, page: number): Promise<RequestPage> {
    return firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, { params: { page } }),
    );
  }
}
