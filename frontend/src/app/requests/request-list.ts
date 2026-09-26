import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import { Component, computed, inject, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { CompareStore } from '../diff/compare-store';
import { localDate } from '../request-detail/dates';
import { RequestSearch } from '../search/request-search';
import { TokenStore } from '../token/token-store';
import { MethodLabel } from './method-label';
import { RequestStore } from './request-store';
import { WebhookRequest } from './webhook-request';

/**
 * Lista lateral: mensagens da URL, busca e filtros, paginação, não lidas e apagar uma. No
 * "Compare with…", clicar escolhe a mensagem B em vez de abrir.
 */
@Component({
  selector: 'app-request-list',
  imports: [
    CdkVirtualScrollViewport,
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    MatButton,
    MatProgressSpinner,
    MethodLabel,
    RequestSearch,
  ],
  templateUrl: './request-list.html',
  styleUrl: './request-list.scss',
})
export class RequestList {
  protected readonly store = inject(RequestStore);
  protected readonly compare = inject(CompareStore);
  private readonly tokens = inject(TokenStore);

  readonly openRequest = output<WebhookRequest>();
  protected readonly localDate = localDate;

  /** Limite da limpeza automática da URL aberta, mostrado ao lado do total. */
  protected readonly limit = computed(() => this.tokens.token()?.auto_cleanup ?? null);
  protected readonly count = computed(() => {
    const limit = this.limit();
    return limit === null ? `${this.store.total()}` : `${this.store.total()} / ${limit}`;
  });
  /** Consulta por linha desenhada: com milhares de não lidas, `includes` na lista pesaria. */
  private readonly unreadIds = computed(() => new Set(this.store.unread()));

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

  protected deleteRequest(request: WebhookRequest): void {
    void this.store.deleteRequest(request);
  }

  protected trackByUuid(_index: number, request: WebhookRequest): string {
    return request.uuid;
  }
}
