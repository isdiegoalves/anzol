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
import { E2eeBinding, LabCreated } from '../token/token';
import { Icon } from '../ui/icon';

/** Os segredos da URL de laboratório recém-criada, que o servidor não mostra de novo. */
@Component({
  selector: 'app-lab-secrets-dialog',
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
    <h2 i18n mat-dialog-title>Lab URL created</h2>
    <mat-dialog-content>
      <p class="warning" i18n>
        Copy the secrets now: the server shows them only this once, and they don't come back.
      </p>
      <dl class="secrets">
        <div class="secret">
          <dt i18n>Read secret</dt>
          <dd class="value">
            <code>{{ lab.read_secret }}</code>
            <button
              mat-button
              type="button"
              [attr.aria-label]="copyReadLabel"
              [cdkCopyToClipboard]="lab.read_secret"
              (cdkCopyToClipboardCopied)="copied(copyReadDone)"
            >
              <app-icon name="copy" [size]="18" /><ng-container i18n>Copy</ng-container>
            </button>
          </dd>
          <dd class="hint" i18n>
            Opens this URL in another browser (unlock screen) or in the API (X-Anzol-Secret header).
          </dd>
        </div>
        <div class="secret">
          <dt i18n>HMAC secret</dt>
          <dd class="value">
            <code>{{ lab.hmac_secret }}</code>
            <button
              mat-button
              type="button"
              [attr.aria-label]="copyHmacLabel"
              [cdkCopyToClipboard]="lab.hmac_secret"
              (cdkCopyToClipboardCopied)="copied(copyHmacDone)"
            >
              <app-icon name="copy" [size]="18" /><ng-container i18n>Copy</ng-container>
            </button>
          </dd>
          <dd class="hint" i18n>
            Signs the requests you send yourself: HMAC-SHA256 of the body, in hex, in the
            {{ lab.hmac_header }} header.
          </dd>
          <dd class="hint" i18n>
            Without it, the URL answers 401 and does not decrypt (hmac_failed).
          </dd>
        </div>
      </dl>
      @if (own; as own) {
        <section class="own" aria-labelledby="lab-own-title">
          <h3 id="lab-own-title" i18n>To send your own message</h3>
          <ul>
            <li i18n>
              Audience: <code>{{ own.audience }}</code>
            </li>
            <li i18n>
              Encrypted attribute: <code>{{ own.path }}</code>
            </li>
            <li i18n>
              Bindings: <code>{{ own.jti }}</code
              >, <code>{{ own.evt }}</code
              >,
              <code>{{ own.app }}</code>
            </li>
            <li i18n>
              Paste your public signing key in Trusted signers; the test sender
              <code>{{ own.signer }}</code> stays.
            </li>
          </ul>
        </section>
      }
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

    .own {
      margin-top: 20px;

      h3 {
        margin: 0 0 4px;
        font: var(--mat-sys-title-small);
      }

      ul {
        margin: 0;
        padding-left: 20px;
      }

      code {
        font: 13px / 1.5 var(--app-code-family);
        overflow-wrap: anywhere;
      }
    }
  `,
})
export class LabSecretsDialog {
  private readonly snackBar = inject(MatSnackBar);
  protected readonly lab = inject<LabCreated>(MAT_DIALOG_DATA);

  /** O que o remetente de verdade precisa para mandar para o laboratório, lido da URL criada. */
  protected readonly own = ownMessage(this.lab);

  protected readonly copyReadLabel = $localize`Copy read secret`;
  protected readonly copyHmacLabel = $localize`Copy HMAC secret`;
  protected readonly copyReadDone = $localize`Copied the read secret`;
  protected readonly copyHmacDone = $localize`Copied the HMAC secret`;

  protected copied(message: string): void {
    this.snackBar.open(message, undefined, { duration: 1000 });
  }
}

function ownMessage(lab: LabCreated) {
  const policy = lab.token.e2ee;
  if (!policy) {
    return null;
  }
  const path = (binding: E2eeBinding) => (typeof binding === 'object' ? binding.path : binding);
  return {
    audience: policy.audience,
    path: policy.path,
    jti: path(policy.bindings.jti),
    evt: path(policy.bindings.evt),
    app: path(policy.bindings.app),
    signer: lab.token.lab?.signer_kid ?? '',
  };
}

/** Mostra os segredos (com o `MatDialog`, sob demanda) e espera o diálogo fechar. */
export async function showLabSecrets(injector: Injector, lab: LabCreated): Promise<void> {
  const ref = injector.get(MatDialog).open(LabSecretsDialog, {
    data: lab,
    width: 'min(560px, calc(100vw - 32px))',
    maxWidth: '100vw',
  });
  await firstValueFrom(ref.afterClosed());
}
