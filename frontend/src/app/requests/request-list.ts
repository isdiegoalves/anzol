import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import { Component, inject, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { localDate } from '../request-detail/dates';
import { MethodLabel } from './method-label';
import { RequestStore } from './request-store';
import { WebhookRequest } from './webhook-request';

/** Lista lateral: mensagens da URL, paginação, não lidas e apagar uma. */
@Component({
  selector: 'app-request-list',
  imports: [
    CdkVirtualScrollViewport,
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    MatButton,
    MatProgressSpinner,
    MethodLabel,
  ],
  templateUrl: './request-list.html',
  styleUrl: './request-list.scss',
})
export class RequestList {
  protected readonly store = inject(RequestStore);

  readonly openRequest = output<WebhookRequest>();
  protected readonly localDate = localDate;

  protected isUnread(request: WebhookRequest): boolean {
    return this.store.unread().includes(request.uuid);
  }

  protected deleteRequest(request: WebhookRequest): void {
    void this.store.deleteRequest(request);
  }

  protected trackByUuid(_index: number, request: WebhookRequest): string {
    return request.uuid;
  }
}
