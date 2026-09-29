import { Component, computed, input, output, viewChild } from '@angular/core';
import { WebhookRequest } from '../requests/webhook-request';
import { Icon } from '../ui/icon';
import { FirstGuide } from './first-guide';
import { RetryGuide } from './retry-guide';

export type GuideName = 'first' | 'retry';

/**
 * Um roteiro (R1): a folha `region "Guide: {nome}"`, que a Entrada põe no lugar do detalhe quando
 * o endereço tem `?guide=first` ou `?guide=retry`. Todos os passos ficam à vista, nenhum bloqueia
 * o outro, e fechar não desfaz o que foi criado. Carregado sob demanda (`import('../guides/guide')`).
 */
@Component({
  selector: 'app-guide',
  imports: [FirstGuide, Icon, RetryGuide],
  template: `
    <section class="guide" [attr.aria-label]="label()">
      <header class="top">
        <h2>{{ title() }}</h2>
        <button
          type="button"
          class="close"
          aria-label="Close guide"
          i18n-aria-label
          (click)="closed.emit()"
        >
          <app-icon name="close" [size]="20" />
        </button>
      </header>
      @if (name() === 'retry') {
        <app-retry-guide [tokenId]="tokenId()" />
      } @else {
        <app-first-guide [tokenId]="tokenId()" (openRequest)="openRequest.emit($event)" />
      }
    </section>
  `,
  styleUrl: './guide.scss',
})
export class Guide {
  readonly name = input.required<GuideName>();
  readonly tokenId = input.required<string>();
  /** "Close guide": quem hospeda tira o `?guide=` do endereço e devolve o detalhe. */
  readonly closed = output<void>();
  /** "Open it": a requisição a abrir no detalhe. */
  readonly openRequest = output<WebhookRequest>();

  protected readonly title = computed(() =>
    this.name() === 'retry' ? $localize`Test a retry` : $localize`First webhook`,
  );
  protected readonly label = computed(() => $localize`Guide: ${this.title()}:name:`);

  private readonly retry = viewChild(RetryGuide);

  /** A chegada é da conferência do retry, que a anuncia. */
  claims(request: WebhookRequest): boolean {
    return this.retry()?.claims(request) ?? false;
  }
}
