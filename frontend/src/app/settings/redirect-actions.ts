import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { RedirectDialog } from './redirect-dialog';

/**
 * "Settings..." do redirect pelo navegador (Outbound › Forward from this browser). Fica num chunk
 * carregado no primeiro clique, por `import()`.
 */
@Injectable({ providedIn: 'root' })
export class RedirectActions {
  private readonly dialog = inject(MatDialog);

  openSettings(): void {
    this.dialog.open(RedirectDialog, { width: '600px' });
  }
}
