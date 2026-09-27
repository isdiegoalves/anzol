import { DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TokenStore } from '../token/token-store';
import { EmptyState } from '../ui/empty-state';
import { Pane } from '../ui/pane';
import { HourlyChart } from './hourly-chart';
import {
  answeredParts,
  hourlyBars,
  methodsText,
  percent,
  schemaParts,
  signatureParts,
} from './insights';
import { InsightsStore } from './insights-store';
import { ProportionBar } from './proportion-bar';

/** Porta do Grafana do stack de observabilidade local (`observability/README.md`). */
const GRAFANA_PORT = 3000;
/** O dashboard `observability/grafana/webhook-site.json` (uid `webhook-site`). */
const GRAFANA_DASHBOARD = '/d/webhook-site';

/**
 * Insights (`#/{token}/insights`): KPIs e gráficos da URL a partir de `GET /token/{id}/stats`, com
 * a janela explícita (as mensagens mais novas que a URL guarda, até 500). Gráficos em SVG próprio,
 * cada um com tabela de dados ao lado. Latência e erros são da instância inteira: ficam no Grafana.
 */
@Component({
  selector: 'app-insights-page',
  imports: [MatButton, RouterLink, EmptyState, Pane, HourlyChart, ProportionBar],
  templateUrl: './insights-page.html',
  styleUrl: './insights-page.scss',
  // Sem polling: os números são recalculados quando a aba volta a ficar visível.
  host: { '(document:visibilitychange)': 'refreshIfVisible()' },
})
export class InsightsPage {
  private readonly tokens = inject(TokenStore);
  protected readonly store = inject(InsightsStore);
  private readonly document = inject(DOCUMENT);

  /** Parâmetro da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();

  protected readonly stats = this.store.stats;
  protected readonly hourly = computed(() => hourlyBars(this.stats()?.hourly ?? []));
  protected readonly signature = computed(() => {
    const stats = this.stats();
    return stats ? signatureParts(stats) : [];
  });
  protected readonly schema = computed(() => {
    const stats = this.stats();
    return stats ? schemaParts(stats) : [];
  });
  protected readonly answered = computed(() => {
    const stats = this.stats();
    return stats ? answeredParts(stats) : [];
  });
  /** KPIs do resumo, todos sobre as `evaluated` mensagens mais novas. */
  protected readonly kpis = computed(() => {
    const stats = this.stats();
    if (!stats) {
      return [];
    }
    const answered = stats.rules.answered.reduce((sum, rule) => sum + rule.count, 0);
    const nearMisses = stats.rules.near_miss.reduce((sum, rule) => sum + rule.count, 0);
    return [
      { label: $localize`Answered by a rule`, count: answered },
      { label: $localize`Default response`, count: stats.rules.default },
      { label: $localize`Near misses`, count: nearMisses },
      { label: $localize`Signature valid`, count: stats.signature.valid },
      {
        label: $localize`Signature invalid or absent`,
        count: stats.signature.invalid + stats.signature.absent,
      },
      { label: $localize`Schema invalid`, count: stats.schema.invalid },
    ];
  });
  protected readonly maxAnswered = computed(() =>
    Math.max(1, ...this.answered().map((part) => part.count)),
  );
  protected readonly grafanaUrl = `${this.document.location.protocol}//${this.document.location.hostname}:${GRAFANA_PORT}${GRAFANA_DASHBOARD}`;
  protected readonly percent = percent;
  protected readonly rootLabel = $localize`(root)`;
  protected readonly methodsText = methodsText;

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => {
        if (this.tokens.token()?.uuid !== tokenId) {
          this.tokens.load(tokenId).catch(() => undefined);
        }
        void this.store.load(tokenId);
      });
    });
  }

  protected refreshIfVisible(): void {
    if (this.document.visibilityState === 'visible') {
      this.refresh();
    }
  }

  protected refresh(): void {
    void this.store.load(this.tokenId());
  }
}
