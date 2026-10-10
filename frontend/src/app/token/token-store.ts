import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Preferences } from '../settings/preferences';
import { KnownUrls } from './known-urls';
import { UrlMissing } from './url-missing';
import { Token, TokenSettings } from './token';

/** URL de webhook aberta na tela e as chamadas de `/token`. */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly http = inject(HttpClient);
  private readonly preferences = inject(Preferences);
  private readonly location = inject(DOCUMENT).location;
  private readonly known = inject(KnownUrls);
  private readonly missing = inject(UrlMissing);

  /** Token aberto; começa com o do localStorage, como no app atual. */
  readonly token = this.preferences.token.asReadonly();
  private loads = 0;

  /** URL que recebe os webhooks: `{protocolo}//{host}/{uuid}`. */
  readonly webhookUrl = computed(() => {
    const token = this.token();
    return token ? `${this.location.protocol}//${this.location.host}/${token.uuid}` : '';
  });

  /** Só a carga mais recente muda a URL aberta: a de outra, que responde depois, é descartada. */
  async load(tokenId: string): Promise<Token> {
    const run = ++this.loads;
    try {
      const token = await firstValueFrom(this.http.get<Token>(`/token/${tokenId}`));
      return run === this.loads ? this.keep(token) : token;
    } catch (error) {
      if (run === this.loads) {
        this.preferences.token.set(null);
      }
      throw error;
    }
  }

  async create(settings: TokenSettings = {}): Promise<Token> {
    return this.keep(await firstValueFrom(this.http.post<Token>('/token', settings)));
  }

  async update(tokenId: string, settings: TokenSettings): Promise<Token> {
    const token = await firstValueFrom(this.http.put<Token>(`/token/${tokenId}`, settings));
    return this.token()?.uuid === token.uuid ? this.keep(token) : token;
  }

  /** Liga/desliga o CORS no servidor; a tela reflete o valor devolvido (`{enabled}`). */
  async toggleCors(tokenId: string): Promise<boolean> {
    const { enabled } = await firstValueFrom(
      this.http.put<{ enabled: boolean }>(`/token/${tokenId}/cors/toggle`, null),
    );
    this.preferences.token.update((token) =>
      token?.uuid === tokenId ? { ...token, cors: enabled } : token,
    );
    return enabled;
  }

  private keep(token: Token): Token {
    this.preferences.token.set(token);
    this.known.opened(token.uuid);
    this.missing.clear(token.uuid);
    return token;
  }
}
