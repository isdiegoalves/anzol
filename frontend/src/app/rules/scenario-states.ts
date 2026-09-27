import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatOption, MatSelect } from '@angular/material/select';
import { Rule, SCENARIO_STARTED, scenarioNames, scenarioStates } from './rule';
import { validationMessages } from './rule-store';
import { ScenarioDiagram } from './scenario-diagram';
import { ScenarioStore } from './scenario-store';

/** Um cenário da aba: o estado atual no servidor e os estados que dá para escolher. */
interface ScenarioRow {
  name: string;
  current: string;
  options: string[];
}

/**
 * "Scenarios on this URL" na aba Scenario do editor (C, RULES-24): o diagrama de cada cenário com
 * o estado atual, e "Set state" / "Reset all to Started" / "Refresh" ali mesmo. Os cenários são os
 * do servidor e os que o rascunho cita (ainda em `Started`); o diagrama usa as regras com o
 * rascunho no lugar.
 */
@Component({
  selector: 'app-scenario-states',
  imports: [MatButton, MatSelect, MatOption, ScenarioDiagram],
  template: `
    <section class="states" aria-labelledby="scenario-states-title">
      <header class="heading">
        <h3 id="scenario-states-title" i18n>Scenarios on this URL</h3>
        <span class="spacer"></span>
        <button mat-button type="button" [disabled]="busy()" (click)="refresh()" i18n>
          Refresh
        </button>
        <button mat-stroked-button type="button" [disabled]="busy()" (click)="resetAll()" i18n>
          Reset all to Started
        </button>
      </header>
      @if (errors().length > 0) {
        <div role="alert">
          <ul class="errors">
            @for (message of errors(); track $index) {
              <li>{{ message }}</li>
            }
          </ul>
        </div>
      }
      @for (scenario of scenarios(); track scenario.name) {
        <div class="scenario">
          <app-scenario-diagram
            [name]="scenario.name"
            [rules]="rules()"
            [current]="scenario.current"
            [showSteps]="false"
          />
          <div class="set">
            <mat-select
              class="state"
              placeholder="Set state"
              i18n-placeholder
              [aria-label]="setLabel(scenario.name)"
              [value]="chosen()[scenario.name]"
              (selectionChange)="choose(scenario.name, $event.value)"
            >
              @for (state of scenario.options; track state) {
                <mat-option [value]="state">{{ state }}</mat-option>
              }
            </mat-select>
            <button
              mat-button
              type="button"
              [disabled]="!canSet(scenario)"
              (click)="setState(scenario)"
              i18n
            >
              Set
            </button>
          </div>
        </div>
      } @empty {
        <p class="hint" i18n>No rule uses a scenario yet.</p>
      }
    </section>
  `,
  styleUrl: './scenario-states.scss',
})
export class ScenarioStates {
  private readonly store = inject(ScenarioStore);

  readonly tokenId = input.required<string>();
  /** As regras com o rascunho no lugar dele. */
  readonly rules = input.required<readonly Rule[]>();

  protected readonly busy = signal(false);
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly chosen = signal<Readonly<Record<string, string>>>({});
  protected readonly setLabel = (name: string) => $localize`Set state of ${name}:scenario:`;

  protected readonly scenarios = computed<ScenarioRow[]>(() => {
    const saved = this.store.scenarios();
    const names = [...new Set([...saved.map(({ name }) => name), ...scenarioNames(this.rules())])];
    return names.map((name) => {
      const server = saved.find((scenario) => scenario.name === name);
      const current = server?.state ?? SCENARIO_STARTED;
      const options = [
        ...new Set([...scenarioStates(this.rules(), name), ...(server?.states ?? []), current]),
      ];
      return { name, current, options };
    });
  });

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => void this.run(() => this.store.load(tokenId)));
    });
  }

  protected refresh(): Promise<boolean> {
    return this.run(() => this.store.load(this.tokenId()));
  }

  protected choose(name: string, state: string): void {
    this.chosen.update((chosen) => ({ ...chosen, [name]: state }));
  }

  protected canSet(scenario: ScenarioRow): boolean {
    const state = this.chosen()[scenario.name];
    return !this.busy() && !!state && state !== scenario.current;
  }

  protected async setState(scenario: ScenarioRow): Promise<void> {
    const state = this.chosen()[scenario.name];
    if (await this.run(() => this.store.setState(scenario.name, state))) {
      this.chosen.update((chosen) => ({ ...chosen, [scenario.name]: '' }));
    }
  }

  protected async resetAll(): Promise<void> {
    if (await this.run(() => this.store.resetAll())) {
      this.chosen.set({});
    }
  }

  private async run(action: () => Promise<void>): Promise<boolean> {
    this.busy.set(true);
    this.errors.set([]);
    try {
      await action();
      return true;
    } catch (error) {
      this.errors.set(
        error instanceof HttpErrorResponse && [410, 422].includes(error.status)
          ? validationMessages(error)
          : [$localize`Could not update the scenarios.`],
      );
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
