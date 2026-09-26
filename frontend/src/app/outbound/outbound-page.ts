import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MethodLabel } from '../requests/method-label';
import { fromNow, localDate } from '../request-detail/dates';
import { TokenStore } from '../token/token-store';
import { apiDate, outboundErrorText } from './outbound';
import { OutboundActions } from './outbound-actions';
import { OutboundResultView } from './outbound-result-view';
import { OutboundStore } from './outbound-store';

/**
 * Aba "Outbound" (`/#/{tokenId}/outbound`): as últimas respostas de replay e send da URL, mais
 * nova primeiro, e o detalhe da escolhida com os headers enviados e recebidos e o corpo.
 */
@Component({
  selector: 'app-outbound-page',
  imports: [MatButton, MethodLabel, OutboundResultView],
  templateUrl: './outbound-page.html',
  styleUrl: './outbound-page.scss',
})
export class OutboundPage {
  protected readonly store = inject(OutboundStore);
  private readonly tokens = inject(TokenStore);
  private readonly actions = inject(OutboundActions);

  /** Parâmetro da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();

  protected readonly loaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  private readonly selectedId = signal<string | null>(null);
  /** A escolhida, ou a mais nova (a que acabou de sair aparece aberta). */
  protected readonly selected = computed(() => {
    const history = this.store.history();
    return history.find((item) => item.id === this.selectedId()) ?? history.at(0) ?? null;
  });

  protected readonly when = (at: string) => fromNow(apiDate(at));
  protected readonly date = (at: string) => localDate(apiDate(at));
  protected readonly errorTitle = outboundErrorText;

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => void this.open(tokenId));
    });
  }

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected async refresh(): Promise<void> {
    await this.open(this.tokenId());
  }

  protected sendRequest(): void {
    this.actions.send();
  }

  private async open(tokenId: string): Promise<void> {
    this.loaded.set(false);
    this.loadError.set(null);
    if (this.tokens.token()?.uuid !== tokenId) {
      // Link direto para o histórico de outra URL: a barra superior passa a mostrar esta.
      this.tokens.load(tokenId).catch(() => undefined);
    }
    try {
      await this.store.load(tokenId);
      this.loaded.set(true);
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
      this.loadError.set(
        status === 404 || status === 410
          ? `This URL no longer exists (${status}).`
          : `Could not load the outbound history (${status}).`,
      );
    }
  }
}
