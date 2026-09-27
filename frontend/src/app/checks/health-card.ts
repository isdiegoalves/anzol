import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatFormField } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { STATS_WINDOWS, TokenStats } from '../stats/stats';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { ChecksStore } from './checks-store';

/** Um motivo (ou caminho) que falha, com o filtro da Inbox que mostra essas mensagens. */
export interface HealthItem {
  label: string;
  count: number;
  /** Query da Inbox já filtrada pelo motivo exato (`?signatureReason=`) ou pelo caminho (`?schemaPath=`, M1). */
  filter: Record<string, string>;
  /** Largura da barra, proporcional ao maior da lista (`"50%"`). */
  share: string;
}

/** Linhas com a barra proporcional ao maior valor da lista. */
function items(
  list: { label: string; count: number; filter: Record<string, string> }[],
): HealthItem[] {
  const max = Math.max(1, ...list.map((item) => item.count));
  return list.map((item) => ({ ...item, share: `${Math.round((item.count / max) * 100)}%` }));
}

/** Uma linha do Health: quantas passaram, quantas não, e os motivos mais comuns. */
export interface HealthLine {
  valid: number;
  failed: HealthItem[];
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
  imports: [Icon, RouterLink, MatFormField, MatIconButton, MatOption, MatSelect],
  templateUrl: './health-card.html',
  styleUrls: ['./card.scss', './health-card.scss'],
  host: { role: 'region', 'aria-labelledby': 'health-title' },
})
export class HealthCard {
  protected readonly tokens = inject(TokenStore);
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
          items(
            stats.reasons.map(({ reason, count }) => ({
              label: reason,
              count,
              // M1: a Entrada pelo motivo exato, e não só por inválida/ausente.
              filter: { signatureReason: reason },
            })),
          ),
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
          items(
            stats.paths.map(({ path, count }) => ({
              label: path === '' ? $localize`(root)` : path,
              count,
              // M1: pelo caminho do erro (JSON Pointer; '' é a raiz), e não por qualquer inválida.
              filter: { schemaPath: path },
            })),
          ),
        )
      : null;
  });

  protected readonly barLabel = (valid: number, invalid: number) =>
    $localize`${valid}:valid: valid, ${invalid}:invalid: invalid`;
  protected readonly metrics = computed(() => [
    { title: $localize`Signature`, why: $localize`Why invalid`, data: this.signature() },
    { title: $localize`Schema`, why: $localize`Failing paths`, data: this.schema() },
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
      this.failure.set($localize`Could not load the numbers (${status}).`);
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
