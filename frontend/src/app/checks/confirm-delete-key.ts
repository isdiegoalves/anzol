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

/** Confirmação de apagar uma chave de cifra: o que ainda vier cifrado para ela deixa de abrir. */
@Component({
  selector: 'app-confirm-delete-key',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 i18n mat-dialog-title>Delete key {{ kid }}?</h2>
    <mat-dialog-content>
      <p i18n>
        Requests encrypted to <code>{{ kid }}</code> from now on are recorded as unknown key and are
        not decrypted. The private key is erased and can't be recovered.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button i18n mat-flat-button type="button" [mat-dialog-close]="false">Cancel</button>
      <button i18n mat-button type="button" [mat-dialog-close]="true">Delete key</button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDeleteKey {
  protected readonly kid = inject<string>(MAT_DIALOG_DATA);
}

/** Abre a confirmação (com o `MatDialog`, sob demanda) e diz se o usuário confirmou. */
export async function confirmDeleteKey(injector: Injector, kid: string): Promise<boolean> {
  const ref = injector.get(MatDialog).open<ConfirmDeleteKey, string, boolean>(ConfirmDeleteKey, {
    data: kid,
    width: 'min(480px, calc(100vw - 32px))',
    maxWidth: '100vw',
  });
  return (await firstValueFrom(ref.afterClosed())) === true;
}
