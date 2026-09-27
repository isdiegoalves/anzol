import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

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
  /** O título da nota, acima da frase ("Verified signature header", INBOX-24). */
  title?: string;
  /** Um link depois da frase (a seção de Checks que explica a verificação). */
  link?: { text: string; commands: readonly string[]; section: string };
}

/**
 * Tabela nome → valor (Headers, Query, Form, headers do Outbound). `notes` realça linhas pelo nome,
 * com a frase embaixo do valor (e o valor em partes, se a nota as trouxer); o nome acessível da
 * tabela vem de `label`, e `columns`, quando vem, dá o cabeçalho das duas colunas.
 */
@Component({
  selector: 'app-kv-table',
  imports: [RouterLink],
  template: `
    @if (rows().length > 0) {
      <table [attr.aria-label]="label()">
        @if (columns(); as names) {
          <thead>
            <tr>
              <th scope="col">{{ names[0] }}</th>
              <th scope="col">{{ names[1] }}</th>
            </tr>
          </thead>
        }
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
                  @if (note.title) {
                    <strong class="note-title">{{ note.title }}</strong>
                  }
                  <span class="note">{{ note.text }}</span>
                  @if (note.link; as link) {
                    <a
                      class="note-link"
                      [routerLink]="link.commands"
                      [queryParams]="{ section: link.section }"
                      >{{ link.text }}</a
                    >
                  }
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
  /** Cabeçalho das colunas ("Name", "Value (as recorded)"); sem ele, a tabela não tem `thead`. */
  readonly columns = input<readonly [string, string] | null>(null);
  /** Frase quando não há linhas. */
  readonly empty = input($localize`Nothing here.`);
}
