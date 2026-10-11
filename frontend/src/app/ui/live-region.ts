import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';

/**
 * Quanto a frase do `LiveAnnouncer` fica no DOM, o segundo argumento de todo `announce`: o leitor
 * a diz na hora, e quem chega a ela depois, navegando, não acha uma contagem velha.
 */
export const ANNOUNCEMENT_MS = 5_000;

/**
 * Quanto a região viva fica vazia para o leitor de tela antes de o texto entrar: o mesmo intervalo do
 * `LiveAnnouncer` do CDK, sem o qual há leitor que não anuncia nada ou não repete uma frase igual.
 */
export const SPOKEN_AFTER_MS = 100;

/**
 * Esconde do leitor de tela o que já está na tela, dentro de uma região viva, e o mostra a ele
 * `SPOKEN_AFTER_MS` depois da próxima renderização; devolve como desistir. Para quem vê, nada muda:
 * o texto fica onde está. Para o leitor, a região existe vazia e depois recebe o texto, que é o que
 * ele anuncia.
 */
export function speakLater(content: HTMLElement, injector: Injector): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  content.setAttribute('aria-hidden', 'true');
  const rendered = afterNextRender(
    () =>
      (timer = setTimeout(() => {
        content.removeAttribute('aria-hidden');
        // Tirar e pôr de volta é a inserção que a região anuncia; o lugar na tela é o mesmo.
        content.parentNode?.insertBefore(content, content.nextSibling);
      }, SPOKEN_AFTER_MS)),
    { injector },
  );
  return () => {
    rendered.destroy();
    clearTimeout(timer);
  };
}

/**
 * Região viva persistente: criada já com texto, ela não é anunciada, então fica no template sem
 * `@if` em volta e muda só o `text`. O `label` vai para um `group` em volta, porque região com nome
 * anuncia o nome, e não o texto. O `tail` é uma frase a mais no fim, num nó só dela: quando ela sai,
 * o `text` não é regravado e o leitor não repete o que já disse. O `again` é para a frase que pode
 * se repetir igual: cada valor novo faz o leitor ouvi-la de novo.
 */
@Component({
  selector: 'app-live-region',
  // Numa linha: espaço em volta do texto entraria na região.
  template:
    '<span [attr.role]="label() ? role() : null"><span #said>{{ text() }}@if (tail()) {<span>{{ " " + tail() }}</span>}</span></span>',
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
  readonly again = input<unknown>(undefined);

  private readonly said = viewChild.required<ElementRef<HTMLElement>>('said');
  protected readonly role = computed(() => (this.alert() ? 'alert' : 'status'));

  constructor() {
    const injector = inject(Injector);
    let cancel: (() => void) | null = null;
    let first = true;
    effect(() => {
      this.again();
      if (first) {
        first = false;
        return;
      }
      untracked(() => {
        cancel?.();
        cancel = speakLater(this.said().nativeElement, injector);
      });
    });
    inject(DestroyRef).onDestroy(() => cancel?.());
  }
}
