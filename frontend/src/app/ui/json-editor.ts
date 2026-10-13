import { Component, computed, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { JsonColors } from './json-colors';

/**
 * Editor de JSON de formulário: a `textarea` com o número de cada linha e as cores do
 * `app-json-colors`, também com o JSON pela metade, enquanto se digita.
 */
@Component({
  selector: 'app-json-editor',
  imports: [JsonColors],
  template: `<pre class="gutter" aria-hidden="true" #gutter>{{ lineNumbers() }}</pre>
    <app-json-colors class="text" partial [text]="text()">
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
        (scroll)="gutter.scrollTop = textarea.scrollTop"
      ></textarea>
    </app-json-colors>`,
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
}
