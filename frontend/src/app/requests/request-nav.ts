import { Component, computed, inject, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RequestStore } from './request-store';
import { WebhookRequest } from './webhook-request';

/** Primeira / anterior / próxima / última mensagem da lista carregada. */
@Component({
  selector: 'app-request-nav',
  imports: [MatButton],
  template: `
    <nav class="nav" aria-label="Request navigation">
      <button mat-button type="button" [disabled]="isFirst()" (click)="goTo(0)">First</button>
      <button mat-button type="button" [disabled]="isFirst()" (click)="goTo(index() - 1)">
        &larr; Previous
      </button>
      <button mat-button type="button" [disabled]="isLast()" (click)="goToNext()">
        Next &rarr;
      </button>
      <button mat-button type="button" [disabled]="isLast()" (click)="goTo(count() - 1)">
        Last
      </button>
    </nav>
  `,
})
export class RequestNav {
  private readonly store = inject(RequestStore);

  readonly openRequest = output<WebhookRequest>();

  protected readonly index = this.store.selectedIndex;
  protected readonly count = computed(() => this.store.requests().length);
  protected readonly isFirst = computed(() => this.index() <= 0);
  protected readonly isLast = computed(() => this.index() === this.count() - 1);

  protected goTo(index: number): void {
    const request = this.store.requests()[index];
    if (request) {
      this.openRequest.emit(request);
    }
  }

  /** Como no app atual: ao chegar na última da lista, carrega a próxima página. */
  protected goToNext(): void {
    const next = this.index() + 1;
    this.goTo(next);
    if (next === this.count() - 1 && this.store.hasNextPage()) {
      void this.store.loadNextPage();
    }
  }
}
