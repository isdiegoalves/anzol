import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SCENARIO_STARTED } from './rule';
import { RuleStore, validationMessages } from './rule-store';
import { ScenarioDiagram } from './scenario-diagram';
import { Scenario, ScenarioStore } from './scenario-store';

/**
 * Painel "Scenarios" da página Rules: estado atual de cada cenário da URL, "Set state" para
 * forçar um estado, "Reset all" para voltar todos a `Started` e o diagrama de cada cenário. Os webhooks mudam os estados no
 * servidor sem aviso à tela: "Refresh" relê, e a aba relê depois de salvar regras.
 */
@Component({
  selector: 'app-scenario-panel',
  imports: [MatButton, MatSelect, MatOption, ScenarioDiagram],
  templateUrl: './scenario-panel.html',
  styleUrl: './scenario-panel.scss',
})
export class ScenarioPanel {
  protected readonly store = inject(ScenarioStore);
  protected readonly rules = inject(RuleStore);
  private readonly snackBar = inject(MatSnackBar);

  readonly tokenId = input.required<string>();

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

  /** Relê os estados (chamado também pela aba depois de salvar regras). */
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

  protected async resetAll(): Promise<void> {
    if (await this.run(() => this.store.resetAll())) {
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
  const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
  return [`Could not update the scenarios (${status}).`];
}
