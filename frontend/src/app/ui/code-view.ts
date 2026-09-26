import { Component, computed, input } from '@angular/core';
import { CodeMark, codeLines } from './code-lines';

/**
 * Corpo, schema ou resposta em bloco de código, com a fonte de dados e o número da linha (por
 * contador de CSS: não entra no texto copiado nem no que o leitor de tela lê). JSON sai formatado e
 * realçado sem o highlight.js; `marks` põe a mensagem (erro de schema) embaixo da linha do seu JSON
 * Pointer. O bloco rola sozinho e recebe foco para rolar pelo teclado (WCAG 2.1.1).
 */
@Component({
  selector: 'app-code-view',
  template: `<pre
    class="code"
    tabindex="0"
    [attr.aria-label]="label()"
  ><code>@for (line of lines(); track $index) {<span class="line" [class.marked]="line.marks.length > 0">@for (token of line.tokens; track $index) {<span [class]="'t-' + token.kind">{{ token.text }}</span>}</span>@for (message of line.marks; track $index) {<span class="mark">{{ message }}</span>}} @empty {<span class="line empty">{{ emptyText() }}</span>}</code></pre>`,
  styleUrl: './code-view.scss',
})
export class CodeView {
  readonly text = input.required<string>();
  /** Nome acessível do bloco ("Request body"). */
  readonly label = input.required<string>();
  readonly language = input<'json' | 'text'>('json');
  /** Desligado mostra o JSON como chegou (o "Raw"). */
  readonly pretty = input(true);
  readonly marks = input<readonly CodeMark[]>([]);
  readonly emptyText = input('(no body content)');

  protected readonly lines = computed(() =>
    this.text() === ''
      ? []
      : codeLines(this.text(), {
          json: this.language() === 'json',
          pretty: this.pretty(),
          marks: this.marks(),
        }),
  );
}
