import { Component, ViewContainerRef, computed, effect, inject, viewChild } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { TokenBar } from './token/token-bar';
import { UrlLock } from './token/url-lock';

@Component({
  imports: [RouterOutlet, TokenBar],
  selector: 'app-root',
  styleUrl: './app.scss',
  template: `
    <app-token-bar />
    <ng-container #unlockHost />
    @if (!locked()) {
      <router-outlet />
    }
  `,
})
export class App {
  private readonly router = inject(Router);
  private readonly urlLock = inject(UrlLock);
  private readonly unlockHost = viewChild.required('unlockHost', { read: ViewContainerRef });

  /**
   * URL protegida sem acesso, enquanto a rota for dela. A página da rota sai (o SSE fecha junto) e
   * volta do zero ao destrancar; navegar para outra URL também a traz de volta.
   */
  protected readonly locked = computed(() => {
    const tokenId = this.urlLock.tokenId();
    const route = this.router.lastSuccessfulNavigation()?.finalUrl;
    return tokenId !== null && route?.root.children['primary']?.segments[0]?.path === tokenId
      ? tokenId
      : null;
  });

  constructor() {
    // A tela de desbloqueio vem sob demanda: quem nunca abre uma URL protegida não a baixa.
    effect(async () => {
      const tokenId = this.locked();
      const host = this.unlockHost();
      host.clear();
      if (tokenId) {
        const { UnlockScreen } = await import('./token/unlock-screen');
        if (this.locked() === tokenId && host.length === 0) {
          host.createComponent(UnlockScreen).setInput('tokenId', tokenId);
        }
      }
    });
  }
}
