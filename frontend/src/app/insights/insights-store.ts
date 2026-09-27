import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { STATS_MAX_WINDOW, TokenStats } from '../stats/stats';

/**
 * Números da URL para Insights: `GET /token/{id}/stats` na janela máxima (as 500 mensagens mais
 * novas), calculados na hora pelo servidor. Sem polling: a página relê ao voltar a ficar visível e
 * no "Refresh".
 */
@Injectable({ providedIn: 'root' })
export class InsightsStore {
  private readonly http = inject(HttpClient);

  readonly stats = signal<TokenStats | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private tokenId: string | null = null;

  async load(tokenId: string): Promise<void> {
    if (tokenId !== this.tokenId) {
      this.stats.set(null);
    }
    this.tokenId = tokenId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const stats = await firstValueFrom(
        this.http.get<TokenStats>(`/token/${tokenId}/stats`, {
          params: { window: STATS_MAX_WINDOW },
        }),
      );
      if (this.tokenId === tokenId) {
        this.stats.set(stats);
      }
    } catch (error) {
      if (this.tokenId === tokenId) {
        this.error.set(statsMessage(error));
      }
    } finally {
      this.loading.set(false);
    }
  }
}

function statsMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410)) {
    return $localize`This URL no longer exists (${error.status}).`;
  }
  const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
  return $localize`Could not load the numbers of this URL (${status}).`;
}
