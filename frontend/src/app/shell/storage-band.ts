import { Component, inject } from '@angular/core';
import { StorageNotice } from '../realtime/storage-store';
import { LiveRegion } from '../ui/live-region';

/**
 * A faixa "armazenamento cheio", abaixo da de conexão: a região viva `status "Storage"` existe vazia
 * desde a carga e recebe a frase uma vez. Só texto: liberar espaço é de quem opera o servidor.
 */
@Component({
  selector: 'app-storage-band',
  imports: [LiveRegion],
  template: `<app-live-region label="Storage" i18n-label [text]="storage.notice()" />`,
  styleUrl: './storage-band.scss',
  host: {
    '[class.full]': 'storage.full()',
    '[class.shown]': '!!storage.notice()',
  },
})
export class StorageBand {
  protected readonly storage = inject(StorageNotice);
}
