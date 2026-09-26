import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { WebhookRequest } from '../requests/webhook-request';
import { TokenStore } from '../token/token-store';
import { Preferences } from './preferences';
import { Redirector } from './redirect';

/** Opções acima do detalhe: redirect, CORS, formatar JSON/XML, auto-navegar, ocultar detalhes. */
@Component({
  selector: 'app-options-bar',
  imports: [MatSlideToggle, MatButton],
  templateUrl: './options-bar.html',
  styleUrl: './options-bar.scss',
})
export class OptionsBar {
  protected readonly preferences = inject(Preferences);
  protected readonly tokens = inject(TokenStore);
  private readonly redirector = inject(Redirector);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly request = input<WebhookRequest>();

  protected async openRedirectSettings(): Promise<void> {
    const { RedirectDialog } = await import('./redirect-dialog');
    this.dialog.open(RedirectDialog, { width: '600px' });
  }

  protected redirectNow(): void {
    const request = this.request();
    if (request) {
      void this.redirector.redirect(request);
    }
  }

  protected async toggleCors(): Promise<void> {
    const token = this.tokens.token();
    if (!token) {
      return;
    }
    try {
      const enabled = await this.tokens.toggleCors(token.uuid);
      this.snackBar.open(enabled ? 'CORS enabled.' : 'CORS disabled.', undefined, {
        duration: 1000,
      });
    } catch (error) {
      const message =
        error instanceof HttpErrorResponse ? (error.error?.error?.message ?? error.message) : '';
      this.snackBar.open(`Could not toggle CORS: ${message}`, undefined, { duration: 1000 });
    }
  }
}
