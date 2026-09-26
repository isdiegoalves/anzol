import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RequestStore } from '../requests/request-store';
import { TokenSettings } from './token';
import { TokenDialog, TokenDialogData } from './token-dialog';
import { TokenStore } from './token-store';

/**
 * Fluxos "New" e "Edit" da barra superior. Fica num chunk carregado no primeiro clique: diálogo,
 * formulários e overlay não pesam na carga inicial.
 */
@Injectable({ providedIn: 'root' })
export class TokenActions {
  private readonly tokens = inject(TokenStore);
  private readonly requests = inject(RequestStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  async createUrl(): Promise<void> {
    const settings = await this.askSettings('create');
    if (!settings) {
      return;
    }
    try {
      const token = await this.tokens.create(settings);
      this.requests.resetUnread();
      await this.router.navigate(['/', token.uuid]);
      this.snackBar.open('New URL created');
    } catch (error) {
      this.snackBar.open(creationError(error), undefined, { duration: 10000 });
    }
  }

  async editUrl(): Promise<void> {
    const token = this.tokens.token();
    const settings = await this.askSettings('edit');
    if (!settings || !token) {
      return;
    }
    await this.tokens.update(token.uuid, settings);
    this.snackBar.open('URL updated!');
  }

  private askSettings(mode: TokenDialogData['mode']): Promise<TokenSettings | undefined> {
    const dialog = this.dialog.open<TokenDialog, TokenDialogData, TokenSettings>(TokenDialog, {
      data: { mode, token: this.tokens.token() },
      width: '600px',
    });
    return firstValueFrom(dialog.afterClosed());
  }
}

/** Mesma mensagem do app atual: erros de validação (422) juntos, ou o status HTTP. */
export function creationError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    const messages = Object.values(error.error as Record<string, string[]>).flat();
    return `Error creating token: ${messages.join(', ')}`;
  }
  const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
  return `Error creating token (${status})`;
}
