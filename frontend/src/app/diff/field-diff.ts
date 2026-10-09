import { Component, input } from '@angular/core';
import { FieldRow } from './request-diff';

const STATUS_LABELS: Record<FieldRow['status'], string> = {
  equal: $localize`same`,
  different: $localize`changed`,
  'only-a': $localize`only in A`,
  'only-b': $localize`only in B`,
};

/** Tabela nome / A / B de uma seção da comparação (Request, Query, Headers). */
@Component({
  selector: 'app-field-diff',
  template: `
    <table class="fields" [attr.aria-label]="label()">
      <thead>
        <tr>
          <th i18n class="name">Name</th>
          <th i18n>A</th>
          <th i18n>B</th>
          <th i18n class="status">Status</th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.name) {
          <tr [class]="row.status">
            <td class="name">{{ row.name }}</td>
            <td class="value">
              @if (row.a !== null) {
                <code>{{ row.a === '' ? emptyValue : row.a }}</code>
              }
            </td>
            <td class="value">
              @if (row.b !== null) {
                <code>{{ row.b === '' ? emptyValue : row.b }}</code>
              }
            </td>
            <td class="status">
              {{ statusLabels[row.status] }}
              @if (row.status !== 'equal' && noise().has(row.name.toLowerCase())) {
                <span i18n class="noise">· changes every event</span>
              }
            </td>
          </tr>
        } @empty {
          <tr>
            <td class="none" colspan="4">{{ empty() }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: './field-diff.scss',
})
export class FieldDiff {
  readonly label = input.required<string>();
  readonly rows = input.required<FieldRow[]>();
  /** Texto da tabela sem linhas ("(empty)", ou "No differences" no "Only differences"). */
  readonly empty = input.required<string>();
  /** Nomes (minúsculos) que mudam a cada entrega do provedor: a linha diz isso (S9). */
  readonly noise = input<ReadonlySet<string>>(new Set());

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly emptyValue = $localize`(empty)`;
}
