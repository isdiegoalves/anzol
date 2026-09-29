import { DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatFormField } from '@angular/material/form-field';
import { RouterLink } from '@angular/router';
import { MatOption, MatSelect } from '@angular/material/select';
import { TokenStore } from '../token/token-store';
import { parseUtc } from '../request-detail/dates';
import { FILTER_METHODS } from '../search/request-filter';
import { CountFilter, CountLink, schemaPathFilter, signatureReasonFilter } from '../ui/count-link';
import { EmptyState } from '../ui/empty-state';
import { Pane } from '../ui/pane';
import { HourlyChart } from './hourly-chart';
import {
  answerRows,
  answeredParts,
  hourlyBars,
  keptText,
  localHour,
  methodsText,
  percent,
  schemaParts,
  signatureParts,
  utcOffset,
} from './insights';
import { InsightsStore } from './insights-store';
import { STATS_MAX_WINDOW, STATS_WINDOWS } from '../stats/stats';
import { ProportionBar } from './proportion-bar';

/** Porta do Grafana do stack de observabilidade local (`observability/README.md`). */
const GRAFANA_PORT = 3000;
/** O dashboard `observability/grafana/webhook-site.json` (uid `webhook-site`). */
const GRAFANA_DASHBOARD = '/d/webhook-site';

/**
 * Insights (`#/{token}/insights`): KPIs e gráficos da URL a partir de `GET /token/{id}/stats`, com
 * a janela explícita (as mensagens mais novas que a URL guarda, até 500). Gráficos em SVG próprio,
 * cada um com tabela de dados ao lado. Latência e erros são da instância inteira: ficam no Grafana.
 * F1: todo número que a Entrada sabe filtrar leva a ela com o filtro exato (`CountLink`); as horas
 * saem na hora local, com o UTC no `title` (UX-19).
 */
@Component({
  selector: 'app-insights-page',
  imports: [
    MatButton,
    MatFormField,
    MatSelect,
    MatOption,
    RouterLink,
    CountLink,
    EmptyState,
    Pane,
    HourlyChart,
    ProportionBar,
  ],
  templateUrl: './insights-page.html',
  styleUrl: './insights-page.scss',
  // Sem polling: os números são recalculados quando a aba volta a ficar visível.
  // UX-21: a página é o `main` do destino, com o nome do `h1`.
  host: {
    role: 'main',
    'aria-labelledby': 'insights-title',
    '(document:visibilitychange)': 'refreshIfVisible()',
  },
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
  /**
   * KPIs do resumo, todos sobre as `evaluated` mensagens mais novas. Sem `filter`, a soma não tem um
   * filtro só na Entrada (várias regras, inválida ou ausente) e o número fica sem link.
   */
  protected readonly kpis = computed(
    (): { label: string; count: number; filter?: CountFilter }[] => {
      const stats = this.stats();
      if (!stats) {
        return [];
      }
      const answered = stats.rules.answered.reduce((sum, rule) => sum + rule.count, 0);
      const nearMisses = stats.rules.near_miss.reduce((sum, rule) => sum + rule.count, 0);
      return [
        { label: $localize`Answered by a rule`, count: answered },
        {
          label: $localize`Default response`,
          count: stats.rules.default,
          filter: { outcome: 'default' },
        },
        { label: $localize`Near misses`, count: nearMisses },
        {
          label: $localize`Signature valid`,
          count: stats.signature.valid,
          filter: { signature: 'valid' },
        },
        {
          label: $localize`Signature invalid or absent`,
          count: stats.signature.invalid + stats.signature.absent,
        },
        {
          label: $localize`Schema invalid`,
          count: stats.schema.invalid,
          filter: { schema: 'invalid' },
        },
      ];
    },
  );
  /** Sobre o que os números do `/stats` foram contados: o `window=` do link quando cortam (F1). */
  protected readonly scope = computed(() => {
    const stats = this.stats();
    return stats ? { evaluated: stats.evaluated, total: stats.total } : null;
  });
  /** Os métodos do resumo; os que o filtro "Method" da Entrada conhece viram link. */
  protected readonly methods = computed(() =>
    Object.entries(this.stats()?.methods ?? {})
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([method, count]) => ({
        method,
        count,
        filter: (FILTER_METHODS as readonly string[]).includes(method) ? { methods: method } : null,
      })),
  );
  protected readonly nearMisses = computed(() =>
    (this.stats()?.rules.near_miss ?? []).map((rule) => ({
      ...rule,
      what: $localize`Closest rule: ${rule.name}:rule:`,
      filter: { outcome: 'near_miss', rule: rule.id, ruleName: rule.name },
    })),
  );
  /** B2: "Answers by status", contado da listagem na mesma janela. */
  protected readonly answers = computed(() => answerRows(this.store.answers()?.answers ?? []));
  protected readonly answersScope = computed(() => {
    const answers = this.store.answers();
    return answers ? { evaluated: answers.answers.length, total: answers.total } : null;
  });
  /** UX-19: o fuso da legenda do gráfico, na data da hora mais nova. */
  protected readonly offset = computed(() => {
    const newest = this.stats()?.newest_at;
    return utcOffset(newest ? parseUtc(newest) : new Date());
  });
  protected readonly maxAnswered = computed(() =>
    Math.max(1, ...this.answered().map((part) => part.count)),
  );
  protected readonly grafanaUrl = `${this.document.location.protocol}//${this.document.location.hostname}:${GRAFANA_PORT}${GRAFANA_DASHBOARD}`;
  protected readonly percent = percent;
  protected readonly keptText = keptText;
  protected readonly signatureReasonFilter = signatureReasonFilter;
  protected readonly schemaPathFilter = schemaPathFilter;
  protected readonly localHour = localHour;
  /** Janela do resumo (RULES-38): as mesmas de Health, com 500 (a de E9) por padrão. */
  protected readonly windows = STATS_WINDOWS;
  protected readonly window = signal<number>(STATS_MAX_WINDOW);
  protected readonly rootLabel = $localize`(root)`;
  protected readonly methodsText = methodsText;
  protected readonly allRequests = $localize`All requests`;

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => {
        if (this.tokens.token()?.uuid !== tokenId) {
          this.tokens.load(tokenId).catch(() => undefined);
        }
        void this.store.load(tokenId, this.window());
      });
    });
  }

  protected chooseWindow(window: number): void {
    this.window.set(window);
    this.refresh();
  }

  protected refreshIfVisible(): void {
    if (this.document.visibilityState === 'visible') {
      this.refresh();
    }
  }

  protected refresh(): void {
    void this.store.load(this.tokenId(), this.window());
  }
}
