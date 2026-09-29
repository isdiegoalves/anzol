import { Component, computed, input } from '@angular/core';
import { Icon } from '../ui/icon';

export interface CardNotice {
  text: string;
  error: boolean;
}

@Component({
  selector: 'app-card-foot',
  imports: [Icon],
  template: `
    @let result = notice();
    @let saved = !summary() && !!result && !result.error;
    <!-- Não é região viva: a alteração e o salvar são falados pela barra de salvar. -->
    <p class="note" [class.ok]="saved" [class.error]="!summary() && result?.error">
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
  readonly name = input.required<string>();
  readonly summary = input('');
  readonly notice = input<CardNotice | null>(null);

  protected readonly text = computed(() => this.summary() || (this.notice()?.text ?? ''));
}
