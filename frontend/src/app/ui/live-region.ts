import { Component, Injector, afterNextRender, computed, input } from '@angular/core';

/**
 * Quanto a frase do `LiveAnnouncer` fica no DOM, o segundo argumento de todo `announce`: o leitor
 * a diz na hora, e quem chega a ela depois, navegando, não acha uma contagem velha.
 */
export const ANNOUNCEMENT_MS = 5_000;

/**
 * Roda `fill` numa tarefa depois da próxima renderização, e devolve como desistir. A região viva só
 * anuncia o que entra com ela já vazia na tela, e o Angular encaixa duas renderizações seguidas na
 * mesma tarefa: sem a tarefa nova, o leitor de tela não chega a ver a região vazia.
 */
export function afterShownEmpty(fill: () => void, injector: Injector): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rendered = afterNextRender(() => (timer = setTimeout(fill)), { injector });
  return () => {
    rendered.destroy();
    clearTimeout(timer);
  };
}

/**
 * Região viva persistente: criada já com texto, ela não é anunciada, então fica no template sem
 * `@if` em volta e muda só o `text`. O `label` vai para um `group` em volta, porque região com nome
 * anuncia o nome, e não o texto. O `tail` é uma frase a mais no fim, num nó só dela: quando ela sai,
 * o `text` não é regravado e o leitor não repete o que já disse.
 */
@Component({
  selector: 'app-live-region',
  // Numa linha: espaço em volta do texto entraria na região.
  template:
    '<span [attr.role]="label() ? role() : null">{{ text() }}@if (tail()) {<span>{{ " " + tail() }}</span>}</span>',
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
  readonly tail = input('');
  readonly alert = input(false);

  protected readonly role = computed(() => (this.alert() ? 'alert' : 'status'));
}
