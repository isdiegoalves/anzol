import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { AI_OFF_HINT, AI_WAIT_HINT, AiClient, aiErrorMessages } from '../ai/ai-client';
import { MarkdownView } from '../ui/markdown-view';

/**
 * Painel do "Explain" na mensagem: pede o diagnóstico ao abrir (`request/{rid}/explain`) e mostra
 * o texto do modelo como markdown simples. Carregado sob demanda pelo detalhe da mensagem.
 */
@Component({
  selector: 'app-explain-panel',
  imports: [MatButton, MarkdownView],
  templateUrl: './explain-panel.html',
  styleUrl: './explain-panel.scss',
})
export class ExplainPanel {
  private readonly ai = inject(AiClient);

  readonly tokenId = input.required<string>();
  readonly requestId = input.required<string>();

  protected readonly loading = signal(false);
  protected readonly explanation = signal<string | null>(null);
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly disabled = this.ai.disabled;
  protected readonly waitHint = AI_WAIT_HINT;
  protected readonly offHint = AI_OFF_HINT;

  constructor() {
    effect(() => {
      const [tokenId, requestId] = [this.tokenId(), this.requestId()];
      untracked(() => void this.explain(tokenId, requestId));
    });
  }

  protected retry(): void {
    void this.explain(this.tokenId(), this.requestId());
  }

  private async explain(tokenId: string, requestId: string): Promise<void> {
    this.loading.set(true);
    this.explanation.set(null);
    this.errors.set([]);
    try {
      this.explanation.set((await this.ai.explain(tokenId, requestId)).explanation);
    } catch (error) {
      this.errors.set(aiErrorMessages(error));
    } finally {
      this.loading.set(false);
    }
  }
}
