import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { inferSchema } from './infer-schema';
import { JsonSchema, Token, TokenSettings } from './token';
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
    await this.askSettings('create', async (settings) => {
      try {
        const token = await this.tokens.create(settings);
        this.requests.resetUnread();
        await this.router.navigate(['/', token.uuid]);
        this.snackBar.open('New URL created');
        return [];
      } catch (error) {
        return this.failed('creating', error);
      }
    });
  }

  /** `schema`: sugerido no lugar do salvo ("Create schema from this request"). */
  async editUrl(schema?: JsonSchema): Promise<void> {
    const token = this.tokens.token();
    await this.askSettings(
      'edit',
      async (settings) => {
        if (!token) {
          return [];
        }
        try {
          const updated = await this.tokens.update(token.uuid, settings);
          this.snackBar.open('URL updated!');
          if (cutsRequests(token, updated)) {
            await this.reloadRequests();
          }
          return [];
        } catch (error) {
          return this.failed('updating', error);
        }
      },
      schema,
    );
  }

  /** "Create schema from this request": abre o Edit URL com o schema inferido do corpo JSON. */
  async createSchemaFrom(request: WebhookRequest): Promise<void> {
    await this.editUrl(inferSchema(JSON.parse(request.content ?? '')));
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

  /** O 422 do schema volta para o campo, com o diálogo aberto; o resto vira aviso, como antes. */
  private failed(action: 'creating' | 'updating', error: unknown): readonly string[] {
    const schema = schemaErrors(error);
    if (schema.length === 0) {
      this.snackBar.open(settingsError(action, error), undefined, { duration: 10000 });
    }
    return schema;
  }

  private async askSettings(
    mode: TokenDialogData['mode'],
    save: TokenDialogData['save'],
    schema?: JsonSchema,
  ): Promise<void> {
    const dialog = this.dialog.open<TokenDialog, TokenDialogData, TokenSettings>(TokenDialog, {
      data: { mode, token: this.tokens.token(), save, ...(schema && { schema }) },
      width: '600px',
    });
    await firstValueFrom(dialog.afterClosed());
  }
}

/** Ligar a limpeza automática, ou reduzir o limite, faz o servidor cortar as mais antigas. */
function cutsRequests(before: Token, after: Token): boolean {
  const limit = after.auto_cleanup ?? null;
  const previous = before.auto_cleanup ?? null;
  return limit !== null && (previous === null || limit < previous);
}

/** Mensagens do 422 no campo `schema` (`{"schema": [...]}`); vazio para qualquer outro erro. */
export function schemaErrors(error: unknown): readonly string[] {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    const messages = (error.error as Record<string, string[]> | null)?.['schema'];
    return Array.isArray(messages) ? messages : [];
  }
  return [];
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
