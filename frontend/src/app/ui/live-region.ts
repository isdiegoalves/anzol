import { Component, computed, input } from '@angular/core';

/**
 * Região viva persistente: criada já com texto, ela não é anunciada, então fica no template sem
 * `@if` em volta e muda só o `text`. O `label` vai para um `group` em volta, porque região com nome
 * anuncia o nome, e não o texto.
 */
@Component({
  selector: 'app-live-region',
  // Numa linha: espaço em volta do texto entraria na região.
  template: '<span [attr.role]="label() ? role() : null">{{ text() }}</span>',
  styles: `
    :host {
      display: block;
    }

    :host(.empty) {
      position: absolute;
    }
  `,
  host: {
    '[attr.role]': 'label() ? "group" : role()',
    '[attr.aria-label]': 'label()',
    '[class.empty]': '!text()',
  },
})
export class LiveRegion {
  readonly label = input<string | null>(null);
  readonly text = input('');
  readonly alert = input(false);

  protected readonly role = computed(() => (this.alert() ? 'alert' : 'status'));
}
