import { Component, computed, inject, input, signal } from '@angular/core';
import { CapturedRequest } from '../requests/webhook-request';
import { FilterChips } from '../search/filter-chips';
import { FILTER_VALUE_MAX } from './value-actions';

/** Quantos campos o painel mostra, e até que profundidade do corpo (o "From this request" de Regras). */
const FIELDS_MAX = 60;
const DEPTH_MAX = 4;

interface BodyField {
  path: string;
  /** O literal JSON, como o bloco o mostraria. */
  shown: string;
  /** O valor como a condição o compara (o texto, sem as aspas). */
  value: string;
}

/** As folhas do corpo JSON (até 4 níveis, no máximo 60), com o JSONPath de cada uma. */
function bodyFields(content: string | null): BodyField[] {
  let body: unknown;
  try {
    body = JSON.parse(content ?? '');
  } catch {
    return [];
  }
  const fields: BodyField[] = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (fields.length >= FIELDS_MAX) {
      return;
    }
    if (node !== null && typeof node === 'object') {
      if (depth < DEPTH_MAX) {
        for (const [key, child] of Object.entries(node)) {
          const step = Array.isArray(node)
            ? `[${key}]`
            : /^[A-Za-z_$][\w$]*$/.test(key)
              ? `.${key}`
              : `[${JSON.stringify(key)}]`;
          walk(child, path + step, depth + 1);
        }
      }
      return;
    }
    const value = typeof node === 'string' ? node : JSON.stringify(node);
    if (value.length <= FILTER_VALUE_MAX) {
      fields.push({ path, shown: JSON.stringify(node), value });
    }
  };
  walk(body, '$', 0);
  return fields;
}

/**
 * "Filter by a field…" (F1): com o corpo acima de 100 KB, o clique por linha sai; os campos do corpo
 * ficam numa lista com busca, e o escolhido vira o filtro `body {caminho} = {valor}`.
 */
@Component({
  selector: 'app-field-picker',
  template: `
    <button type="button" class="open" [attr.aria-expanded]="open()" (click)="open.set(!open())">
      <ng-container i18n>Filter by a field…</ng-container>
    </button>
    @if (open()) {
      <div class="panel">
        <input
          #box
          class="search"
          type="search"
          aria-label="Filter fields"
          i18n-aria-label
          placeholder="Filter fields"
          i18n-placeholder
          [value]="query()"
          (input)="query.set(box.value)"
        />
        <div class="fields">
          @for (field of shown(); track field.path) {
            <button type="button" class="field" (click)="pick(field)">
              <code>{{ field.path }}</code
              >: {{ field.shown }}
            </button>
          } @empty {
            <p class="none" i18n>No field matches the filter.</p>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 8px;
    }

    button {
      min-height: 32px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--mat-sys-corner-small);
      background: none;
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-large);
      text-align: left;
      cursor: pointer;

      &:focus-visible {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }

    .search {
      box-sizing: border-box;
      width: 100%;
      height: 36px;
      margin: 8px 0;
      padding: 0 12px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: var(--mat-sys-corner-extra-small);
      background: transparent;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-medium);
    }

    .fields {
      display: flex;
      flex-direction: column;
      max-height: 240px;
      overflow: auto;
    }

    .field {
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-medium);
      overflow-wrap: anywhere;
    }

    code {
      font-family: var(--app-code-family);
    }

    .none {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class FieldPicker {
  private readonly chips = inject(FilterChips);

  readonly request = input.required<CapturedRequest>();

  protected readonly open = signal(false);
  protected readonly query = signal('');
  private readonly fields = computed(() => bodyFields(this.request().content));
  protected readonly shown = computed(() => {
    const wanted = this.query().trim().toLowerCase();
    return this.fields().filter(
      ({ path, shown }) =>
        !wanted || path.toLowerCase().includes(wanted) || shown.toLowerCase().includes(wanted),
    );
  });

  protected pick(field: BodyField): void {
    this.chips.filterByValue({ kind: 'body', name: field.path, value: field.value });
    this.open.set(false);
  }
}
