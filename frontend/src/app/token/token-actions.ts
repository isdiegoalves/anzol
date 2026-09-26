import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RequestStore } from '../requests/request-store';
import { Token, TokenSettings } from './token';
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
      this.snackBar.open(settingsError('creating', error), undefined, { duration: 10000 });
    }
  }

  async editUrl(): Promise<void> {
    const token = this.tokens.token();
    const settings = await this.askSettings('edit');
    if (!settings || !token) {
      return;
    }
    try {
      const updated = await this.tokens.update(token.uuid, settings);
      this.snackBar.open('URL updated!');
      if (cutsRequests(token, updated)) {
        await this.reloadRequests();
      }
    } catch (error) {
      this.snackBar.open(settingsError('updating', error), undefined, { duration: 10000 });
    }
  }

  /** O corte feito no `PUT` não gera evento: a lista vem de novo do servidor. */
  private async reloadRequests(): Promise<void> {
    const replacement = await this.requests.reload();
    if (replacement) {
      const page = this.requests.pageOf(replacement.uuid);
      await this.router.navigate(['/', replacement.token_id, replacement.uuid, page], {
        replaceUrl: true,
      });
    }
  }

  private askSettings(mode: TokenDialogData['mode']): Promise<TokenSettings | undefined> {
    const dialog = this.dialog.open<TokenDialog, TokenDialogData, TokenSettings>(TokenDialog, {
      data: { mode, token: this.tokens.token() },
      width: '600px',
    });
    return firstValueFrom(dialog.afterClosed());
  }
}

/** Ligar a limpeza automática, ou reduzir o limite, faz o servidor cortar as mais antigas. */
function cutsRequests(before: Token, after: Token): boolean {
  const limit = after.auto_cleanup ?? null;
  const previous = before.auto_cleanup ?? null;
  return limit !== null && (previous === null || limit < previous);
}

/** Mesma mensagem do app atual: erros de validação (422) juntos, ou o status HTTP. */
export function settingsError(action: 'creating' | 'updating', error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    const messages = Object.values(error.error as Record<string, string[]>).flat();
    return `Error ${action} token: ${messages.join(', ')}`;
  }
  const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
  return `Error ${action} token (${status})`;
}
