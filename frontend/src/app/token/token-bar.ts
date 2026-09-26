import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { Component, Injector, computed, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatToolbar } from '@angular/material/toolbar';
import { Router, RouterLink } from '@angular/router';
import type { TokenActions } from './token-actions';
import { TokenStore } from './token-store';

/**
 * Barra superior: marca, links, alternância "Requests"/"Rules" da URL aberta, URL do webhook
 * com copiar, editar e criar URL.
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

  /** Aba ativa pela rota: `/{token}/rules` é a de regras; o resto (lista, mensagem) é "Requests". */
  protected readonly onRules = computed(() => {
    const url = this.router.lastSuccessfulNavigation()?.finalUrl;
    return !!url && url.root.children['primary']?.segments[1]?.path === 'rules';
  });

  protected async createUrl(): Promise<void> {
    await (await this.actions()).createUrl();
  }

  protected async editUrl(): Promise<void> {
    await (await this.actions()).editUrl();
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  private async actions(): Promise<TokenActions> {
    const { TokenActions } = await import('./token-actions');
    return this.injector.get(TokenActions);
  }
}
