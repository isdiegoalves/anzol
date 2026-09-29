import { formatDate } from '@angular/common';
import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { UnopenedRequest } from '../requests/request-store';
import { parseUtc } from './dates';

/**
 * O detalhe quando o link pede uma requisição que não abriu. Não existe (404): o estado vazio diz
 * qual era, de quando e que **nenhuma outra foi aberta no lugar**. O servidor não respondeu: não é
 * "não existe", e a tela oferece tentar de novo.
 */
@Component({
  selector: 'app-request-unopened',
  template: `
    @if (unopened().reason === 'missing') {
      <h2 class="title" tabindex="-1" i18n>This request no longer exists.</h2>
      <p class="which">
        <code>#{{ id5() }}</code>
        @if (received(); as date) {
          <span> · {{ date }}</span>
        }
      </p>
      <p i18n>It may have been deleted or cut by auto cleanup.</p>
      <p i18n>No other request was opened in its place.</p>
      <div class="actions">
        @if (hasNewest()) {
          <button type="button" class="primary" (click)="newest.emit()">
            <span i18n>Open the newest request</span>
          </button>
        }
        <button type="button" class="tonal" (click)="searchId.emit()">
          <span i18n>Search for this id</span>
        </button>
        @if (event(); as value) {
          <button type="button" class="tonal" (click)="openEvent.emit(value)">
            <span i18n>Open the event</span>
          </button>
        }
      </div>
    } @else {
      <h2 class="title" tabindex="-1">
        <span i18n>Could not load this request. The server did not answer.</span>
      </h2>
      <p class="which">
        <code>#{{ id5() }}</code>
      </p>
      <div class="actions">
        <button type="button" class="primary" (click)="again.emit()">
          <span i18n>Try again</span>
        </button>
      </div>
    }
  `,
  styleUrl: './request-unopened.scss',
})
export class RequestUnopened {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly unopened = input.required<UnopenedRequest>();
  readonly at = input<string | null>(null);
  readonly hasNewest = input(false);
  readonly event = input<string | null>(null);

  readonly newest = output<void>();
  readonly searchId = output<void>();
  readonly again = output<void>();
  readonly openEvent = output<string>();

  protected readonly id5 = computed(() => this.unopened().id.slice(0, 5));
  protected readonly received = computed(() => {
    const at = this.at();
    const date = at ? parseUtc(at) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return null;
    }
    const language = document.documentElement.lang || 'en';
    const when =
      language === 'en'
        ? formatDate(date, 'MMM d, HH:mm', 'en-US')
        : new Intl.DateTimeFormat(language, {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(date);
    return $localize`It was received on ${when}:date:.`;
  });

  constructor() {
    // Sem região viva: a tela acabou de carregar, e o foco no título diz o que houve.
    afterNextRender(() => this.host.querySelector<HTMLElement>('.title')?.focus());
  }
}
