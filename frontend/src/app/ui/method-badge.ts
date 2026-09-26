import { Component, computed, input } from '@angular/core';

/** Papel de cor do método, com os nomes dos `label-*` do app atual (o E2E da lista os confere). */
export type MethodTone = 'info' | 'success' | 'danger' | 'primary' | 'warning' | 'default';

export function methodTone(method: string): MethodTone {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'info';
    case 'GET':
      return 'success';
    case 'DELETE':
      return 'danger';
    case 'HEAD':
    case 'PUT':
      return 'primary';
    case 'PATCH':
      return 'warning';
    default:
      return 'default';
  }
}

/** Método HTTP em selo: texto sempre, cor pelo papel (substitui o `method-label` na E4). */
@Component({
  selector: 'app-method-badge',
  template: '{{ method() }}',
  styleUrl: './method-badge.scss',
  host: { '[class]': '"method " + tone()' },
})
export class MethodBadge {
  readonly method = input.required<string>();

  protected readonly tone = computed(() => methodTone(this.method()));
}
