import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Preferences } from '../settings/preferences';
import { KnownUrls } from './known-urls';
import { Token, TokenSettings } from './token';

/** URL de webhook aberta na tela e as chamadas de `/token`. */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly http = inject(HttpClient);
  private readonly preferences = inject(Preferences);
  private readonly location = inject(DOCUMENT).location;
  private readonly known = inject(KnownUrls);

  /** Token aberto; começa com o do localStorage, como no app atual. */
  readonly token = this.preferences.token.asReadonly();

  /** URL que recebe os webhooks: `{protocolo}//{host}/{uuid}`. */
  readonly webhookUrl = computed(() => {
    const token = this.token();
    return token ? `${this.location.protocol}//${this.location.host}/${token.uuid}` : '';
  });

  async load(tokenId: string): Promise<Token> {
    try {
      return this.keep(await firstValueFrom(this.http.get<Token>(`/token/${tokenId}`)));
    } catch (error) {
      this.preferences.token.set(null);
      throw error;
    }
  }

  async create(settings: TokenSettings = {}): Promise<Token> {
    return this.keep(await firstValueFrom(this.http.post<Token>('/token', settings)));
  }

  async update(tokenId: string, settings: TokenSettings): Promise<Token> {
    return this.keep(await firstValueFrom(this.http.put<Token>(`/token/${tokenId}`, settings)));
  }

  /** Liga/desliga o CORS no servidor; a tela reflete o valor devolvido (`{enabled}`). */
  async toggleCors(tokenId: string): Promise<boolean> {
    const { enabled } = await firstValueFrom(
      this.http.put<{ enabled: boolean }>(`/token/${tokenId}/cors/toggle`, null),
    );
    this.preferences.token.update((token) => (token ? { ...token, cors: enabled } : token));
    return enabled;
  }

  /** A URL abriu (ou foi criada, ou salva): fica na tela e entra na lista deste navegador (B1). */
  private keep(token: Token): Token {
    this.preferences.token.set(token);
    this.known.opened(token.uuid);
    return token;
  }
}
