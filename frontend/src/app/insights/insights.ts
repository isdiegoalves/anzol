import { HourlyCount, TokenStats } from '../stats/stats';

/** Papel de cor de uma fatia: sempre com rótulo em texto ao lado (WCAG 1.4.1). */
export type Tone = 'ok' | 'bad' | 'near' | 'none' | 'primary';

/** Uma fatia de uma barra de proporção (assinatura, schema, quem respondeu). */
export interface Part {
  label: string;
  count: number;
  tone: Tone;
}

/** Barra de uma hora: `count` é zero nas horas sem mensagem que o gráfico preenche. */
export interface HourBar {
  hour: string;
  count: number;
  methods: Record<string, number>;
}

/** Acima disto (em horas entre a mais antiga e a mais nova), o gráfico mostra só as horas com mensagem. */
export const HOURLY_FILL_MAX = 72;
const HOUR_MS = 3_600_000;

/** `2026-09-26 14:00:00` (UTC, formato de `created_at`) em milissegundos. */
function hourMs(hour: string): number {
  return Date.parse(`${hour.replace(' ', 'T')}Z`);
}

function hourText(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * As horas do gráfico, da mais antiga para a mais nova. O servidor manda só as horas com mensagem;
 * entre elas, as horas vazias entram com zero para o eixo do tempo não mentir, enquanto o
 * intervalo couber em `HOURLY_FILL_MAX` horas. Janela mais longa fica só com as horas que têm.
 */
export function hourlyBars(hourly: readonly HourlyCount[]): HourBar[] {
  if (hourly.length === 0) {
    return [];
  }
  const first = hourMs(hourly[0].hour);
  const last = hourMs(hourly[hourly.length - 1].hour);
  const span = Math.round((last - first) / HOUR_MS);
  if (!Number.isFinite(span) || span > HOURLY_FILL_MAX) {
    return hourly.map(({ hour, count, methods }) => ({ hour, count, methods }));
  }
  const byHour = new Map(hourly.map((entry) => [hourMs(entry.hour), entry]));
  return Array.from({ length: span + 1 }, (_, i) => {
    const ms = first + i * HOUR_MS;
    const entry = byHour.get(ms);
    return { hour: hourText(ms), count: entry?.count ?? 0, methods: entry?.methods ?? {} };
  });
}

/** Percentual inteiro de `count` em `total` ("—" sem total). */
export function percent(count: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((count / total) * 100)}%`;
}

/** Fatias da verificação de assinatura, na ordem da tela. */
export function signatureParts(stats: TokenStats): Part[] {
  const { valid, invalid, absent, unchecked } = stats.signature;
  return [
    { label: 'Valid', count: valid, tone: 'ok' },
    { label: 'Invalid', count: invalid, tone: 'bad' },
    { label: 'Absent', count: absent, tone: 'near' },
    { label: 'Not checked', count: unchecked, tone: 'none' },
  ];
}

/** Fatias da validação de schema. */
export function schemaParts(stats: TokenStats): Part[] {
  const { valid, invalid, unchecked } = stats.schema;
  return [
    { label: 'Valid', count: valid, tone: 'ok' },
    { label: 'Invalid', count: invalid, tone: 'bad' },
    { label: 'Not checked', count: unchecked, tone: 'none' },
  ];
}

/** Quem respondeu: cada regra (da que mais respondeu) e a resposta padrão no fim. */
export function answeredParts(stats: TokenStats): Part[] {
  return [
    ...[...stats.rules.answered]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(({ name, count }) => ({ label: name, count, tone: 'primary' as const })),
    { label: 'Default response', count: stats.rules.default, tone: 'none' },
  ];
}

/** "POST 12, GET 3" para a tabela e o título das barras. */
export function methodsText(methods: Record<string, number>): string {
  return Object.entries(methods)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([method, count]) => `${method} ${count}`)
    .join(', ');
}

/** Resumo do gráfico por hora para leitor de tela (o `img` do SVG). */
export function hourlySummary(bars: readonly HourBar[]): string {
  if (bars.length === 0) {
    return 'Requests per hour: no requests';
  }
  const peak = bars.reduce((best, bar) => (bar.count > best.count ? bar : best), bars[0]);
  return (
    `Requests per hour, ${bars.length} ${bars.length === 1 ? 'hour' : 'hours'} from ` +
    `${bars[0].hour} to ${bars[bars.length - 1].hour} UTC; peak ${peak.count} at ${peak.hour} UTC`
  );
}
