import { Component, computed, input } from '@angular/core';
import { StatusCode } from '../ui/status-code';
import { RULE_DEFAULT_STATUS, Rule, scenarioStates } from './rule';

/** Uma transição do cenário: a regra que responde num estado e o estado em que ela o deixa. */
export interface ScenarioStep {
  rule: string;
  status: number | null;
  from: string;
  to: string;
  /** A regra não muda o estado (`newState` vazio). */
  stays: boolean;
}

/** As transições das regras do cenário, na ordem da lista (regras desligadas não respondem). */
export function scenarioSteps(rules: readonly Rule[], name: string): ScenarioStep[] {
  return rules
    .filter((rule) => rule.scenario?.name === name && rule.enabled !== false)
    .map((rule) => {
      const from = rule.scenario?.requiredState || 'any state';
      const to = rule.scenario?.newState || from;
      return {
        rule: rule.name,
        status: rule.response?.fault ? null : (rule.response?.status ?? RULE_DEFAULT_STATUS),
        from,
        to,
        stays: !rule.scenario?.newState,
      };
    });
}

/** O que a regra responde, curto: o status, ou "fault" com falha de rede. */
function answerOf(step: ScenarioStep): string {
  return step.status === null ? $localize`fault` : String(step.status);
}

/** "entrega: Started, then falhou 1 (current), then entregue". */
export function scenarioSummary(
  name: string,
  states: readonly string[],
  current: string | null,
): string {
  const named = states.map((state) => (state === current ? `${state} (current)` : state));
  return `${name}: ${named.join(', then ')}`;
}

/**
 * Diagrama de um cenário (C §2.4, B "Scenario"): os estados em ordem, o atual em destaque, e cada
 * regra como a seta de um estado para o outro, com o status que ela responde. Para leitor de tela,
 * é uma imagem com o resumo em texto, e a lista de transições fica legível ao lado.
 */
@Component({
  selector: 'app-scenario-diagram',
  imports: [StatusCode],
  template: `
    <figure class="diagram" role="img" [attr.aria-label]="summary()">
      <ol class="states">
        @for (state of states(); track state; let i = $index) {
          <li>
            @if (i > 0) {
              <span class="arrow">
                @if (edges()[i - 1]; as edge) {
                  <span class="edge">{{ edge }}</span>
                }
                →</span
              >
            }
            <span class="pill" [class.current]="state === current()">{{ state }}</span>
          </li>
        }
      </ol>
      @for (step of staying(); track $index) {
        <p class="stays" i18n>then {{ step.answer }} while in {{ step.to }}</p>
      }
    </figure>
    @if (showSteps()) {
      <ul class="steps">
        @for (step of steps(); track $index) {
          <li>
            <span class="state">{{ step.from }}</span
            >&ngsp; <span class="arrow" aria-hidden="true">→</span>&ngsp;
            <span class="rule">{{ step.rule }}</span
            >&ngsp;
            <app-status-code [status]="step.status" error="Network fault" i18n-error />&ngsp;
            <span class="arrow" aria-hidden="true">→</span>&ngsp;
            @if (step.stays) {
              <span class="stays" i18n>stays in {{ step.to }}</span>
            } @else {
              <span class="state">{{ step.to }}</span>
            }
          </li>
        } @empty {
          <li class="hint" i18n>No enabled rule uses this scenario yet.</li>
        }
      </ul>
    }
  `,
  styleUrl: './scenario-diagram.scss',
})
export class ScenarioDiagram {
  readonly name = input.required<string>();
  readonly rules = input.required<readonly Rule[]>();
  /** Estado atual no servidor (`GET /scenarios`); `null` quando não se sabe. */
  readonly current = input<string | null>(null);
  /** A lista de transições por extenso, embaixo do diagrama (o painel da lista a mostra). */
  readonly showSteps = input(true);

  protected readonly states = computed(() => {
    const cited = scenarioStates(this.rules(), this.name());
    const current = this.current();
    return current && !cited.includes(current) ? [...cited, current] : cited;
  });
  protected readonly steps = computed(() => scenarioSteps(this.rules(), this.name()));
  /** O status entre cada par de estados seguidos: o da regra que leva de um ao outro (RULES-24). */
  protected readonly edges = computed(() => {
    const states = this.states();
    const steps = this.steps();
    return states.slice(1).map((state, i) => {
      const step = steps.find(
        ({ from, to, stays }) => !stays && from === states[i] && to === state,
      );
      return step ? answerOf(step) : null;
    });
  });
  /** As regras que respondem sem mudar o estado: "then 200 while in entregue". */
  protected readonly staying = computed(() =>
    this.steps()
      .filter(({ stays }) => stays)
      .map((step) => ({ to: step.to, answer: answerOf(step) })),
  );
  protected readonly summary = computed(() =>
    scenarioSummary(this.name(), this.states(), this.current()),
  );
}
