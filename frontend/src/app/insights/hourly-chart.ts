import { Component, computed, input } from '@angular/core';
import { localDate } from '../request-detail/dates';
import { HourBar, hourlySummary, methodsText } from './insights';

/** Área do gráfico no `viewBox` (o SVG estica na largura do cartão). */
const WIDTH = 640;
const HEIGHT = 160;
const TOP = 12;
const BOTTOM = 20;
const GAP = 2;
const MIN_SLOTS = 24;

/**
 * Mensagens por hora em barras SVG próprias (S19: sem biblioteca de gráficos). Para leitor de
 * tela é uma imagem com o resumo; a tabela com os dados fica ao lado, na página. Cada barra tem o
 * número no título (dica ao passar o ponteiro). As horas saem na hora local do navegador (UX-19); a
 * página diz o fuso na legenda.
 */
@Component({
  selector: 'app-hourly-chart',
  template: `
    <svg
      class="chart"
      role="img"
      preserveAspectRatio="none"
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      [attr.aria-label]="summary()"
    >
      <line class="axis" x1="0" [attr.x2]="width" [attr.y1]="baseline" [attr.y2]="baseline" />
      @for (bar of geometry(); track bar.hour) {
        <rect
          class="bar"
          rx="2"
          [attr.x]="bar.x"
          [attr.y]="bar.y"
          [attr.width]="bar.width"
          [attr.height]="bar.height"
        >
          <title>{{ bar.title }}</title>
        </rect>
      }
    </svg>
    <div class="scale" aria-hidden="true">
      <span>{{ first() }}</span>
      <span i18n>peak {{ peak() }}</span>
      <span>{{ last() }}</span>
    </div>
  `,
  styleUrl: './hourly-chart.scss',
})
export class HourlyChart {
  readonly bars = input.required<readonly HourBar[]>();

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly baseline = HEIGHT - BOTTOM;
  protected readonly summary = computed(() => hourlySummary(this.bars()));
  protected readonly peak = computed(() => Math.max(0, ...this.bars().map((bar) => bar.count)));
  protected readonly first = computed(() => hourLabel(this.bars()[0]?.hour));
  protected readonly last = computed(() => hourLabel(this.bars().at(-1)?.hour));
  protected readonly geometry = computed(() => {
    const bars = this.bars();
    // Com poucas horas, as barras ficam finas e à esquerda, em vez de uma barra da largura toda.
    const slot = WIDTH / Math.max(bars.length, MIN_SLOTS);
    const scale = (HEIGHT - TOP - BOTTOM) / Math.max(this.peak(), 1);
    return bars.map((bar, i) => {
      // Hora com mensagem nunca some: pelo menos 2 unidades de altura.
      const height = bar.count === 0 ? 0 : Math.max(2, bar.count * scale);
      const hour = localDate(bar.hour);
      return {
        hour: bar.hour,
        x: i * slot + GAP / 2,
        width: Math.max(1, slot - GAP),
        y: HEIGHT - BOTTOM - height,
        height,
        title:
          (bar.count === 1
            ? $localize`${hour}:hour:: 1 request`
            : $localize`${hour}:hour:: ${bar.count}:count: requests`) +
          (bar.count ? ` (${methodsText(bar.methods)})` : ''),
      };
    });
  });
}

/** `2026-09-26 14:00:00` (UTC) → a hora local por extenso, como a Entrada (UX-19). */
function hourLabel(hour: string | undefined): string {
  return hour ? localDate(hour) : '';
}
