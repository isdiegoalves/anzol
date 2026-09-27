import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { WebhookRequest } from '../requests/webhook-request';
import { Rule } from './rule';
import {
  AI_OFF_HINT,
  AI_WAIT_HINT,
  AiClient,
  RuleSuggestion,
  aiErrorMessages,
} from '../ai/ai-client';
import { MarkdownView } from '../ui/markdown-view';

/** Teto do `prompt` no servidor (`rules/suggest`). */
export const PROMPT_MAX_LENGTH = 2000;

/**
 * "Describe the rule" no editor de regra: a descrição em linguagem natural vai para
 * `rules/suggest` e a regra sugerida sai por `suggested`, para o editor preencher. Nada é gravado
 * aqui: quem salva é o dono, no "Save" do editor.
 */
@Component({
  selector: 'app-rule-suggest',
  imports: [
    FormsModule,
    MatButton,
    MatCheckbox,
    MatFormField,
    MatHint,
    MatLabel,
    MatInput,
    MarkdownView,
  ],
  templateUrl: './rule-suggest.html',
  styleUrl: './rule-suggest.scss',
})
export class RuleSuggest {
  private readonly ai = inject(AiClient);

  readonly tokenId = input.required<string>();
  /** Mensagem aberta, oferecida como exemplo ao modelo. */
  readonly example = input<WebhookRequest>();
  /** Vem aberto (o cartão "Describe it in words" da lista vazia); senão, recolhido (RULES-16). */
  readonly open = input(false);
  readonly suggested = output<Rule>();

  protected readonly prompt = signal('');
  protected readonly useExample = signal(false);
  protected readonly loading = signal(false);
  protected readonly result = signal<RuleSuggestion | null>(null);
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly disabled = this.ai.disabled;
  protected readonly canSuggest = computed(() => {
    const length = this.prompt().trim().length;
    return !this.loading() && !this.disabled() && length > 0 && length <= PROMPT_MAX_LENGTH;
  });
  /**
   * A descrição cita o token da URL (colaram a URL inteira): a regra sugerida tende a trazer o token
   * no caminho, que é relativo à URL e então nunca casaria.
   */
  protected readonly mentionsUrl = computed(() => {
    const tokenId = this.tokenId().toLowerCase();
    return tokenId !== '' && this.prompt().toLowerCase().includes(tokenId);
  });
  protected readonly maxLength = PROMPT_MAX_LENGTH;
  protected readonly waitHint = AI_WAIT_HINT;
  protected readonly offHint = AI_OFF_HINT;

  protected async suggest(): Promise<void> {
    if (!this.canSuggest()) {
      return;
    }
    const example = this.useExample() ? this.example()?.uuid : undefined;
    this.loading.set(true);
    this.result.set(null);
    this.errors.set([]);
    try {
      const suggestion = await this.ai.suggestRule(this.tokenId(), this.prompt().trim(), example);
      this.result.set(suggestion);
      this.suggested.emit(suggestion.rule);
    } catch (error) {
      this.errors.set(aiErrorMessages(error));
    } finally {
      this.loading.set(false);
    }
  }
}
