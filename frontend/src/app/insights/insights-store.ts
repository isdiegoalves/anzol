import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RequestPage } from '../requests/webhook-request';
import { STATS_MAX_WINDOW, TokenStats } from '../stats/stats';
import { Answer } from './insights';

/** O teto do `per_page` da listagem no servidor. */
const ANSWERS_PER_PAGE = 100;

export interface Answers {
  answers: Answer[];
  total: number;
}

/**
 * Números da URL para Insights: `GET /token/{id}/stats` na janela máxima (as 500 mensagens mais
 * novas), calculados na hora pelo servidor. Sem polling: a página relê ao voltar a ficar visível e
 * no "Refresh". O `/stats` não traz o status respondido: "Answers by status" conta a partir da
 * listagem, na mesma janela.
 */
@Injectable({ providedIn: 'root' })
export class InsightsStore {
  private readonly http = inject(HttpClient);

  readonly stats = signal<TokenStats | null>(null);
  readonly answers = signal<Answers | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private tokenId: string | null = null;

  async load(tokenId: string, window: number = STATS_MAX_WINDOW): Promise<void> {
    if (tokenId !== this.tokenId) {
      this.stats.set(null);
      this.answers.set(null);
    }
    this.tokenId = tokenId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const [stats, answers] = await Promise.all([
        firstValueFrom(
          this.http.get<TokenStats>(`/token/${tokenId}/stats`, {
            params: { window },
          }),
        ),
        this.newestAnswers(tokenId, window),
      ]);
      if (this.tokenId === tokenId) {
        this.stats.set(stats);
        this.answers.set(answers);
      }
    } catch (error) {
      if (this.tokenId === tokenId) {
        this.error.set(statsMessage(error));
      }
    } finally {
      this.loading.set(false);
    }
  }

  private async newestAnswers(tokenId: string, window: number): Promise<Answers> {
    const perPage = Math.min(ANSWERS_PER_PAGE, window);
    const page = (number: number) =>
      firstValueFrom(
        this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
          params: { page: number, per_page: perPage, sorting: 'newest' },
        }),
      );
    const first = await page(1);
    const pages = Math.min(Math.ceil(window / perPage), Math.ceil(first.total / perPage));
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page(i + 2)),
    );
    const answers = [first, ...rest]
      .flatMap((listed) => listed.data)
      .slice(0, window)
      .map((request) => ({ byRule: request.rule != null, response: request.response ?? null }));
    return { answers, total: first.total };
  }
}

function statsMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410)) {
    return $localize`This URL no longer exists (${error.status}).`;
  }
  const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
  return $localize`Could not load the numbers of this URL (${status}).`;
}
