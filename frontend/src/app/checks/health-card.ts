import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { STATS_WINDOWS, TokenStats } from '../stats/stats';
import { TokenStore } from '../token/token-store';
import { ChecksStore } from './checks-store';

/** Uma linha do Health: quantas passaram, quantas não, e os motivos mais comuns. */
export interface HealthLine {
  valid: number;
  failed: { label: string; count: number }[];
  /** Inválidas + ausentes (assinatura) ou inválidas (schema). */
  invalid: number;
  /** Mensagens sem resultado (a URL não verificava quando chegaram). */
  unchecked: number;
  /** Percentual de válidas entre as verificadas, com uma casa; `null` sem nenhuma verificada. */
  percent: string | null;
}

type WindowSize = (typeof STATS_WINDOWS)[number];

/**
 * Checks › Health (C §2.6, S20): a taxa de assinaturas e de corpos válidos nas últimas 50, 200 ou
 * 500 mensagens, com os motivos e caminhos que mais falham, lida do `GET /token/{id}/stats` (nada
 * é calculado na tela). Sem polling: recalcula ao abrir, ao trocar a janela, ao salvar a URL, ao
 * voltar para a aba e no "Refresh".
 */
@Component({
  selector: 'app-health-card',
  imports: [MatButton, MatButtonToggle, MatButtonToggleGroup],
  templateUrl: './health-card.html',
  styleUrls: ['./card.scss', './health-card.scss'],
  host: { role: 'region', 'aria-labelledby': 'health-title' },
})
export class HealthCard {
  private readonly tokens = inject(TokenStore);
  private readonly checks = inject(ChecksStore);

  protected readonly windows = STATS_WINDOWS;
  protected readonly window = signal<WindowSize>(200);
  protected readonly stats = signal<TokenStats | null>(null);
  protected readonly loading = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected readonly signature = computed(() => {
    const stats = this.stats()?.signature;
    return stats
      ? line(
          stats.valid,
          stats.invalid + stats.absent,
          stats.unchecked,
          stats.reasons.map(({ reason, count }) => ({ label: reason, count })),
        )
      : null;
  });

  protected readonly schema = computed(() => {
    const stats = this.stats()?.schema;
    return stats
      ? line(
          stats.valid,
          stats.invalid,
          stats.unchecked,
          stats.paths.map(({ path, count }) => ({ label: path === '' ? '(root)' : path, count })),
        )
      : null;
  });

  protected readonly metrics = computed(() => [
    { title: 'Signature', why: 'Why invalid', data: this.signature() },
    { title: 'Schema', why: 'Failing paths', data: this.schema() },
  ]);

  constructor() {
    // A URL salva de novo (outro cartão) também muda o que conta: a janela é a mesma, o resultado não.
    effect(() => {
      const token = this.tokens.token();
      this.window();
      if (token) {
        untracked(() => void this.refresh());
      }
    });
    const page = inject(DOCUMENT);
    const onVisible = () => {
      if (page.visibilityState === 'visible') {
        void this.refresh();
      }
    };
    page.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => page.removeEventListener('visibilitychange', onVisible));
  }

  protected chooseWindow(value: WindowSize): void {
    this.window.set(value);
  }

  async refresh(): Promise<void> {
    const token = this.tokens.token();
    if (!token) {
      return;
    }
    this.loading.set(true);
    try {
      this.stats.set(await this.checks.stats(token.uuid, this.window()));
      this.failure.set(null);
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
      this.failure.set(`Could not load the numbers (${status}).`);
    } finally {
      this.loading.set(false);
    }
  }
}

/** A linha do Health com o percentual entre as verificadas. */
export function line(
  valid: number,
  invalid: number,
  unchecked: number,
  failed: HealthLine['failed'],
): HealthLine {
  const checked = valid + invalid;
  return {
    valid,
    invalid,
    unchecked,
    failed,
    percent: checked === 0 ? null : `${((valid / checked) * 100).toFixed(1)}%`,
  };
}
