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

export type LeaveChoice = 'keep' | 'discard' | 'save';

@Component({
  selector: 'app-checks-leave-dialog',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title i18n>Discard changes?</h2>
    <mat-dialog-content>
      <!-- prettier-ignore -->
      <p i18n>{lines.length, plural, =1 {Checks has 1 unsaved change:} other {Checks has {{ lines.length }} unsaved changes:}}</p>
      <ul>
        @for (line of lines; track line) {
          <li>{{ line }}</li>
        }
      </ul>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="actions">
      <!-- prettier-ignore -->
      <button mat-flat-button type="button" class="safe" mat-dialog-close="keep" i18n>Keep editing</button>
      <button mat-button type="button" mat-dialog-close="discard" i18n>Discard</button>
      <button mat-button type="button" mat-dialog-close="save" i18n>Save and leave</button>
    </mat-dialog-actions>
  `,
  styles: `
    ul {
      margin: 0;
      padding-left: 20px;
      overflow-wrap: anywhere;
    }

    @media (width < 600px) {
      .actions {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
      }
    }
  `,
})
export class ChecksLeaveDialog {
  protected readonly lines = inject<readonly string[]>(MAT_DIALOG_DATA);
}

export async function askToLeave(
  injector: Injector,
  lines: readonly string[],
): Promise<LeaveChoice> {
  const ref = injector
    .get(MatDialog)
    .open<ChecksLeaveDialog, readonly string[], LeaveChoice>(ChecksLeaveDialog, {
      data: lines,
      autoFocus: '.safe',
      width: 'min(480px, calc(100vw - 32px))',
      maxWidth: '100vw',
    });
  return (await firstValueFrom(ref.afterClosed())) ?? 'keep';
}
