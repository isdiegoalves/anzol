import { Component, effect, inject, input, untracked } from '@angular/core';
import { TokenStore } from '../token/token-store';
import { EmptyState } from '../ui/empty-state';

/**
 * Checks (`#/{token}/checks`): a configuração da URL (assinatura, schema, resposta, privacidade,
 * saúde). Página provisória do shell (E3); a E5 a preenche. Até lá, "Edit" no cabeçalho abre o
 * diálogo de hoje.
 */
@Component({
  selector: 'app-checks-page',
  imports: [EmptyState],
  template: `
    <main class="page">
      <h1>Checks</h1>
      <app-empty-state
        icon="checks"
        heading="What this URL checks"
        text="Signature, schema, default response and privacy. For now, change them with Edit in the URL header."
      />
    </main>
  `,
  styleUrl: '../shell/stub-page.scss',
})
export class ChecksPage {
  private readonly tokens = inject(TokenStore);

  /** Parâmetro da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => {
        if (this.tokens.token()?.uuid !== tokenId) {
          // 401 de URL protegida tranca a tela pelo interceptor; o resto fica sem a URL.
          this.tokens.load(tokenId).catch(() => undefined);
        }
      });
    });
  }
}
