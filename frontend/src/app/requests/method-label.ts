import { Component, computed, input } from '@angular/core';

/** Cor do método como os `label-*` do Bootstrap no app atual. */
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
      background: #777;
      color: #fff;
      font-size: 75%;
      font-weight: bold;
      line-height: 1;
      vertical-align: baseline;
    }
    .info {
      background: #5bc0de;
    }
    .success {
      background: #5cb85c;
    }
    .danger {
      background: #d9534f;
    }
    .primary {
      background: #337ab7;
    }
    .warning {
      background: #f0ad4e;
    }
  `,
})
export class MethodLabel {
  readonly method = input.required<string>();
  protected readonly color = computed(() => methodColor(this.method()));
}
