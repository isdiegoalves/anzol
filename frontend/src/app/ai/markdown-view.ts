import { Component, computed, input } from '@angular/core';
import { MdInline, parseMarkdown } from './markdown';

/** Trechos de uma linha (texto, `código`, **negrito**), só por interpolação. */
@Component({
  selector: 'app-md-inline',
  template: `
    @for (part of parts(); track $index) {
      @switch (part.kind) {
        @case ('code') {
          <code>{{ part.text }}</code>
        }
        @case ('strong') {
          <strong>{{ part.text }}</strong>
        }
        @default {
          <span>{{ part.text }}</span>
        }
      }
    }
  `,
})
export class MdInlineView {
  readonly parts = input.required<readonly MdInline[]>();
}

/**
 * Texto do modelo como markdown simples. Só interpolação (`{{ }}`): o Angular escapa tudo, então
 * uma tag no texto aparece como texto, nunca como HTML.
 */
@Component({
  selector: 'app-markdown',
  imports: [MdInlineView],
  template: `
    @for (block of blocks(); track $index) {
      @switch (block.kind) {
        @case ('heading') {
          <p class="heading"><app-md-inline [parts]="block.content" /></p>
        }
        @case ('paragraph') {
          <p><app-md-inline [parts]="block.content" /></p>
        }
        @case ('code') {
          <pre><code>{{ block.text }}</code></pre>
        }
        @case ('list') {
          @if (block.ordered) {
            <ol>
              @for (item of block.items; track $index) {
                <li><app-md-inline [parts]="item" /></li>
              }
            </ol>
          } @else {
            <ul>
              @for (item of block.items; track $index) {
                <li><app-md-inline [parts]="item" /></li>
              }
            </ul>
          }
        }
      }
    }
  `,
  styleUrl: './markdown-view.scss',
})
export class MarkdownView {
  readonly text = input.required<string>();

  protected readonly blocks = computed(() => parseMarkdown(this.text()));
}
