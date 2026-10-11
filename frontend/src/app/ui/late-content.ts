import { DestroyRef, Directive, ElementRef, Injector, inject } from '@angular/core';
import { speakLater } from './live-region';

/**
 * A frase de uma região viva que só existe enquanto tem o que dizer (dentro de um `@if`): região
 * criada já com texto não é anunciada. Vai num `span` logo dentro do elemento com `role="status"` ou
 * `aria-live`, só com a frase: botão e link ficam fora da região.
 */
@Directive({ selector: '[appLateContent]' })
export class LateContent {
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    inject(DestroyRef).onDestroy(speakLater(host, inject(Injector)));
  }
}
