import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { ServerPhrase, conditionPhrase } from '../pipeline/server-phrases';
import { CapturedRequest } from '../requests/webhook-request';
import { Rule, RuleTrace, evaluationOrder } from '../rules/rule';
import { RuleStore } from '../rules/rule-store';

/** O trace pedido: carregando, pronto (com a regra escolhida) ou com o erro já em frase. */
type TraceState =
  | { kind: 'loading'; chosen: Rule }
  | { kind: 'done'; chosen: Rule; trace: RuleTrace }
  | { kind: 'error'; chosen: Rule; message: string };

let nextId = 0;

/**
 * "Why not rule…?" no cartão da regra do detalhe (C1, WM-23): o menu com as regras de agora na
 * ordem de avaliação (as desligadas por último, "(off)"); escolher uma pede o trace da mensagem e
 * mostra, regra por regra e na ordem, o que casou e as condições que falharam. Só leitura: nada é
 * gravado e o cenário não muda.
 */
@Component({
  selector: 'app-rule-trace',
  imports: [MatButton, MatMenu, MatMenuItem, MatMenuTrigger, RouterLink],
  templateUrl: './rule-trace.html',
  styleUrl: './rule-trace.scss',
})
export class RuleTracePanel {
  private readonly store = inject(RuleStore);

  readonly tokenId = input.required<string>();
  readonly request = input.required<CapturedRequest>();

  protected readonly titleId = `rule-trace-${nextId++}`;
  /** As regras de agora, lidas ao abrir o menu (uma vez por mensagem). */
  protected readonly rules = signal<readonly Rule[] | null>(null);
  protected readonly state = signal<TraceState | null>(null);
  /** "Show original" (WM-05): as condições que falharam como o servidor mandou. */
  protected readonly showOriginal = signal(false);

  /** Ligadas na ordem de avaliação, depois as desligadas na ordem da lista. */
  protected readonly menu = computed(() => {
    const rules = this.rules() ?? [];
    const order = evaluationOrder(rules).map((index) => rules[index]);
    return [
      ...order.filter((rule) => rule.enabled !== false),
      ...order.filter((rule) => rule.enabled === false),
    ].map((rule) => ({
      rule,
      label: rule.enabled === false ? $localize`${rule.name}:name: (off)` : rule.name,
    }));
  });

  /** Uma linha por regra do trace, na ordem do servidor, com o veredito. */
  protected readonly items = computed(() => {
    const state = this.state();
    if (state?.kind !== 'done') {
      return [];
    }
    const answered = state.trace.responded_by?.id ?? null;
    const original = this.showOriginal();
    return state.trace.rules.map((rule) => {
      const phrases = rule.failed.map(conditionPhrase);
      return {
        id: rule.id,
        name: rule.name,
        position: rule.position,
        chosen: rule.id === state.chosen.id,
        off: !rule.enabled,
        verdict: verdictOf(rule, answered, phrases, original),
        title: originalOf(phrases),
      };
    });
  });
  /** Alguma condição saiu traduzida: vale o "Show original". */
  protected readonly anyTranslated = computed(() => {
    const state = this.state();
    return (
      state?.kind === 'done' &&
      state.trace.rules.some(({ failed }) => failed.some((f) => conditionPhrase(f).translated))
    );
  });
  protected readonly answeredBy = computed(() => {
    const state = this.state();
    const by = state?.kind === 'done' ? state.trace.responded_by : null;
    return by ? $localize`Answered by: ${by.name}:name:` : $localize`No rule answered`;
  });

  constructor() {
    // Outra mensagem: outro trace (e as regras relidas, que podem ter mudado).
    effect(() => {
      this.request();
      untracked(() => {
        this.state.set(null);
        this.rules.set(null);
        this.showOriginal.set(false);
      });
    });
  }

  protected async loadRules(): Promise<void> {
    if (this.rules() === null) {
      try {
        this.rules.set(await this.store.listRules(this.tokenId()));
      } catch {
        this.rules.set([]);
      }
    }
  }

  protected async choose(rule: Rule): Promise<void> {
    const requestId = this.request().uuid;
    this.state.set({ kind: 'loading', chosen: rule });
    try {
      const trace = await this.store.trace(this.tokenId(), requestId);
      if (this.request().uuid === requestId) {
        this.state.set({ kind: 'done', chosen: rule, trace });
      }
    } catch (error) {
      this.state.set({ kind: 'error', chosen: rule, message: traceError(error) });
    }
  }
}

function verdictOf(
  rule: RuleTrace['rules'][number],
  answered: string | null,
  phrases: readonly ServerPhrase[],
  original: boolean,
): string {
  if (!rule.matches) {
    const conditions = phrases.map((p) => (original ? p.original : p.text)).join(' · ');
    return $localize`did not match: ${conditions}:conditions:`;
  }
  if (!rule.enabled) {
    return $localize`would match, but it is off`;
  }
  if (answered === null) {
    // As regras mudaram desde que a mensagem chegou: hoje ela casaria.
    return $localize`matches now`;
  }
  return rule.id === answered
    ? $localize`matched · answered`
    : $localize`matched, but an earlier rule answered`;
}

/** "Original: …" das condições, quando alguma saiu traduzida (WM-05). */
function originalOf(phrases: readonly ServerPhrase[]): string | null {
  if (!phrases.some((p) => p.translated)) {
    return null;
  }
  const original = phrases.map((p) => p.original).join(' · ');
  return $localize`Original: ${original}:phrase:`;
}

function traceError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 404) {
    return $localize`This request no longer exists.`;
  }
  const status = error instanceof HttpErrorResponse ? error.status : $localize`unknown`;
  return $localize`Could not check the rules (${status}:status:).`;
}
