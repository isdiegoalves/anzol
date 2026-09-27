import { Component, input } from '@angular/core';

/** Uma linha nome → valor (header, query, campo de formulário). */
export interface KvRow {
  name: string;
  value: string;
}

/** Tom e frase de uma linha realçada (ex.: o header da assinatura). */
export interface KvNote {
  tone: 'ok' | 'bad' | 'near';
  text: string;
  /** O valor em partes, uma por linha (o header de assinatura: `t=…`, `v1=…`). */
  parts?: readonly string[];
}

/**
 * Tabela nome → valor (Headers, Query, Form, headers do Outbound). `notes` realça linhas pelo nome,
 * com a frase embaixo do valor (e o valor em partes, se a nota as trouxer); o nome acessível da
 * tabela vem de `label`.
 */
@Component({
  selector: 'app-kv-table',
  template: `
    @if (rows().length > 0) {
      <table [attr.aria-label]="label()">
        <tbody>
          @for (row of rows(); track $index) {
            @let note = notes().get(row.name);
            <tr [class]="note ? 'noted ' + note.tone : ''">
              <th scope="row">{{ row.name }}</th>
              <td>
                @if (note?.parts; as parts) {
                  <span class="parts">
                    @for (part of parts; track $index) {
                      <code>{{ part }}</code>
                    }
                  </span>
                } @else {
                  <code>{{ row.value === '' ? '(empty)' : row.value }}</code>
                }
                @if (note) {
                  <span class="note">{{ note.text }}</span>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    } @else {
      <p class="empty">{{ empty() }}</p>
    }
  `,
  styleUrl: './kv-table.scss',
})
export class KvTable {
  readonly label = input.required<string>();
  readonly rows = input.required<readonly KvRow[]>();
  readonly notes = input<ReadonlyMap<string, KvNote>>(new Map());
  /** Frase quando não há linhas. */
  readonly empty = input('Nothing here.');
}
