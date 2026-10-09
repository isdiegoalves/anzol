import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RequestStore } from '../requests/request-store';
import { KnownUrls } from './known-urls';
import { TokenSettings } from './token';
import { TokenDialog, TokenDialogData } from './token-dialog';
import { TokenStore } from './token-store';
import { UrlAccess } from './url-access';

/**
 * Fluxos "New URL", "Lock", "Delete URL" e "Copy CLI command" do shell. Fica num chunk carregado no primeiro clique: diálogo,
 * formulários e overlay não pesam na carga inicial. A configuração da URL mora em Checks (o antigo
 * Edit URL deixou de existir, S2).
 */
@Injectable({ providedIn: 'root' })
export class TokenActions {
  private readonly tokens = inject(TokenStore);
  private readonly access = inject(UrlAccess);
  private readonly requests = inject(RequestStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly injector = inject(Injector);
  private readonly known = inject(KnownUrls);

  /** O aviso do "Copy CLI command", que copia no clique (`injectCopyCliCommand`). */
  cliCommandCopied(): void {
    this.snackBar.open($localize`Copied the CLI command.`, undefined, { duration: 1000 });
  }

  async createUrl(): Promise<void> {
    const dialog = this.dialog.open<TokenDialog, TokenDialogData, TokenSettings>(TokenDialog, {
      data: { token: this.tokens.token(), save: (settings) => this.create(settings) },
      width: '600px',
    });
    await firstValueFrom(dialog.afterClosed());
  }

  async createDefaultUrl(): Promise<void> {
    await this.create({});
  }

  async renameUrl(uuid: string): Promise<void> {
    const { renameUrl } = await import('./url-list-dialogs');
    await renameUrl(this.injector, uuid);
  }

  async forgetUrls(): Promise<void> {
    const { forgetUrls } = await import('./url-list-dialogs');
    await forgetUrls(this.injector);
  }

  /** "Lock": tira o acesso deste navegador à URL protegida; a tela de desbloqueio assume. */
  async lockUrl(): Promise<void> {
    const token = this.tokens.token();
    if (token) {
      await this.access.lock(token.uuid);
      this.snackBar.open($localize`URL locked`, undefined, { duration: 4000 });
    }
  }

  /**
   * "Delete URL" (menu da URL, protótipo C): confirma, apaga no servidor (mensagens, regras e
   * histórico vão junto) e abre a próxima URL conhecida; sem nenhuma, cria uma.
   */
  async deleteUrl(): Promise<void> {
    const token = this.tokens.token();
    if (!token) {
      return;
    }
    const { confirmDeleteUrl } = await import('./confirm-delete-url');
    if (!(await confirmDeleteUrl(this.injector, this.tokens.webhookUrl()))) {
      return;
    }
    try {
      await firstValueFrom(this.http.delete(`/token/${token.uuid}`));
      this.known.forget([token.uuid]);
      const [next] = this.known.urls();
      this.requests.resetUnread(token.uuid);
      if (next) {
        const name = this.known.nameOf(next.uuid);
        await this.router.navigate(['/', next.uuid]);
        this.snackBar.open($localize`URL deleted. ${name}:name: is open.`, undefined, {
          duration: 4000,
        });
        return;
      }
      const created = await this.tokens.create();
      await this.router.navigate(['/', created.uuid]);
      this.snackBar.open($localize`URL deleted. A new URL is open.`, undefined, { duration: 4000 });
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : $localize`unknown`;
      this.snackBar.open($localize`Could not delete the URL (${status}:status:).`, undefined, {
        duration: 10000,
      });
    }
  }

  /**
   * Cria e abre a URL nova. Com segredo de leitura, destranca já com ele: o servidor não dá o
   * cookie de acesso no `POST`, e a próxima chamada da tela voltaria 401.
   */
  private async create(settings: TokenSettings): Promise<boolean> {
    try {
      const token = await this.tokens.create(settings);
      if (typeof settings.read_secret === 'string') {
        await this.access.unlock(token.uuid, settings.read_secret);
      }
      await this.router.navigate(['/', token.uuid]);
      this.snackBar.open($localize`New URL created`, undefined, { duration: 4000 });
      return true;
    } catch (error) {
      this.snackBar.open(createError(error), undefined, { duration: 10000 });
      return false;
    }
  }
}

/** Mesma mensagem do app atual: erros de validação (422) juntos, ou o status HTTP. */
export function createError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    const messages = Object.values(error.error as Record<string, string[]>).flat();
    return $localize`Error creating token: ${messages.join(', ')}:messages:`;
  }
  const status = error instanceof HttpErrorResponse ? error.status : $localize`unknown`;
  return $localize`Error creating token (${status}:status:)`;
}
