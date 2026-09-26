import { Component, effect, inject, input, untracked } from '@angular/core';
import { TokenStore } from '../token/token-store';
import { EmptyState } from '../ui/empty-state';

/**
 * Insights (`#/{token}/insights`): números e gráficos da URL. Página provisória do shell (E3); a E9
 * a preenche com `GET /token/{id}/stats`.
 */
@Component({
  selector: 'app-insights-page',
  imports: [EmptyState],
  template: `
    <main class="page">
      <h1>Insights</h1>
      <app-empty-state
        icon="insights"
        heading="How this URL is doing"
        text="Request volume, signature and schema results, and the rules that answered."
      />
    </main>
  `,
  styleUrl: '../shell/stub-page.scss',
})
export class InsightsPage {
  private readonly tokens = inject(TokenStore);

  /** Parâmetro da rota (`withComponentInputBinding`). */
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
