/**
 * Regra de resposta da URL, no formato de `GET/PUT /token/{id}/rules` (Anexo A da especificação
 * das regras de resposta). Campos que a tela não edita (`scenario`, `delay`, `dribble`, `fault`,
 * `template`) passam adiante como vieram.
 */
export interface Rule {
  id?: string;
  name: string;
  enabled?: boolean;
  priority?: number;
  match?: RuleMatch;
  scenario?: unknown;
  response?: RuleResponse;
  [field: string]: unknown;
}

export interface RuleMatch {
  method?: string[];
  /** `null` (ou ausente) = qualquer caminho. */
  path?: PathMatcher | null;
  query?: Record<string, ValueMatcher>;
  headers?: Record<string, ValueMatcher>;
  body?: BodyMatcher[];
  [field: string]: unknown;
}

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
  [field: string]: unknown;
}

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
