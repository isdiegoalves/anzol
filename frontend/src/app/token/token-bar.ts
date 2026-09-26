import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { Component, Injector, computed, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import type { TokenActions } from './token-actions';
import { TokenStore } from './token-store';

/**
 * Barra superior: marca, links, abas "Requests"/"Rules"/"Outbound" da URL aberta, URL do webhook
 * com enviar, copiar, editar, trancar (URL protegida) e criar URL. Na página de um link
 * compartilhado fica só a marca: quem abre o link só lê.
 *
 * Um `<header>` com SCSS, sem `MatToolbar`: a barra está no pacote inicial e o orçamento dele não
 * comporta o Material além do botão (docs/padroes-angular.md §7).
 */
@Component({
  selector: 'app-token-bar',
  imports: [MatButton, RouterLink, CdkCopyToClipboard],
  templateUrl: './token-bar.html',
  styleUrl: './token-bar.scss',
})
export class TokenBar {
  protected readonly tokens = inject(TokenStore);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);

  private readonly segments = computed(
    () =>
      this.router.lastSuccessfulNavigation()?.finalUrl?.root.children['primary']?.segments ?? [],
  );

  /**
   * Aba ativa pela rota: `/{token}/rules` e `/{token}/outbound` são as delas; o resto (lista,
   * mensagem) é "Requests".
   */
  protected readonly view = computed(() => {
    const tab = this.segments()[1]?.path;
    return tab === 'rules' || tab === 'outbound' ? tab : 'requests';
  });

  /** `/share/{id}`: página só-leitura de um link compartilhado. */
  protected readonly sharing = computed(() => this.segments()[0]?.path === 'share');

  /** "Lock" só com a URL protegida aberta: a tela só tem o token depois de ter acesso a ele. */
  protected readonly lockable = computed(() => this.tokens.token()?.protected === true);

  protected async lockUrl(): Promise<void> {
    await (await this.actions()).lockUrl();
  }

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
