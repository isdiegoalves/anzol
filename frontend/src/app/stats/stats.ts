/**
 * `GET /token/{id}/stats?window=N`: agregados das `evaluated = min(window, total)` mensagens mais
 * novas da URL, calculados na hora (nada é gravado). Alimenta o Health de Checks, os hits por regra
 * em Rules e Insights. Horários no formato de `created_at` (UTC).
 */
export interface TokenStats {
  /** Janela pedida: de 1 a 500, padrão 500. */
  window: number;
  evaluated: number;
  /** Mensagens guardadas na URL. */
  total: number;
  /** Nulos com a URL vazia. */
  newest_seq: number | null;
  oldest_seq: number | null;
  newest_at: string | null;
  oldest_at: string | null;
  methods: Record<string, number>;
  signature: SignatureStats;
  schema: SchemaStats;
  rules: RuleStats;
  /** Horas UTC com pelo menos uma mensagem, da mais antiga para a mais nova. */
  hourly: HourlyCount[];
}

/** Como `SignatureResult`: `unchecked` é `signature: null` (a URL não verificava). */
export interface SignatureStats {
  valid: number;
  invalid: number;
  absent: number;
  unchecked: number;
  /** Motivos de inválidas e ausentes, sem o parêntese final, por contagem decrescente; até 10. */
  reasons: { reason: string; count: number }[];
}

export interface SchemaStats {
  valid: number;
  invalid: number;
  unchecked: number;
  /** Cada `errors[].path` contado uma vez por mensagem (`""` é a raiz); até 10. */
  paths: { path: string; count: number }[];
}

export interface RuleStats {
  /** Por `rule.id`, com o nome da mensagem mais nova. */
  answered: RuleCount[];
  /** Por `near_miss.id`. */
  near_miss: RuleCount[];
  /** Mensagens respondidas pela resposta padrão (`rule: null`). */
  default: number;
}

export interface RuleCount {
  id: string;
  name: string;
  count: number;
}

export interface HourlyCount {
  /** Início da hora (`2026-09-26 14:00:00`). */
  hour: string;
  count: number;
  methods: Record<string, number>;
}

/** Janelas que o Health de Checks oferece; o servidor aceita de 1 a 500. */
export const STATS_WINDOWS = [50, 200, 500] as const;
export const STATS_MAX_WINDOW = 500;
