import { localDate, parseUtc } from '../request-detail/dates';
import { RecordedResponse } from '../requests/webhook-request';
import { FAULT_SHORT_LABELS, RuleFault } from '../rules/rule';
import { HourlyCount, TokenStats } from '../stats/stats';
import { CountFilter } from '../ui/count-link';
import { reasonPhrase } from '../ui/status-code';

/** Papel de cor de uma fatia: sempre com rótulo em texto ao lado (WCAG 1.4.1). */
export type Tone = 'ok' | 'bad' | 'near' | 'none' | 'primary';

/** Uma fatia de uma barra de proporção (assinatura, schema, quem respondeu). */
export interface Part {
  label: string;
  count: number;
  tone: Tone;
  /** F1: o filtro exato da Entrada que mostra estas requisições; ausente quando não há um. */
  filter?: CountFilter;
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
    { label: $localize`Valid`, count: valid, tone: 'ok', filter: { signature: 'valid' } },
    { label: $localize`Invalid`, count: invalid, tone: 'bad', filter: { signature: 'invalid' } },
    { label: $localize`Absent`, count: absent, tone: 'near', filter: { signature: 'absent' } },
    // A Entrada não filtra "sem verificação": o número fica sem link.
    { label: $localize`Not checked`, count: unchecked, tone: 'none' },
  ];
}

/** Fatias da validação de schema. */
export function schemaParts(stats: TokenStats): Part[] {
  const { valid, invalid, unchecked } = stats.schema;
  return [
    { label: $localize`Valid`, count: valid, tone: 'ok', filter: { schema: 'valid' } },
    { label: $localize`Invalid`, count: invalid, tone: 'bad', filter: { schema: 'invalid' } },
    { label: $localize`Not checked`, count: unchecked, tone: 'none' },
  ];
}

/** Quem respondeu: cada regra (da que mais respondeu) e a resposta padrão no fim. */
export function answeredParts(stats: TokenStats): Part[] {
  return [
    ...[...stats.rules.answered]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(({ id, name, count }) => ({
        label: name,
        count,
        tone: 'primary' as const,
        filter: { outcome: 'rule', rule: id, ruleName: name },
      })),
    {
      label: $localize`Default response`,
      count: stats.rules.default,
      tone: 'none',
      filter: { outcome: 'default' },
    },
  ];
}

/** "POST 12, GET 3" para a tabela e o título das barras. */
export function methodsText(methods: Record<string, number>): string {
  return Object.entries(methods)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([method, count]) => `${method} ${count}`)
    .join(', ');
}

/** Resumo do gráfico por hora para leitor de tela (o `img` do SVG), na hora local (UX-19). */
export function hourlySummary(bars: readonly HourBar[]): string {
  if (bars.length === 0) {
    return $localize`Requests per hour: no requests`;
  }
  const peak = bars.reduce((best, bar) => (bar.count > best.count ? bar : best), bars[0]);
  const from = localDate(bars[0].hour);
  const to = localDate(bars[bars.length - 1].hour);
  const at = localDate(peak.hour);
  return bars.length === 1
    ? $localize`Requests per hour, 1 hour from ${from}:from: to ${to}:to:, local time; peak ${peak.count}:peak: at ${at}:peakHour:`
    : $localize`Requests per hour, ${bars.length}:count: hours from ${from}:from: to ${to}:to:, local time; peak ${peak.count}:peak: at ${at}:peakHour:`;
}

/**
 * O fuso do navegador na data dada, como a legenda do gráfico o escreve (UX-19): "−3", "+5:30",
 * "+0" (sinal de menos tipográfico, U+2212).
 */
export function utcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `${minutes < 0 ? '−' : '+'}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

/** Hora do servidor (UTC, formato de `created_at`) por extenso na hora local, e o UTC para o `title`. */
export function localHour(value: string): { text: string; utc: string; iso: string } {
  return { text: localDate(value), utc: `${value} UTC`, iso: parseUtc(value).toISOString() };
}

/**
 * Quantas mensagens o resumo cobre (RULES-39): "of the 16 kept" quando a janela cobre tudo o que a
 * URL guarda, e "the newest 500 of 1291 kept" quando não cobre. A janela continua explícita (E9) sem
 * sugerir que faltam mensagens.
 */
export function keptText(evaluated: number, total: number, window: number): string {
  return total > window
    ? $localize`the newest ${evaluated}:evaluated: of ${total}:total: kept`
    : $localize`of the ${total}:total: kept`;
}

/** O que a URL respondeu a uma requisição, e se foi uma regra (`rule` gravada) ou a resposta padrão. */
export interface Answer {
  byRule: boolean;
  response: RecordedResponse | null;
}

/** Uma linha de "Answers by status" (B2): um status exato, uma falha de rede, ou "sem registro". */
export interface AnswerRow {
  key: string;
  count: number;
  /** "429 Too Many Requests · 2 · default response": o texto da linha e o nome do link. */
  text: string;
  /** F1: `answered={status}`; `null` na falha de rede e sem registro (a Entrada não filtra por eles). */
  filter: CountFilter | null;
}

/** "429 Too Many Requests", "— TCP RST" (falha de rede da regra) ou "— not recorded". */
function answerLabel(status: number | null, fault: string | null): string {
  if (status !== null) {
    const phrase = reasonPhrase(status);
    return phrase ? `${status} ${phrase}` : String(status);
  }
  const kind = fault === null ? null : (FAULT_SHORT_LABELS[fault as RuleFault] ?? fault);
  return `— ${kind ?? $localize`not recorded`}`;
}

/**
 * B2: as respostas contadas por status exato, com a origem (regras, resposta padrão ou as duas), do
 * status mais respondido para o menos; falhas de rede e respostas sem registro no fim.
 */
export function answerRows(answers: readonly Answer[]): AnswerRow[] {
  const groups = new Map<
    string,
    { status: number | null; label: string; rules: number; defaults: number }
  >();
  for (const { byRule, response } of answers) {
    const status = response?.status ?? null;
    const fault = response?.fault ?? null;
    const key = status !== null ? `status:${status}` : fault !== null ? `fault:${fault}` : 'none';
    let group = groups.get(key);
    if (!group) {
      group = { status, label: answerLabel(status, fault), rules: 0, defaults: 0 };
      groups.set(key, group);
    }
    if (byRule) {
      group.rules++;
    } else {
      group.defaults++;
    }
  }
  return [...groups.entries()]
    .map(([key, { status, label, rules, defaults }]) => {
      const count = rules + defaults;
      const origin =
        defaults === 0
          ? $localize`:answer origin:by rules`
          : rules === 0
            ? $localize`:answer origin:default response`
            : $localize`:answer origin:both`;
      return {
        key,
        status,
        count,
        text: $localize`${label}:answer: · ${count}:count: · ${origin}:origin:`,
        filter: status !== null ? { answered: String(status) } : null,
      };
    })
    .sort(
      (a, b) =>
        Number(a.status === null) - Number(b.status === null) ||
        b.count - a.count ||
        (a.status ?? 0) - (b.status ?? 0) ||
        a.key.localeCompare(b.key),
    )
    .map(({ key, count, text, filter }) => ({ key, count, text, filter }));
}
