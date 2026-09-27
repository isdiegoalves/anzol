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

/** Confirmação do "Delete all requests": diz quantas somem e que não dá para desfazer. */
@Component({
  selector: 'app-confirm-delete-all',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 i18n mat-dialog-title>Delete all requests?</h2>
    <mat-dialog-content>
      <p i18n>
        The {count, plural, =1 {1 request} other {{{ count }} requests}} of this URL will be
        deleted. This can't be undone.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button i18n mat-button type="button" [mat-dialog-close]="false">Cancel</button>
      <button i18n mat-flat-button type="button" [mat-dialog-close]="true">Delete all</button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDeleteAll {
  protected readonly count = inject<number>(MAT_DIALOG_DATA);
}

/** Abre a confirmação (carregada sob demanda, com o `MatDialog`) e diz se o usuário confirmou. */
export async function confirmDeleteAll(injector: Injector, count: number): Promise<boolean> {
  const ref = injector
    .get(MatDialog)
    .open<ConfirmDeleteAll, number, boolean>(ConfirmDeleteAll, { data: count, width: '420px' });
  return (await firstValueFrom(ref.afterClosed())) === true;
}
