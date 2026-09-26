import { Component, computed, input } from '@angular/core';

/** Papel de cor do método, com os nomes dos `label-*` do Bootstrap do app atual (tokens do tema). */
export function methodColor(
  method: string,
): 'info' | 'success' | 'danger' | 'primary' | 'warning' | 'default' {
  switch (method) {
    case 'POST':
      return 'info';
    case 'GET':
      return 'success';
    case 'DELETE':
      return 'danger';
    case 'HEAD':
      return 'primary';
    case 'PATCH':
      return 'warning';
    default:
      return 'default';
  }
}

@Component({
  selector: 'app-method-label',
  template: `<span
    class="label"
    [class.info]="color() === 'info'"
    [class.success]="color() === 'success'"
    [class.danger]="color() === 'danger'"
    [class.primary]="color() === 'primary'"
    [class.warning]="color() === 'warning'"
    >{{ method() }}</span
  >`,
  styles: `
    .label {
      display: inline-block;
      padding: 0.2em 0.6em 0.3em;
      border-radius: 0.25em;
      background: var(--mat-sys-inverse-surface);
      color: var(--mat-sys-inverse-on-surface);
      font-size: 75%;
      font-weight: bold;
      line-height: 1;
      vertical-align: baseline;
    }
    .info {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .success {
      background: var(--app-success);
      color: var(--app-on-success);
    }
    .danger {
      background: var(--mat-sys-error);
      color: var(--mat-sys-on-error);
    }
    .primary {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
    .warning {
      background: var(--app-warning);
      color: var(--app-on-warning);
    }
  `,
})
export class MethodLabel {
  readonly method = input.required<string>();
  protected readonly color = computed(() => methodColor(this.method()));
}
