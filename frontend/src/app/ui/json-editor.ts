import { Component, computed, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { jsonTokens } from './json-tokens';

/**
 * Editor de JSON de formulário: a `textarea` com o número de cada linha e, atrás dela, o mesmo texto
 * com as cores do `app-code-view`. Quem lê a tela, digita e seleciona fala só com a `textarea`, que
 * fica com o texto transparente; a camada colorida some no alto contraste.
 */
@Component({
  selector: 'app-json-editor',
  template: `<pre class="gutter" aria-hidden="true" #gutter>{{ lineNumbers() }}</pre>
    <div class="text">
      <pre
        class="colors"
        aria-hidden="true"
      ><code #colors>@for (token of tokens(); track $index) {<span [class]="'t-' + token.kind">{{ token.text }}</span>}</code></pre>
      <textarea
        #textarea
        rows="12"
        wrap="off"
        spellcheck="false"
        [id]="inputId()"
        [value]="text()"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [attr.aria-describedby]="describedBy()"
        (input)="edit(textarea.value)"
        (blur)="touched()"
        (scroll)="follow(textarea, gutter, colors)"
      ></textarea>
    </div>`,
  styleUrl: './json-editor.scss',
  host: { '[class.invalid]': 'invalid()' },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => JsonEditor), multi: true },
  ],
})
export class JsonEditor implements ControlValueAccessor {
  /** O `id` da `textarea`, para o `label` de quem usa. */
  readonly inputId = input.required<string>();
  readonly invalid = input(false);
  readonly describedBy = input<string | null>(null);

  protected readonly text = signal('');
  protected readonly tokens = computed(() => jsonTokens(this.text()));
  protected readonly lineNumbers = computed(() =>
    Array.from({ length: this.text().split('\n').length }, (_, i) => i + 1).join('\n'),
  );
  protected touched: () => void = () => undefined;
  private changed: (text: string) => void = () => undefined;

  writeValue(text: string): void {
    this.text.set(text);
  }

  registerOnChange(changed: (text: string) => void): void {
    this.changed = changed;
  }

  registerOnTouched(touched: () => void): void {
    this.touched = touched;
  }

  protected edit(text: string): void {
    this.text.set(text);
    this.changed(text);
  }

  /** Os números e as cores acompanham a rolagem da `textarea`. */
  protected follow(textarea: HTMLTextAreaElement, gutter: HTMLElement, colors: HTMLElement): void {
    gutter.scrollTop = textarea.scrollTop;
    colors.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
  }
}
