import { Component, input } from '@angular/core';
import { Icon, IconName } from './icon';

/**
 * Estado vazio de um painel (C §2.11): ícone, título, a frase do que apareceria ali e, por
 * projeção, a ação ("Clear filters", "Create a new URL").
 */
@Component({
  selector: 'app-empty-state',
  imports: [Icon],
  template: `
    <app-icon class="icon" [name]="icon()" [size]="32" />
    <p class="title">{{ heading() }}</p>
    @if (text()) {
      <p class="text">{{ text() }}</p>
    }
    <div class="actions"><ng-content /></div>
  `,
  styleUrl: './empty-state.scss',
})
export class EmptyState {
  readonly icon = input<IconName>('inbox');
  readonly heading = input.required<string>();
  readonly text = input<string | null>(null);
}
