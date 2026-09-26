import { Component, effect, inject, input, untracked } from '@angular/core';
import { TokenStore } from '../token/token-store';
import { EmptyState } from '../ui/empty-state';

/**
 * Compare por rota (`#/{token}/compare/{a}/{b}`), com link compartilhável. Página provisória do
 * shell (E3); a E8 a preenche. Até lá, "Compare with…" no detalhe compara dentro da Inbox.
 */
@Component({
  selector: 'app-compare-page',
  imports: [EmptyState],
  template: `
    <main class="page">
      <h1>Compare requests</h1>
      <app-empty-state
        icon="insights"
        heading="Side by side"
        text="For now, open a request in the Inbox and use Compare with…"
      />
    </main>
  `,
  styleUrl: '../shell/stub-page.scss',
})
export class ComparePage {
  private readonly tokens = inject(TokenStore);

  /** Parâmetros da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => {
        if (this.tokens.token()?.uuid !== tokenId) {
          this.tokens.load(tokenId).catch(() => undefined);
        }
      });
    });
  }
}
