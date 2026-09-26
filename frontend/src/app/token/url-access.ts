import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Preferences } from '../settings/preferences';
import { UrlLock } from './url-lock';

/**
 * Acesso à URL protegida: `unlock` e `lock`. Fica fora do `TokenStore` para vir só nos pedaços
 * carregados sob demanda (tela de desbloqueio, diálogos da URL, "Lock"), não na carga inicial.
 */
@Injectable({ providedIn: 'root' })
export class UrlAccess {
  private readonly http = inject(HttpClient);
  private readonly preferences = inject(Preferences);
  private readonly urlLock = inject(UrlLock);

  /**
   * Segredo certo: o servidor grava o cookie de acesso (só desta URL) e a tela destranca. Erro
   * (401 do segredo errado, 429 com `Retry-After`) volta para quem chamou.
   */
  async unlock(tokenId: string, secret: string): Promise<void> {
    await firstValueFrom(this.http.post(`/token/${tokenId}/unlock`, { secret }));
    if (this.urlLock.tokenId() === tokenId) {
      this.urlLock.release();
    }
  }

  /** Apaga o cookie de acesso e tranca a tela: a URL sai da tela até o próximo desbloqueio. */
  async lock(tokenId: string): Promise<void> {
    await firstValueFrom(this.http.post(`/token/${tokenId}/lock`, null));
    this.preferences.token.set(null);
    this.urlLock.lock(tokenId);
  }
}
