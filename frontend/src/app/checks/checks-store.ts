import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { RequestStore } from '../requests/request-store';
import { RequestPage, WebhookRequest } from '../requests/webhook-request';
import { TokenStats } from '../stats/stats';
import { Token, TokenSettings } from '../token/token';
import { TokenStore } from '../token/token-store';
import { UrlLock } from '../token/url-lock';
import { cutsRequests, withChanges } from './url-settings';

/**
 * Chamadas da página Checks. Toda escrita vai por `HttpClient` com corpo JSON, da própria origem
 * (item 12, S21): nada de formulário nativo nem `_method`.
 */
@Injectable({ providedIn: 'root' })
export class ChecksStore {
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(TokenStore);
  private readonly urlLock = inject(UrlLock);
  private readonly requests = inject(RequestStore);
  private readonly snackBar = inject(MatSnackBar);

  /**
   * Salva um cartão: a configuração salva da URL com as mudanças do cartão por cima (CA-11). Com
   * segredo de leitura novo, destranca já com ele (o `PUT` não dá o cookie de acesso e a troca
   * invalida o anterior). Com a limpeza reduzida, a lista da Inbox vem de novo do servidor (o corte
   * não gera evento). Erro volta para o cartão.
   */
  async save(changes: TokenSettings): Promise<Token> {
    const before = this.tokens.token();
    if (!before) {
      throw new Error('No URL open');
    }
    const updated = await this.tokens.update(before.uuid, withChanges(before, changes));
    if (typeof changes.read_secret === 'string') {
      await this.unlock(before.uuid, changes.read_secret);
    }
    if (cutsRequests(before, updated) && this.requests.tokenId() === before.uuid) {
      await this.requests.reload();
    }
    this.snackBar.open('URL updated!', undefined, { duration: 4000 });
    return updated;
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

  request(tokenId: string, requestId: string): Promise<WebhookRequest> {
    return firstValueFrom(this.http.get<WebhookRequest>(`/token/${tokenId}/request/${requestId}`));
  }

  /** Mensagens da primeira página com corpo JSON: as que geram um schema. */
  async recentJson(tokenId: string): Promise<WebhookRequest[]> {
    const page = await firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, { params: { page: 1 } }),
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
