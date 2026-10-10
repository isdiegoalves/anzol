import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
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
  /**
   * A leitura da URL falhou sem dizer que ela não existe nem que é trancada (5xx, rede): o shell mostra a
   * página de erro, e a URL salva fica como estava.
   */
  readonly failure = signal<{ id: string; status: number } | null>(null);
  private loads = 0;
  /** A URL da leitura mais recente, enquanto ela não volta. */
  private wanted: string | null = null;

  /** URL que recebe os webhooks: `{protocolo}//{host}/{uuid}`. */
  readonly webhookUrl = computed(() => {
    const token = this.token();
    return token ? `${this.location.protocol}//${this.location.host}/${token.uuid}` : '';
  });

  /**
   * Só a carga mais recente muda a URL aberta: a de outra, que responde depois, é descartada. A URL salva
   * só é esquecida quando o servidor diz que ela não existe (404, 410).
   */
  async load(tokenId: string): Promise<Token> {
    const run = ++this.loads;
    this.wanted = tokenId;
    try {
      const token = await firstValueFrom(this.http.get<Token>(`/token/${tokenId}`));
      if (run === this.loads) {
        this.failure.set(null);
        this.keep(token);
      }
      return token;
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      if (run === this.loads && (status === 404 || status === 410)) {
        this.preferences.token.set(null);
      } else if (run === this.loads && status !== 401) {
        this.failure.set({ id: tokenId, status });
      }
      throw error;
    } finally {
      if (run === this.loads) {
        this.wanted = null;
      }
    }
  }

  /**
   * A página de uma URL lê a URL quando ela não é a aberta, ou quando a leitura de outra está a caminho: a
   * que voltasse depois trocaria o cabeçalho pelo dela.
   */
  ensure(tokenId: string): void {
    if ((this.wanted ?? this.token()?.uuid) !== tokenId) {
      this.load(tokenId).catch(() => undefined);
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
