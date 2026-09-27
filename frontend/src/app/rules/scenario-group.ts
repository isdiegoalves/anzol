import { Component, computed, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';

/**
 * Cabeçalho de uma sequência de regras do mesmo cenário na lista (RULES-07, WM-33): o nome, o
 * estado atual, "Reset scenario" (só este cenário volta a Started) e o aviso de estado terminal
 * quando nenhuma regra ligada do cenário responde no estado de agora.
 */
@Component({
  selector: 'app-scenario-group',
  imports: [MatButton],
  template: `
    <span class="scenario-name" i18n>Scenario "{{ name() }}"</span>
    @if (state(); as state) {
      <span class="state" i18n>state: {{ state }}</span>
    }
    <button
      mat-button
      type="button"
      class="reset"
      [disabled]="busy()"
      (click)="resetRequested.emit()"
      i18n="button|Moves this scenario back to Started"
    >
      Reset scenario
    </button>
    @if (terminal()) {
      <p class="terminal" role="note">{{ terminalText() }}</p>
    }
  `,
  styleUrl: './scenario-group.scss',
})
export class ScenarioGroup {
  readonly name = input.required<string>();
  /** Estado atual (`GET /scenarios`); `null` enquanto não chega. */
  readonly state = input<string | null>(null);
  /** Para onde cai a próxima requisição quando o estado é terminal; `null` quando não é. */
  readonly terminal = input<string | null>(null);
  readonly busy = input(false);

  readonly resetRequested = output<void>();

  protected readonly terminalText = computed(
    () =>
      $localize`No enabled rule answers in state "${this.state()}:state:"; the next request falls to ${this.terminal()}:next:.`,
  );
}
