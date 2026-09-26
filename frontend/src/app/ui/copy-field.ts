import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { Component, input, output } from '@angular/core';
import { Icon } from './icon';

/**
 * Valor só-leitura com o botão de copiar (a URL no cabeçalho, o comando no onboarding). Clicar ou
 * Enter no campo seleciona tudo, como a barra de hoje.
 */
@Component({
  selector: 'app-copy-field',
  imports: [CdkCopyToClipboard, Icon],
  template: `
    <input
      class="value"
      type="text"
      readonly
      [attr.aria-label]="label()"
      [value]="value()"
      (click)="selectAll($event)"
      (keyup.enter)="selectAll($event)"
    />
    <button
      type="button"
      class="copy"
      [attr.title]="hint()"
      [cdkCopyToClipboard]="value()"
      (cdkCopyToClipboardCopied)="copied.emit($event)"
    >
      <app-icon name="copy" [size]="18" />
      <span>{{ buttonLabel() }}</span>
    </button>
  `,
  styleUrl: './copy-field.scss',
})
export class CopyField {
  readonly value = input.required<string>();
  /** Nome acessível do campo ("Webhook URL"). */
  readonly label = input.required<string>();
  readonly buttonLabel = input('Copy');
  /** Dica do botão, como o atalho ("Copy URL (C)"). */
  readonly hint = input<string | null>(null);
  /** `true` quando a cópia deu certo. */
  readonly copied = output<boolean>();

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }
}
