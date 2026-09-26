import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { Component, Injector, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatToolbar } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import type { TokenActions } from './token-actions';
import { TokenStore } from './token-store';

/** Barra superior: marca, links, URL do webhook com copiar, editar e criar URL. */
@Component({
  selector: 'app-token-bar',
  imports: [MatToolbar, MatButton, RouterLink, CdkCopyToClipboard],
  templateUrl: './token-bar.html',
  styleUrl: './token-bar.scss',
})
export class TokenBar {
  protected readonly tokens = inject(TokenStore);
  private readonly injector = inject(Injector);

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
