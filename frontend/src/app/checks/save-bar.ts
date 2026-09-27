import { Component, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';

/** Aviso depois de salvar: "Saved." ou o erro do servidor. */
export interface SaveNotice {
  text: string;
  error: boolean;
}

/**
 * Barra de salvar de um cartão de Checks (S12). O botão nunca fica desabilitado. O que falta vai
 * num `status` desde o começo ("To save, fill in: …"); depois de tentar salvar, o mesmo resumo
 * passa a um `alert` e o botão aponta para ele (`aria-describedby`). O resto das ações do cartão
 * (Discard, "Send a signed test") vem por projeção, antes do botão.
 */
@Component({
  selector: 'app-save-bar',
  imports: [MatButton],
  template: `
    @let pendingId = name() + '-pending';
    @let alerting = attempted() && summary() !== '';
    @let result = notice();
    <div class="notes">
      <p
        class="note"
        role="status"
        [id]="alerting ? null : pendingId"
        [textContent]="alerting ? '' : summary() || (result && !result.error ? result.text : '')"
      ></p>
      @if (alerting || result?.error) {
        <p
          class="note error"
          role="alert"
          [id]="alerting ? pendingId : null"
          [textContent]="alerting ? summary() : (result?.text ?? '')"
        ></p>
      }
    </div>
    <div class="actions">
      <ng-content />
      <button
        mat-flat-button
        type="button"
        [attr.aria-describedby]="summary() ? pendingId : null"
        (click)="save.emit()"
      >
        {{ label() }}
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
  readonly attempted = input(false);
  readonly notice = input<SaveNotice | null>(null);
  readonly save = output<void>();
}
