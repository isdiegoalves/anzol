import { Component, input } from '@angular/core';

let nextId = 0;

/**
 * Painel da tela (lista, detalhe, editor): superfície com cantos grandes, cabeçalho com título e
 * ações, e o conteúdo que rola sozinho. Com `heading`, vira uma região com esse nome; o nível do
 * título segue a página (`level`).
 */
@Component({
  selector: 'app-pane',
  template: `
    @if (heading()) {
      <header class="header">
        @switch (level()) {
          @case (1) {
            <h1 class="heading" [id]="headingId">{{ heading() }}</h1>
          }
          @case (3) {
            <h3 class="heading" [id]="headingId">{{ heading() }}</h3>
          }
          @default {
            <h2 class="heading" [id]="headingId">{{ heading() }}</h2>
          }
        }
        <span class="spacer"></span>
        <ng-content select="[paneActions]" />
      </header>
    }
    <div class="body">
      <ng-content />
    </div>
  `,
  styleUrl: './pane.scss',
  host: {
    '[attr.role]': 'heading() ? "region" : null',
    '[attr.aria-labelledby]': 'heading() ? headingId : null',
  },
})
export class Pane {
  readonly heading = input<string | null>(null);
  readonly level = input<1 | 2 | 3>(2);

  protected readonly headingId = `app-pane-heading-${nextId++}`;
}
