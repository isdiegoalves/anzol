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

/** Confirmação do "Delete URL": diz o que some junto e que não dá para desfazer. */
@Component({
  selector: 'app-confirm-delete-url',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 i18n mat-dialog-title>Delete this URL?</h2>
    <mat-dialog-content>
      <p i18n>
        The URL <code>{{ url }}</code> stops receiving, and its requests, rules and history are
        deleted. This can't be undone. A new URL opens in its place.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button i18n mat-button type="button" [mat-dialog-close]="false">Cancel</button>
      <button i18n mat-flat-button type="button" [mat-dialog-close]="true">Delete URL</button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDeleteUrl {
  protected readonly url = inject<string>(MAT_DIALOG_DATA);
}

/** Abre a confirmação (carregada sob demanda, com o `MatDialog`) e diz se o usuário confirmou. */
export async function confirmDeleteUrl(injector: Injector, url: string): Promise<boolean> {
  const ref = injector
    .get(MatDialog)
    .open<ConfirmDeleteUrl, string, boolean>(ConfirmDeleteUrl, { data: url, width: '480px' });
  return (await firstValueFrom(ref.afterClosed())) === true;
}
