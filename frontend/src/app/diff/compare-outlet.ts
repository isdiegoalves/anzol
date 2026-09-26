import {
  Component,
  ComponentRef,
  ViewContainerRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { WebhookRequest } from '../requests/webhook-request';
import type { RequestCompare } from './request-compare';

/**
 * Traz a vista do diff (com a biblioteca de diff) num pedaço à parte, só quando a comparação
 * abre. `import()` e não `@defer`: o runtime do `@defer` (e o de `NgComponentOutlet`) pesaria no
 * bundle inicial, que está no limite.
 */
@Component({
  selector: 'app-compare-outlet',
  template: `
    @if (!view()) {
      <p class="loading">Loading comparison&hellip;</p>
    }
  `,
  styles: '.loading { color: #999; }',
})
export class CompareOutlet {
  private readonly container = inject(ViewContainerRef);

  readonly a = input.required<WebhookRequest>();
  readonly b = input.required<WebhookRequest>();

  protected readonly view = signal<ComponentRef<RequestCompare> | undefined>(undefined);

  constructor() {
    void import('./request-compare').then(({ RequestCompare }) => {
      const view = this.container.createComponent(RequestCompare);
      // Entradas obrigatórias: dadas antes da primeira detecção de mudanças da vista.
      view.setInput('a', untracked(this.a));
      view.setInput('b', untracked(this.b));
      this.view.set(view);
    });
    // Trocar A e B chega aqui como entradas novas.
    effect(() => {
      const [a, b, view] = [this.a(), this.b(), this.view()];
      view?.setInput('a', a);
      view?.setInput('b', b);
    });
  }
}
