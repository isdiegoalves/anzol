import { Injectable, computed, signal } from '@angular/core';
import { WebhookRequest } from '../requests/webhook-request';

/**
 * "Compare with…": a mensagem aberta vira a A, a lista entra em modo de escolha e a mensagem
 * escolhida vira a B. Só o estado; a vista do diff vem sob demanda (`request-compare`).
 */
@Injectable({ providedIn: 'root' })
export class CompareStore {
  private readonly state = signal<{ a: WebhookRequest; b?: WebhookRequest } | null>(null);

  /** Mensagem A enquanto a lista espera a escolha da B. */
  readonly picking = computed(() => {
    const state = this.state();
    return state && !state.b ? state.a : null;
  });

  /** As duas mensagens, quando a comparação está aberta. */
  readonly pair = computed(() => {
    const state = this.state();
    return state?.b ? { a: state.a, b: state.b } : null;
  });

  start(a: WebhookRequest): void {
    this.state.set({ a });
  }

  /** Escolher a própria A não abre nada. */
  choose(b: WebhookRequest): void {
    const a = this.picking();
    if (a && a.uuid !== b.uuid) {
      this.state.set({ a, b });
    }
  }

  swap(): void {
    const pair = this.pair();
    if (pair) {
      this.state.set({ a: pair.b, b: pair.a });
    }
  }

  close(): void {
    this.state.set(null);
  }
}
