import { Component, Injector, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

/**
 * Confirmação de apagar uma chave de cifra: o que ainda vier cifrado para ela deixa de abrir, o que
 * já abriu fica. A última chave de uma URL que decifra ganha o aviso de que tudo o que vier fica sem
 * chave.
 */
@Component({
  selector: 'app-confirm-delete-key',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 i18n mat-dialog-title>Delete key {{ data.kid }}?</h2>
    <mat-dialog-content>
      <p i18n>
        Requests encrypted to <code>{{ data.kid }}</code> from now on are recorded as Unknown key
        and are not decrypted. The private key is removed from this URL.
      </p>
      <p i18n>
        Requests already decrypted keep their stored value. Old backups of the volume still have the
        private key.
      </p>
      @if (data.last) {
        <p i18n>
          This is the URL's only encryption key: without it, every new encrypted request is recorded
          as Unknown key until you generate another.
        </p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button i18n mat-flat-button type="button" [mat-dialog-close]="false">Cancel</button>
      <button i18n mat-button type="button" [mat-dialog-close]="true">Delete key</button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDeleteKey {
  protected readonly data = inject<DeleteKeyData>(MAT_DIALOG_DATA);
}

/** A chave a apagar; `last` quando é a única de uma URL que decifra. */
export interface DeleteKeyData {
  kid: string;
  last: boolean;
}

/** Abre a confirmação (com o `MatDialog`, sob demanda) e diz se o usuário confirmou. */
export async function confirmDeleteKey(injector: Injector, data: DeleteKeyData): Promise<boolean> {
  const ref = injector
    .get(MatDialog)
    .open<ConfirmDeleteKey, DeleteKeyData, boolean>(ConfirmDeleteKey, {
      data,
      width: 'min(480px, calc(100vw - 32px))',
      maxWidth: '100vw',
    });
  return (await firstValueFrom(ref.afterClosed())) === true;
}
