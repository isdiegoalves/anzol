import { Component, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Icon } from '../ui/icon';
import { attentionText } from './url-settings';

/** Aviso depois de salvar: "Saved." ou o erro do servidor. */
export interface SaveNotice {
  text: string;
  error: boolean;
  /** Mostra "Reload" (a URL mudou em outro lugar). */
  reload?: boolean;
}

/**
 * Barra de salvar de um cartão de Checks (S12). O botão nunca fica desabilitado. O que falta vai
 * num `status` desde o começo ("To save, fill in: …"); depois de tentar salvar, um `alert` diz
 * quantos campos e quais ("2 fields need attention: …", CHECKS-13) e o botão aponta para ele
 * (`aria-describedby`). O resto das ações do cartão
 * (Discard, "Send a signed test") vem por projeção, antes do botão.
 */
@Component({
  selector: 'app-save-bar',
  imports: [Icon, MatButton],
  template: `
    @let pendingId = name() + '-pending';
    @let alerting = attempted() && summary() !== '';
    @let result = notice();
    @let statusText = alerting ? '' : summary() || (result && !result.error ? result.text : '');
    @let saved = !alerting && !summary() && !!result && !result.error;
    <div class="notes">
      <p class="note" [class.ok]="saved" role="status" [id]="alerting ? null : pendingId">
        @if (statusText) {
          <app-icon [name]="saved ? 'ok' : 'info'" [size]="16" />
        }
        <span [textContent]="statusText"></span>
      </p>
      @if (alerting || result?.error) {
        <p class="note error" role="alert" [id]="alerting ? pendingId : null">
          <app-icon name="bad" [size]="16" /><span
            [textContent]="alerting ? attention() : (result?.text ?? '')"
          ></span>
        </p>
      }
    </div>
    <div class="actions">
      @if (result?.reload) {
        <button mat-stroked-button type="button" (click)="reload.emit()" i18n>Reload</button>
      }
      <ng-content />
      <button
        mat-flat-button
        type="button"
        [attr.aria-describedby]="summary() ? pendingId : null"
        (click)="save.emit()"
      >
        <app-icon name="check" [size]="18" />{{ label() }}
      </button>
    </div>
  `,
  styleUrl: './save-bar.scss',
})
export class SaveBar {
  /** Nome único do botão na página ("Save signature"). */
  readonly label = input.required<string>();
  /** Prefixo do id do resumo (`signature` → `#signature-pending`). */
  readonly name = input.required<string>();
  readonly summary = input('');
  /** Rótulos dos campos pendentes: o alerta, depois de tentar, diz quantos e quais (CHECKS-13). */
  readonly pendingLabels = input<readonly string[]>([]);
  readonly attempted = input(false);
  readonly notice = input<SaveNotice | null>(null);
  readonly save = output<void>();
  readonly reload = output<void>();

  protected attention(): string {
    const labels = this.pendingLabels();
    return labels.length > 0 ? attentionText(labels) : this.summary();
  }
}
