import { NgTemplateOutlet } from '@angular/common';
import { Component, TemplateRef, computed, input } from '@angular/core';
import { CodeMark, CodeToken, codeLines } from './code-lines';

/**
 * Corpo, schema ou resposta em bloco de código, com a fonte de dados e o número da linha (por
 * contador de CSS: não entra no texto copiado nem no que o leitor de tela lê). JSON sai formatado e
 * realçado sem o highlight.js; `marks` põe a mensagem (erro de schema) embaixo da linha do seu JSON
 * Pointer. O bloco rola sozinho e recebe foco para rolar pelo teclado (WCAG 2.1.1).
 */
@Component({
  selector: 'app-code-view',
  imports: [NgTemplateOutlet],
  // O bloco é uma região com nome (o `aria-label` num `<pre>` sem papel o leitor não lê, §8.2).
  template: `<pre
    class="code"
    [class.values]="!!valueTemplate()"
    role="region"
    tabindex="0"
    [attr.aria-label]="label()"
  ><code>@for (line of lines(); track $index) {<span class="line" [class.marked]="line.marks.length > 0">@for (token of line.tokens; track $index) {@if (token.path && valueTemplate(); as value) {<span [class]="'t-' + token.kind"><ng-container [ngTemplateOutlet]="value" [ngTemplateOutletContext]="{ $implicit: token }" /></span>} @else {<span [class]="'t-' + token.kind">{{ token.text }}</span>}}</span>@for (message of line.marks; track $index) {<span class="mark">{{ message }}</span>}} @empty {<span class="line empty">{{ emptyText() }}</span>}</code></pre>`,
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
  /** F1: o que desenha cada valor escalar do JSON formatado (o valor clicável da Entrada). */
  readonly valueTemplate = input<TemplateRef<{ $implicit: CodeToken }> | null>(null);

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
