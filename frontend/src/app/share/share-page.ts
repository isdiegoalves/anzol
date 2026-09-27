import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { apiDate } from '../outbound/outbound';
import { fromNow, localDate } from '../request-detail/dates';
import { RequestView } from '../request-detail/request-view';
import { SharedRequest } from './share';
import { ShareStore } from './share-store';

type ShareState =
  | { kind: 'loading' }
  | { kind: 'loaded'; request: SharedRequest }
  | { kind: 'missing' }
  | { kind: 'failed'; status: number | string };

/**
 * Página do link só-leitura (`/#/share/{id}`): a mensagem na visualização do detalhe, sem nenhuma
 * ação que escreva e sem nada da URL de origem. Não exige o segredo da URL.
 */
@Component({
  selector: 'app-share-page',
  imports: [RequestView],
  templateUrl: './share-page.html',
  styleUrl: './share-page.scss',
})
export class SharePage {
  private readonly store = inject(ShareStore);

  /** Parâmetro da rota (`withComponentInputBinding`). */
  readonly shareId = input.required<string>();

  protected readonly state = signal<ShareState>({ kind: 'loading' });

  constructor() {
    effect(() => {
      const shareId = this.shareId();
      untracked(() => void this.open(shareId));
    });
  }

  /** "Oct 3, 2026 9:43 PM (in 7 days)": a validade em hora local e o quanto falta. */
  protected expires(request: SharedRequest): string {
    const at = apiDate(request.expires_at);
    return `${localDate(at)} (${fromNow(at)})`;
  }

  private async open(shareId: string): Promise<void> {
    this.state.set({ kind: 'loading' });
    try {
      this.state.set({ kind: 'loaded', request: await this.store.read(shareId) });
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
      this.state.set(status === 404 ? { kind: 'missing' } : { kind: 'failed', status });
    }
  }
}
