import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { RequestStore } from '../requests/request-store';
import { RequestPage, WebhookRequest } from '../requests/webhook-request';
import { TokenStats } from '../stats/stats';
import { Token, TokenSettings } from '../token/token';
import { TokenStore } from '../token/token-store';
import { Preferences } from '../settings/preferences';
import { UrlLock } from '../token/url-lock';
import { changedFields, cutsRequests, withChanges } from './url-settings';

/**
 * Chamadas da página Checks. Toda escrita vai por `HttpClient` com corpo JSON, da própria origem
 * (item 12, S21): nada de formulário nativo nem `_method`.
 */
@Injectable({ providedIn: 'root' })
export class ChecksStore {
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(TokenStore);
  private readonly urlLock = inject(UrlLock);
  private readonly preferences = inject(Preferences);
  private readonly requests = inject(RequestStore);
  private readonly snackBar = inject(MatSnackBar);

  /**
   * Salva um cartão (CA-11). `base` é a URL como o cartão a leu. Antes do `PUT`, relê a URL no
   * servidor: outra aba, o CLI ou o MCP podem ter gravado nesse meio-tempo. O corpo é a URL relida
   * com as mudanças do cartão por cima, então o que o cartão não edita segue como está no servidor.
   * Se um campo do próprio cartão mudou lá fora, não sobrescreve: `ChangedElsewhere`.
   * Com segredo de leitura novo, destranca com ele antes de publicar a URL salva: publicar dispara
   * leituras (o Health), que com o cookie antigo levariam 401 e trancariam a tela. Com a limpeza
   * reduzida, a lista da Inbox vem de novo do servidor (o corte não gera evento).
   */
  async save(changes: TokenSettings, base: Token): Promise<Token> {
    this.snackBar.dismiss();
    const url = `/token/${base.uuid}`;
    const fresh = await firstValueFrom(this.http.get<Token>(url));
    const changed = changedFields(base, fresh, changes);
    if (changed.length > 0) {
      throw new ChangedElsewhere(changed);
    }
    const updated = await firstValueFrom(this.http.put<Token>(url, withChanges(fresh, changes)));
    if (typeof changes.read_secret === 'string') {
      try {
        await this.unlock(base.uuid, changes.read_secret);
      } catch (error) {
        // A URL já foi salva: o erro diz isso, e não "Error updating token".
        throw new UnlockFailed(error instanceof HttpErrorResponse ? error.status : null);
      }
    }
    this.preferences.token.set(updated);
    if (cutsRequests(fresh, updated) && this.requests.tokenId() === base.uuid) {
      await this.requests.reload();
    }
    this.snackBar.open('URL updated!', undefined, { duration: 4000 });
    return updated;
  }

  /** "Reload" depois de `ChangedElsewhere`: a URL como está no servidor. */
  reload(tokenId: string): Promise<Token> {
    return this.tokens.load(tokenId);
  }

  /** Grava o cookie de acesso com o segredo novo (como o `UrlAccess.unlock` da tela de desbloqueio). */
  private async unlock(tokenId: string, secret: string): Promise<void> {
    await firstValueFrom(this.http.post(`/token/${tokenId}/unlock`, { secret }));
    if (this.urlLock.tokenId() === tokenId) {
      this.urlLock.release();
    }
  }

  /** "Enable CORS": vale na hora, pelo `PUT /token/{id}/cors/toggle` de hoje. */
  async toggleCors(): Promise<void> {
    const token = this.tokens.token();
    if (!token) {
      return;
    }
    try {
      const enabled = await this.tokens.toggleCors(token.uuid);
      this.snackBar.open(enabled ? 'CORS enabled.' : 'CORS disabled.', undefined, {
        duration: 4000,
      });
    } catch {
      this.snackBar.open('Could not toggle CORS.', undefined, { duration: 10000 });
    }
  }

  stats(tokenId: string, window: number): Promise<TokenStats> {
    return firstValueFrom(
      this.http.get<TokenStats>(`/token/${tokenId}/stats`, { params: { window } }),
    );
  }

  /** Uma mensagem da URL; id que não é UUID nem vai ao servidor (`?schema-from=../../share/x`). */
  request(tokenId: string, requestId: string): Promise<WebhookRequest> {
    if (!isRequestId(requestId)) {
      return Promise.reject(new Error(`Not a request id: ${requestId}`));
    }
    return firstValueFrom(
      this.http.get<WebhookRequest>(
        `/token/${encodeURIComponent(tokenId)}/request/${encodeURIComponent(requestId)}`,
      ),
    );
  }

  /** Mensagens da primeira página com corpo JSON: as que geram um schema. */
  async recentJson(tokenId: string): Promise<WebhookRequest[]> {
    const page = await firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
        params: { page: 1, sorting: 'newest' },
      }),
    );
    return page.data.filter((request) => jsonBody(request) !== null);
  }
}

/**
 * Corpo JSON da mensagem, ou `null` quando não é JSON (a mesma regra do "Create schema from this
 * request" no detalhe).
 */
export function jsonBody(request: WebhookRequest): { value: unknown } | null {
  if (!request.content) {
    return null;
  }
  try {
    return { value: JSON.parse(request.content) as unknown };
  } catch {
    return null;
  }
}

/** Um campo do cartão mudou no servidor desde que o cartão o leu (outra aba, CLI, MCP). */
export class ChangedElsewhere extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Changed elsewhere: ${fields.join(', ')}`);
  }
}

/** O `PUT` com o segredo novo foi aceito, mas o `unlock` com ele falhou (ex.: 429). */
export class UnlockFailed extends Error {
  override readonly name = 'UnlockFailed';

  constructor(readonly status: number | null) {
    super(`Saved, but unlock failed (${status ?? 'unknown'})`);
  }
}

/** Id de mensagem: UUID, como na rota (`app.routes.ts`). Outro texto vindo da URL é ignorado. */
const REQUEST_ID = /^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i;

export function isRequestId(value: string | null | undefined): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}
