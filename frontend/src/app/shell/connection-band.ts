import { Component, computed, inject } from '@angular/core';
import { Connection } from '../realtime/connection-store';
import { LiveRegion } from '../ui/live-region';

/**
 * A faixa "sem conexão", abaixo do cabeçalho da URL (B1, UX-16): a região viva `status
 * "Connection"` existe vazia desde a carga e recebe a frase uma vez. A contagem da próxima tentativa
 * fica fora dela (`aria-hidden`), para não ser dita a cada segundo; "Try again now" tenta na hora.
 */
@Component({
  selector: 'app-connection-band',
  imports: [LiveRegion],
  template: `
    <app-live-region class="notice" label="Connection" i18n-label [text]="connection.notice()" />
    @if (connection.downSince()) {
      <span class="countdown" aria-hidden="true">{{ countdown() }}</span>
      <button type="button" class="retry" (click)="connection.retry()">
        <span i18n>Try again now</span>
      </button>
    }
  `,
  styleUrl: './connection-band.scss',
  host: {
    '[class.down]': '!!connection.downSince()',
    '[class.shown]': '!!connection.notice()',
  },
})
export class ConnectionBand {
  protected readonly connection = inject(Connection);

  protected readonly countdown = computed(() => {
    const seconds = this.connection.countdown();
    return seconds > 0 ? $localize`Trying again in ${seconds}:seconds: s` : '';
  });
}
