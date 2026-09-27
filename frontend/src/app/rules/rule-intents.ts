import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Injectable, inject, signal } from '@angular/core';
import { Rule } from './rule';

/** Regra nova pedida de um lugar que não é a rota (duplicar, modelo, estado vazio). */
export interface NewRuleIntent {
  draft: Rule;
  /** Índice da lista salva onde ela entra; ausente, a página decide (antes da pega-tudo). */
  insertAt?: number;
  /** Abre o "Describe the rule" expandido só desta vez (cartão do estado vazio, WM-02). */
  openSuggest?: boolean;
}

/** Quanto tempo a lista destaca as regras recém-criadas (WM-35). */
export const CREATED_HIGHLIGHT_MS = 5000;

/**
 * O que passa de uma instância da página de Regras para a próxima (`rules` e `rules/new` são
 * rotas diferentes): a regra nova pedida, com um número que muda a cada pedido (um modelo
 * escolhido com o editor de outra regra nova aberto o recria), e as regras recém-criadas, que a
 * lista destaca por 5 s a partir de `at` (WM-35).
 */
@Injectable({ providedIn: 'root' })
export class RuleIntents {
  private readonly announcer = inject(LiveAnnouncer);
  private serial = 0;
  readonly pending = signal<(NewRuleIntent & { serial: number }) | null>(null);
  readonly created = signal<{ ids: readonly string[]; at: number } | null>(null);

  request(intent: NewRuleIntent): void {
    this.pending.set({ ...intent, serial: ++this.serial });
  }

  /** O editor da regra nova fechou: o próximo "New rule" sem pedido volta ao padrão. */
  clear(): void {
    this.pending.set(null);
  }

  /**
   * Destaca na lista as regras criadas agora (assistente, import, Save da regra nova) e, se
   * pedido, anuncia quantas ("3 rules created").
   */
  markCreated(ids: readonly string[], announce = true): void {
    if (ids.length === 0) {
      return;
    }
    this.created.set({ ids, at: Date.now() });
    if (announce) {
      void this.announcer.announce(
        ids.length === 1
          ? $localize`1 rule created`
          : $localize`${ids.length}:count: rules created`,
      );
    }
  }
}
