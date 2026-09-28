import { Component, computed, input } from '@angular/core';
import { Icon } from '../ui/icon';
import { StepState, stateText } from './guide-steps';

/**
 * Um passo de roteiro (R1): item de lista com o número, o nome e o estado em palavras ("done",
 * "to do", "optional"), e o atalho do passo dentro. O estado não é só cor nem só ícone.
 */
@Component({
  selector: 'app-guide-step',
  imports: [Icon],
  template: `
    <h3 class="head">
      <span class="mark" aria-hidden="true">
        @if (state() === 'done') {
          <app-icon name="check" [size]="16" />
        } @else {
          {{ number() }}
        }
      </span>
      <span class="name">{{ name() }}</span>
      <!-- Lido junto com o nome: "Send a request, to do". -->
      <span class="sep">{{ ', ' }}</span>
      <span class="state">{{ stateName() }}</span>
    </h3>
    <div class="body"><ng-content /></div>
  `,
  styleUrl: './guide-step.scss',
  host: { role: 'listitem', '[class]': 'state()' },
})
export class GuideStep {
  readonly number = input.required<number>();
  readonly name = input.required<string>();
  readonly state = input.required<StepState>();

  protected readonly stateName = computed(() => stateText(this.state()));
}
