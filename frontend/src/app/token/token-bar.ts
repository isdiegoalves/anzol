import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { Component, Injector, computed, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatToolbar } from '@angular/material/toolbar';
import { Router, RouterLink } from '@angular/router';
import type { TokenActions } from './token-actions';
import { TokenStore } from './token-store';

/**
 * Barra superior: marca, links, abas "Requests"/"Rules"/"Outbound" da URL aberta, URL do webhook
 * com enviar, copiar, editar e criar URL.
 */
@Component({
  selector: 'app-token-bar',
  imports: [MatToolbar, MatButton, RouterLink, CdkCopyToClipboard],
  templateUrl: './token-bar.html',
  styleUrl: './token-bar.scss',
})
export class TokenBar {
  protected readonly tokens = inject(TokenStore);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);

  /**
   * Aba ativa pela rota: `/{token}/rules` e `/{token}/outbound` são as delas; o resto (lista,
   * mensagem) é "Requests".
   */
  protected readonly view = computed(() => {
    const url = this.router.lastSuccessfulNavigation()?.finalUrl;
    const tab = url?.root.children['primary']?.segments[1]?.path;
    return tab === 'rules' || tab === 'outbound' ? tab : 'requests';
  });

  protected async createUrl(): Promise<void> {
    await (await this.actions()).createUrl();
  }

  protected async editUrl(): Promise<void> {
    await (await this.actions()).editUrl();
  }

  /** O diálogo Send vem sob demanda (no pedaço do `outbound-actions`). */
  protected async sendRequest(): Promise<void> {
    const { OutboundActions } = await import('../outbound/outbound-actions');
    this.injector.get(OutboundActions).send();
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  private async actions(): Promise<TokenActions> {
    const { TokenActions } = await import('./token-actions');
    return this.injector.get(TokenActions);
  }
}
