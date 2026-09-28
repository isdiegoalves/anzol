import { Component, computed, input } from '@angular/core';
import { Icon } from '../ui/icon';

/** Aviso do cartão: "Saved." ou o que ele tem a dizer sobre o salvo. */
export interface CardNotice {
  text: string;
  error: boolean;
}

/**
 * Pé de um cartão de Verificações. O salvar é da barra da página (B3, uma barra só); aqui fica o
 * que é do cartão: o resumo do que falta num `status` desde o começo ("To save, fill in: …", S12)
 * ou o aviso dele ("Saved. Leave the secret blank to keep it."), e as ações do cartão por projeção
 * ("Send a signed test").
 */
@Component({
  selector: 'app-card-foot',
  imports: [Icon],
  template: `
    @let result = notice();
    @let saved = !summary() && !!result && !result.error;
    <p class="note" [class.ok]="saved" [class.error]="!summary() && result?.error" role="status">
      @if (text()) {
        <app-icon [name]="saved ? 'ok' : 'info'" [size]="16" />
      }
      <span [id]="name() + '-pending'" [textContent]="text()"></span>
    </p>
    <div class="actions"><ng-content /></div>
  `,
  styleUrl: './card-foot.scss',
})
export class CardFoot {
  /** Prefixo do id do resumo (`signature` → `#signature-pending`). */
  readonly name = input.required<string>();
  readonly summary = input('');
  readonly notice = input<CardNotice | null>(null);

  protected readonly text = computed(() => this.summary() || (this.notice()?.text ?? ''));
}
