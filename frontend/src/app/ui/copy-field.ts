import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { Component, input, output } from '@angular/core';
import { Icon } from './icon';

/**
 * Valor só-leitura com o botão de copiar (a URL do cabeçalho). Clicar ou Enter no campo seleciona
 * tudo, como a barra de hoje. Como no protótipo C (INBOX-05): o ícone de link antes do valor e o
 * copiar só com o ícone, com o nome acessível ("Copy") e a dica no `title`.
 */
@Component({
  selector: 'app-copy-field',
  imports: [CdkCopyToClipboard, Icon],
  template: `
    <app-icon class="link" name="link" [size]="18" />
    <input
      class="value"
      type="text"
      readonly
      [attr.aria-label]="label()"
      [value]="value()"
      (click)="selectAll($event)"
      (keyup.enter)="selectAll($event)"
    />
    @if (disabled()) {
      <!-- Desligado continua focável (aria-disabled) e não copia. -->
      <button type="button" class="copy" aria-disabled="true" [attr.aria-label]="buttonLabel()">
        <app-icon name="copy" [size]="20" />
      </button>
    } @else {
      <button
        type="button"
        class="copy"
        [attr.aria-label]="buttonLabel()"
        [attr.title]="hint()"
        [cdkCopyToClipboard]="value()"
        (cdkCopyToClipboardCopied)="copied.emit($event)"
      >
        <app-icon name="copy" [size]="20" />
      </button>
    }
  `,
  styleUrl: './copy-field.scss',
  host: { '[class.disabled]': 'disabled()' },
})
export class CopyField {
  readonly value = input.required<string>();
  /** Nome acessível do campo ("Webhook URL"). */
  readonly label = input.required<string>();
  readonly buttonLabel = input($localize`Copy`);
  /** Dica do botão, como o atalho ("Copy URL (C)"). */
  readonly hint = input<string | null>(null);
  /** O endereço de uma URL que não existe mais: riscado, e o botão não copia. */
  readonly disabled = input(false);
  /** `true` quando a cópia deu certo. */
  readonly copied = output<boolean>();

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }
}
