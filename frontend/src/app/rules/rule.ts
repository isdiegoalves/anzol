/**
 * Regra de resposta da URL, no formato de `GET/PUT /token/{id}/rules` (Anexos A e B da
 * especificação das regras de resposta). Campos que a tela não conhece passam adiante como vieram.
 */
export interface Rule {
  id?: string;
  name: string;
  enabled?: boolean;
  priority?: number;
  match?: RuleMatch;
  scenario?: RuleScenario | null;
  response?: RuleResponse;
  [field: string]: unknown;
}

/** Só casa no estado `requiredState` (ausente = qualquer); ao responder, muda para `newState`. */
export interface RuleScenario {
  name: string;
  requiredState?: string | null;
  newState?: string | null;
}

export interface RuleMatch {
  method?: string[];
  /** `null` (ou ausente) = qualquer caminho. */
  path?: PathMatcher | null;
  query?: Record<string, ValueMatcher>;
  headers?: Record<string, ValueMatcher>;
  body?: BodyMatcher[];
  /** Resultado da verificação de assinatura da URL; ausente (ou `null`) = qualquer. */
  signature?: SignatureCondition | null;
  /** Resultado da validação de schema da URL; ausente (ou `null`) = qualquer. */
  schema?: SchemaCondition | null;
  [field: string]: unknown;
}

export const SIGNATURE_CONDITIONS = ['valid', 'invalid', 'absent'] as const;
/** `absent` = sem o header da assinatura. */
export type SignatureCondition = (typeof SIGNATURE_CONDITIONS)[number];

export const SCHEMA_CONDITIONS = ['valid', 'invalid'] as const;
export type SchemaCondition = (typeof SCHEMA_CONDITIONS)[number];

/** Exatamente um dos três, sobre o caminho depois do token. */
export type PathMatcher = { equals: string } | { prefix: string } | { regex: string };

/** Exatamente um: comparação de texto, ou `present: true|false`. */
export type ValueMatcher =
  { equals: string } | { contains: string } | { regex: string } | { present: boolean };

export type BodyMatcher =
  | { equals: string }
  | { contains: string }
  | { regex: string }
  | { jsonPath: { path: string; equals?: unknown } }
  | { equalToJson: unknown };

export interface RuleResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Corpo e valores dos headers como template Handlebars. */
  template?: boolean;
  delay?: RuleDelay | null;
  dribble?: RuleDribble | null;
  /** Com falha, status, headers, corpo, atraso e dribble são ignorados pelo servidor. */
  fault?: RuleFault | null;
  [field: string]: unknown;
}

/** Atraso antes de responder, em ms; teto de 60 s (`DELAY_MAX_MS`). */
export type RuleDelay =
  | { fixed: number }
  | { uniform: { min: number; max: number } }
  | { lognormal: { median: number; sigma: number } };

/** Corpo dividido em `chunks` pedaços, enviados em intervalos iguais ao longo de `durationMs`. */
export interface RuleDribble {
  chunks: number;
  durationMs: number;
}

export const RULE_FAULTS = [
  'connection_reset',
  'empty_response',
  'malformed_chunk',
  'random_data_then_close',
] as const;
export type RuleFault = (typeof RULE_FAULTS)[number];

export const FAULT_LABELS: Record<RuleFault, string> = {
  connection_reset: 'Connection reset (TCP RST)',
  empty_response: 'Empty response (close without writing)',
  malformed_chunk: 'Malformed chunk (valid status and headers)',
  random_data_then_close: 'Random data, then close',
};

export const DELAY_MAX_MS = 60_000;
export const DRIBBLE_MAX_CHUNKS = 100;
/** Estado inicial de todo cenário (como na WireMock). */
export const SCENARIO_STARTED = 'Started';

/** Regra que respondeu a mensagem (`rule` na mensagem gravada). */
export interface RuleRef {
  id: string;
  name: string;
}

/** Regra mais próxima quando nenhuma casou, com uma frase por condição que falhou. */
export interface NearMiss extends RuleRef {
  failed: string[];
}

export const RULE_DEFAULT_PRIORITY = 5;
export const RULE_DEFAULT_STATUS = 200;

/** Resposta de `POST /token/{id}/rules/test`, da mensagem mais nova para a mais antiga. */
export interface RuleTestResponse {
  matches: { uuid: string; seq: number }[];
  misses: { uuid: string; seq: number; failed: string[] }[];
}

/** Mensagem que a regra não casaria, com a página da lista onde ela está (para o link). */
export interface HistoryMiss {
  uuid: string;
  seq: number;
  failed: string[];
  page: number;
}

/** Resultado do "Test against history" como a tela mostra. */
export interface HistoryTest {
  tested: number;
  matched: number;
  misses: HistoryMiss[];
  /** O servidor só testa as 500 mensagens mais recentes. */
  windowFull: boolean;
}

/** Quantas mensagens, das mais recentes, o `rules/test` avalia. */
export const HISTORY_TEST_WINDOW = 500;
/** Página padrão de `GET /token/{id}/requests`, a da lista lateral. */
const REQUESTS_PER_PAGE = 50;

/**
 * Resume o `rules/test` e acha a página de cada falha na lista lateral, que vai da mais antiga
 * para a mais nova com `total` mensagens: as testadas são as mais novas, então a posição de cada
 * uma sai da ordem dela entre as testadas (pelo `seq`, que só cresce).
 */
export function summarizeHistoryTest(response: RuleTestResponse, total: number): HistoryTest {
  const newestFirst = [...response.matches, ...response.misses]
    .map(({ seq }) => seq)
    .sort((a, b) => b - a);
  const rank = new Map(newestFirst.map((seq, index) => [seq, index]));
  const pageOf = (seq: number) => {
    const position = total - 1 - (rank.get(seq) ?? 0);
    return Math.max(1, Math.floor(position / REQUESTS_PER_PAGE) + 1);
  };
  const tested = newestFirst.length;
  return {
    tested,
    matched: response.matches.length,
    misses: response.misses.map((miss) => ({ ...miss, page: pageOf(miss.seq) })),
    windowFull: tested >= HISTORY_TEST_WINDOW,
  };
}

/** Resumo do match para a lista: `POST /pagamentos`, `ANY prefix /api`, `GET ~ ^/v\d+`. */
export function matchSummary(rule: Rule): string {
  const methods = rule.match?.method?.length ? rule.match.method.join(', ') : 'ANY';
  const path = rule.match?.path;
  if (!path) {
    return `${methods} (any path)`;
  }
  if ('equals' in path) {
    return `${methods} ${path.equals}`;
  }
  if ('prefix' in path) {
    return `${methods} ${path.prefix}*`;
  }
  return `${methods} ~ ${path.regex}`;
}

/** Indicador discreto na lista: rótulo curto e o detalhe para o título. */
export interface RuleFlag {
  label: 'template' | 'delay' | 'fault' | 'scenario';
  detail: string;
}

/**
 * Indicadores de template, atraso, falha e cenário. Com falha, template e atraso não aparecem:
 * o servidor os ignora.
 */
export function ruleFlags(rule: Rule): RuleFlag[] {
  const response = rule.response ?? {};
  const flags: RuleFlag[] = [];
  if (response.fault) {
    const label = FAULT_LABELS[response.fault] ?? response.fault;
    flags.push({ label: 'fault', detail: `Fault: ${label[0].toLowerCase()}${label.slice(1)}` });
  } else {
    if (response.template) {
      flags.push({ label: 'template', detail: 'Body and header values are templates' });
    }
    if (response.delay) {
      flags.push({ label: 'delay', detail: `Delay: ${describeDelay(response.delay)}` });
    }
  }
  if (rule.scenario?.name) {
    const { name, requiredState, newState } = rule.scenario;
    flags.push({
      label: 'scenario',
      detail: `Scenario ${name}: ${requiredState || 'any state'} → ${newState || 'keeps the state'}`,
    });
  }
  return flags;
}

function describeDelay(delay: RuleDelay): string {
  if ('fixed' in delay) {
    return `${delay.fixed} ms`;
  }
  if ('uniform' in delay) {
    return `${delay.uniform.min}–${delay.uniform.max} ms (uniform)`;
  }
  return `~${delay.lognormal.median} ms (log-normal, sigma ${delay.lognormal.sigma})`;
}

/** Cenários citados pelas regras, na ordem da lista, sem repetir. */
export function scenarioNames(rules: readonly Rule[]): string[] {
  return unique(rules.map((rule) => rule.scenario?.name));
}

/** `Started` e os estados que as regras do cenário exigem ou definem. */
export function scenarioStates(rules: readonly Rule[], name: string): string[] {
  const cited = rules
    .filter((rule) => rule.scenario?.name === name)
    .flatMap((rule) => [rule.scenario?.requiredState, rule.scenario?.newState]);
  return unique([SCENARIO_STARTED, ...cited]);
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

/**
 * Ordem em que o servidor avalia as regras: menor prioridade primeiro; empate, a ordem da lista.
 * Devolve os índices da lista na ordem de avaliação.
 */
export function evaluationOrder(rules: readonly Rule[]): number[] {
  return rules
    .map((rule, index) => ({ index, priority: rule.priority ?? RULE_DEFAULT_PRIORITY }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ index }) => index);
}
