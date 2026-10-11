import {
  DestroyRef,
  Directive,
  Injector,
  TemplateRef,
  ViewContainerRef,
  inject,
} from '@angular/core';
import { afterShownEmpty } from './live-region';

/**
 * O conteúdo de uma região viva que só existe enquanto tem o que dizer (dentro de um `@if`): entra
 * uma tarefa depois de a região aparecer vazia, porque região criada já com texto não é anunciada.
 * Vai num `ng-container` logo dentro do elemento com `role="status"` ou `aria-live`.
 */
@Directive({ selector: '[appLateContent]' })
export class LateContent {
  constructor() {
    const template = inject<TemplateRef<unknown>>(TemplateRef);
    const container = inject(ViewContainerRef);
    inject(DestroyRef).onDestroy(
      afterShownEmpty(
        () => container.createEmbeddedView(template).detectChanges(),
        inject(Injector),
      ),
    );
  }
}
