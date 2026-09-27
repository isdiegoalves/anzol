import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Rule, SCENARIO_STARTED, scenarioNames } from './rule';
import { neverMatches } from './rule-shadow';
import { validationMessages } from './rule-store';
import { ScenarioDiagram } from './scenario-diagram';
import { openSequence } from './scenario-sequence';
import { Scenario, ScenarioStore } from './scenario-store';

/**
 * "Scenarios on this URL", na aba Scenario do editor (C, RULES-12/24): o estado atual de cada cenário
 * da URL (e dos que só o rascunho cita, em `Started`), "Set state" para forçar um estado, "Reset all
 * to Started" e o diagrama de cada cenário com as regras do rascunho. Os webhooks mudam os estados
 * no servidor sem aviso à tela: "Refresh" relê.
 */
@Component({
  selector: 'app-scenario-panel',
  imports: [MatButton, MatSelect, MatOption, ScenarioDiagram],
  templateUrl: './scenario-panel.html',
  styleUrl: './scenario-panel.scss',
})
export class ScenarioPanel {
  protected readonly store = inject(ScenarioStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(Injector);

  readonly tokenId = input.required<string>();
  /** As regras da URL com o rascunho do editor no lugar dele. */
  readonly rules = input<readonly Rule[]>([]);

  /** Os cenários do servidor e, em `Started`, os que só o rascunho cita. */
  protected readonly scenarios = computed<Scenario[]>(() => {
    const saved = this.store.scenarios();
    const drafted = scenarioNames(this.rules())
      .filter((name) => !saved.some((scenario) => scenario.name === name))
      .map((name) => ({ name, state: SCENARIO_STARTED, states: [] }));
    return [...saved, ...drafted];
  });

  /**
   * E-09: os estados exigidos que nenhuma outra regra ligada produz (nem Started, nem o estado de
   * agora, que pode ter sido posto à mão), com as regras do rascunho: provável erro de digitação.
   */
  protected readonly orphans = computed(() => {
    const rules = this.rules();
    const states = rules.flatMap((rule) => {
      const never = neverMatches(rule, rules, {}, this.store.scenarios());
      return never?.cause === 'state' ? [never.state] : [];
    });
    return [...new Set(states)].map(
      (state) => $localize`No rule leads to state "${state}:state:" — probably a typo.`,
    );
  });
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly busy = signal(false);
  /** Estado escolhido no seletor de cada cenário, ainda não enviado. */
  protected readonly chosen = signal<Readonly<Record<string, string>>>({});

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => void this.run(() => this.store.load(tokenId)));
    });
  }

  /** "Sequence…" (WM-32): o assistente grava as regras encadeadas; a lista as destaca. */
  protected openSequence(): void {
    void openSequence(this.injector);
  }

  /** Relê os estados. */
  async refresh(): Promise<void> {
    await this.run(() => this.store.load(this.tokenId()));
  }

  protected options(scenario: Scenario): string[] {
    return [...new Set([SCENARIO_STARTED, ...scenario.states, scenario.state])];
  }

  protected choose(name: string, state: string): void {
    this.chosen.update((chosen) => ({ ...chosen, [name]: state }));
  }

  protected canSet(scenario: Scenario): boolean {
    const state = this.chosen()[scenario.name];
    return !this.busy() && !!state && state !== scenario.state;
  }

  protected async setState(scenario: Scenario): Promise<void> {
    const state = this.chosen()[scenario.name];
    const done = await this.run(() => this.store.setState(scenario.name, state));
    if (done) {
      this.chosen.update((chosen) =>
        Object.fromEntries(Object.entries(chosen).filter(([name]) => name !== scenario.name)),
      );
      this.snackBar.open(
        $localize`Scenario ${scenario.name}:scenario: set to ${state}:state:`,
        undefined,
        {
          duration: 1000,
        },
      );
    }
  }

  /** "Reset all to Started" zera todos os cenários da URL: confirma nomeando quais (WM-37). */
  protected async resetAll(): Promise<void> {
    const names = this.store.scenarios().map(({ name }) => name);
    const list = names.join(', ');
    // O diálogo (e o MatDialog) vêm sob demanda: ficam fora do pedaço de Regras.
    const { confirmAction } = await import('./rule-dialogs');
    const confirmed = await confirmAction(this.injector, {
      title: $localize`Reset all scenarios?`,
      message:
        names.length === 1
          ? $localize`Resets 1 scenario to ${SCENARIO_STARTED}:state:: ${list}:names:.`
          : $localize`Resets ${names.length}:count: scenarios to ${SCENARIO_STARTED}:state:: ${list}:names:.`,
      confirm: $localize`Reset`,
      cancel: $localize`Cancel`,
    });
    if (confirmed && (await this.run(() => this.store.resetAll()))) {
      this.chosen.set({});
      this.snackBar.open($localize`Scenarios reset to ${SCENARIO_STARTED}:state:`, undefined, {
        duration: 1000,
      });
    }
  }

  private async run(action: () => Promise<void>): Promise<boolean> {
    this.busy.set(true);
    this.errors.set([]);
    try {
      await action();
      return true;
    } catch (error) {
      this.errors.set(scenarioMessages(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}

function scenarioMessages(error: unknown): string[] {
  if (error instanceof HttpErrorResponse && [410, 422].includes(error.status)) {
    return validationMessages(error);
  }
  const status = error instanceof HttpErrorResponse ? error.status : $localize`unknown`;
  return [$localize`Could not update the scenarios (${status}:status:).`];
}
