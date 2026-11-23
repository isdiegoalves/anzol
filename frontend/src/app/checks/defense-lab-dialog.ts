import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
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
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { Icon } from '../ui/icon';
import { NOTICE_MS, copyFailedText } from '../ui/notice';
import { DefenseLabCreated, briefingText } from './defense-lab';

/** O segredo de leitura e o briefing da URL recém-criada, que o servidor não mostra de novo. */
@Component({
  selector: 'app-defense-lab-dialog',
  imports: [
    CdkCopyToClipboard,
    Icon,
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
  ],
  template: `
    <h2 i18n mat-dialog-title>Defense lab URL created</h2>
    <mat-dialog-content>
      <p class="warning" i18n>
        Copy the read secret now: the server shows it only this once. Your agent needs it to read
        the requests through the API or MCP.
      </p>
      <dl class="secrets">
        <div class="secret">
          <dt i18n>Read secret</dt>
          <dd class="value">
            <code>{{ lab.read_secret }}</code>
            <button
              mat-button
              type="button"
              [attr.aria-label]="copyLabel"
              [cdkCopyToClipboard]="lab.read_secret"
              (cdkCopyToClipboardCopied)="copied($event)"
            >
              <app-icon name="copy" [size]="18" /><ng-container i18n>Copy</ng-container>
            </button>
          </dd>
        </div>
        <div class="secret">
          <dt i18n>Briefing</dt>
          <dd class="hint">{{ briefing }}</dd>
          <dd class="hint" i18n>
            This browser keeps the briefing in the card; it comes from the server only now.
          </dd>
        </div>
      </dl>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button i18n mat-flat-button type="button" mat-dialog-close>Open the lab URL</button>
    </mat-dialog-actions>
  `,
  styles: `
    .warning {
      margin: 0 0 16px;
      padding: 8px 14px 8px 12px;
      border-left: var(--app-note-rule) solid var(--app-warning);
      background: var(--app-warning-container);
      color: var(--app-on-warning-container);
    }

    .secrets {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin: 0;
    }

    dt {
      font: var(--mat-sys-label-large);
    }

    dd {
      margin: 0;
    }

    .value {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;

      code {
        font: 13px / 1.5 var(--app-code-family);
        overflow-wrap: anywhere;
      }
    }

    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class DefenseLabDialog {
  private readonly snackBar = inject(MatSnackBar);
  protected readonly lab = inject<DefenseLabCreated>(MAT_DIALOG_DATA);
  protected readonly briefing = briefingText(this.lab.briefing);
  protected readonly copyLabel = $localize`Copy read secret`;

  protected copied(done: boolean): void {
    this.snackBar.open(done ? $localize`Copied the read secret` : copyFailedText(), undefined, {
      duration: NOTICE_MS,
    });
  }
}

/** Mostra o segredo e o briefing (com o `MatDialog`, sob demanda) e espera o diálogo fechar. */
export async function showDefenseLab(injector: Injector, lab: DefenseLabCreated): Promise<void> {
  const ref = injector.get(MatDialog).open(DefenseLabDialog, {
    data: lab,
    width: 'min(560px, calc(100vw - 32px))',
    maxWidth: '100vw',
  });
  await firstValueFrom(ref.afterClosed());
}
