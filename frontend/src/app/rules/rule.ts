/**
 * Regra de resposta da URL, no formato de `GET/PUT /token/{id}/rules` (Anexos A e B da
 * especificação das regras de resposta). Campos que a tela não conhece passam adiante como vieram.
 */
export interface Rule {
  id?: string;
  name: string;
  enabled?: boolean;
  priority?: number;
  /** 1–100: a regra só responde essa porcentagem das que casam; ausente = todas. */
  chance?: number | null;
  /** Janela em que a regra vale, ISO-8601 em UTC; cada ponta ausente = aberta. */
  active_from?: string | null;
  active_until?: string | null;
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
  /** Resultado da decifra do atributo na URL; ausente (ou `null`) = qualquer. */
  decryption?: DecryptionCondition | null;
  [field: string]: unknown;
}

export const SIGNATURE_CONDITIONS = ['valid', 'invalid', 'absent'] as const;
/** `absent` = sem o header da assinatura. */
export type SignatureCondition = (typeof SIGNATURE_CONDITIONS)[number];

export const SCHEMA_CONDITIONS = ['valid', 'invalid'] as const;
export type SchemaCondition = (typeof SCHEMA_CONDITIONS)[number];

export const DECRYPTION_CONDITIONS = ['valid', 'invalid', 'unknown_kid', 'absent'] as const;
/** `absent` = o atributo veio em claro e a URL aceita. */
export type DecryptionCondition = (typeof DECRYPTION_CONDITIONS)[number];

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
  /**
   * Com falha, atraso e dribble são ignorados pelo servidor; status, headers e corpo também, fora
   * das falhas de `FAULTS_WITH_RESPONSE`.
   */
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
  'hang',
  'stall_after_headers',
  'truncated_body',
] as const;
export type RuleFault = (typeof RULE_FAULTS)[number];

/** Falhas que mandam o status, os headers e o corpo da regra antes de parar; exigem corpo. */
export const FAULTS_WITH_RESPONSE: readonly RuleFault[] = ['stall_after_headers', 'truncated_body'];

export const FAULT_LABELS: Record<RuleFault, string> = {
  connection_reset: $localize`Connection reset (TCP RST)`,
  empty_response: $localize`Empty response (close without writing)`,
  malformed_chunk: $localize`Malformed chunk (valid status and headers)`,
  random_data_then_close: $localize`Random data, then close`,
  hang: $localize`Hang (no response until the client gives up)`,
  stall_after_headers: $localize`Stall after headers (status and headers, then nothing)`,
  truncated_body: $localize`Truncated body (half the body, then close)`,
};

/** O tipo da falha em poucas palavras, no lugar do status na lista (L11). */
export const FAULT_SHORT_LABELS: Record<RuleFault, string> = {
  connection_reset: $localize`:fault kind, short:TCP RST`,
  empty_response: $localize`:fault kind, short:Empty response`,
  malformed_chunk: $localize`:fault kind, short:Malformed chunk`,
  random_data_then_close: $localize`:fault kind, short:Random data`,
  hang: $localize`:fault kind, short:Hang`,
  stall_after_headers: $localize`:fault kind, short:Stall`,
  truncated_body: $localize`:fault kind, short:Truncated`,
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
  /**
   * A condição de cada frase de `failed`, na mesma ordem (`match.method`, `match.headers.X-Sig`,
   * `match.body.0`, `scenario`…). `null` em mensagem gravada antes do campo; ausente em servidor
   * anterior a ele.
   */
  conditions?: string[] | null;
}

export const RULE_DEFAULT_PRIORITY = 5;
export const RULE_DEFAULT_STATUS = 200;

/**
 * `GET /token/{id}/request/{rid}/rules/trace` (C1): quem respondeu (o que a mensagem gravou) e cada
 * regra de agora, na ordem de avaliação (as desligadas no fim, `position: null`), com as frases do
 * near miss de cada uma.
 */
export interface RuleTrace {
  request: string;
  responded_by: RuleRef | null;
  rules: {
    id: string;
    name: string;
    enabled: boolean;
    position: number | null;
    matches: boolean;
    failed: string[];
    conditions: string[];
  }[];
}

/**
 * A resposta que a regra daria a uma mensagem (`rules/test?render=N`, C4): status, cabeçalhos e
 * corpo, ou a falha de rede, ou `error: "timeout"` quando o prazo de 1 s estourou.
 */
export interface RenderedResponse {
  uuid: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  fault?: string;
  error?: string;
}

/** Resposta de `POST /token/{id}/rules/test`, da mensagem mais nova para a mais antiga. */
export interface RuleTestResponse {
  matches: { uuid: string; seq: number }[];
  /** Só com `?render=N` (C4). */
  rendered?: RenderedResponse[];
  misses: { uuid: string; seq: number; failed: string[]; conditions?: string[] | null }[];
}

/** Mensagem que a regra não casaria, com a página da lista onde ela está (para o link). */
export interface HistoryMiss {
  uuid: string;
  seq: number;
  failed: string[];
  /** A condição de cada frase de `failed` (B1); ausente em servidor anterior ao campo. */
  conditions?: string[] | null;
  page: number;
}

/** Mensagem que a regra casaria, com a página da lista onde ela está (para o link). */
export interface HistoryMatch {
  uuid: string;
  seq: number;
  page: number;
}

/** Resultado do "Test against history" como a tela mostra. */
export interface HistoryTest {
  tested: number;
  matched: number;
  /** As mensagens que a regra casaria, da mais nova para a mais antiga (para a prévia, S8). */
  matches: string[];
  /** As mesmas, com o seq e a página (a coluna "Would match" da aba Test, RULES-20). */
  matchList: HistoryMatch[];
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
    matches: response.matches.map(({ uuid }) => uuid),
    matchList: response.matches.map(({ uuid, seq }) => ({ uuid, seq, page: pageOf(seq) })),
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

/**
 * Indicador discreto na lista: o tipo (`label`, para estilo e lógica), o texto traduzido e o
 * detalhe para o título. Os de diagnóstico (pega-tudo, nunca casa, sombra) saem de `rule-shadow`.
 */
export interface RuleFlag {
  label:
    | 'template'
    | 'delay'
    | 'fault'
    | 'chance'
    | 'window'
    | 'scenario'
    | 'catch-all'
    | 'never'
    | 'shadowed'
    | 'likely';
  text: string;
  detail: string;
}

/**
 * Indicadores de template, atraso, falha, chance, janela e cenário. Com falha, o atraso não
 * aparece, e o template só nas falhas que mandam o corpo: o servidor ignora o resto.
 */
export function ruleFlags(rule: Rule): RuleFlag[] {
  const response = rule.response ?? {};
  const fault = response.fault;
  const flags: RuleFlag[] = [];
  if (fault) {
    const label = FAULT_LABELS[fault] ?? fault;
    flags.push({
      label: 'fault',
      text: $localize`:rule flag|Network fault instead of a response:Fault`,
      detail: $localize`Fault: ${label[0].toLowerCase()}${label.slice(1)}`,
    });
  }
  if (response.template && (!fault || FAULTS_WITH_RESPONSE.includes(fault))) {
    flags.push({
      label: 'template',
      text: $localize`:rule flag|The response is a Handlebars template:Template`,
      detail: $localize`Body and header values are templates`,
    });
  }
  if (response.delay && !fault) {
    flags.push({
      label: 'delay',
      text: $localize`:rule flag|The response waits before answering:Delay`,
      detail: $localize`Delay: ${describeDelay(response.delay)}`,
    });
  }
  if (rule.chance) {
    flags.push({
      label: 'chance',
      text: $localize`:rule flag|The rule answers only a share of the matching requests:Chance`,
      detail: $localize`Chance: ${rule.chance}:chance:% of the matching requests`,
    });
  }
  if (rule.active_from || rule.active_until) {
    flags.push({
      label: 'window',
      text: $localize`:rule flag|The rule only answers within a time window:Window`,
      detail: windowDetail(rule.active_from, rule.active_until),
    });
  }
  if (rule.scenario?.name) {
    const { name, requiredState, newState } = rule.scenario;
    flags.push({
      label: 'scenario',
      text: $localize`:rule flag|The rule belongs to a scenario:Scenario`,
      detail: $localize`Scenario ${name}:scenario:: ${requiredState || $localize`any state`}:from: → ${newState || $localize`keeps the state`}:to:`,
    });
  }
  return flags;
}

function windowDetail(from: string | null | undefined, until: string | null | undefined): string {
  if (from && until) {
    return $localize`Active from ${from}:from: until ${until}:until: (UTC)`;
  }
  return from
    ? $localize`Active from ${from}:from: (UTC)`
    : $localize`Active until ${until}:until: (UTC)`;
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

/**
 * Leva a regra da posição `from` para `to` na ordem de avaliação. As prioridades ficam com as
 * posições (a regra que passa a ocupar uma posição recebe a prioridade que estava nela), então a
 * ordem de avaliação passa a ser a lista nova; um passo só troca as prioridades das duas vizinhas.
 * Devolve a lista na ordem de avaliação, pronta para o `PUT`.
 */
export function moveInOrder(rules: readonly Rule[], from: number, to: number): Rule[] {
  const ordered = evaluationOrder(rules).map((index) => rules[index]);
  const priorities = ordered.map((rule) => rule.priority ?? RULE_DEFAULT_PRIORITY);
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  return ordered.map((rule, position) =>
    (rule.priority ?? RULE_DEFAULT_PRIORITY) === priorities[position]
      ? rule
      : { ...rule, priority: priorities[position] },
  );
}

/** A regra não tem condição nem cenário: casa toda requisição. */
export function hasNoCondition(rule: Rule): boolean {
  const match = rule.match ?? {};
  return (
    !match.method?.length &&
    !match.path &&
    Object.keys(match.query ?? {}).length === 0 &&
    Object.keys(match.headers ?? {}).length === 0 &&
    !match.body?.length &&
    !match.signature &&
    !match.schema &&
    !match.decryption &&
    !rule.scenario?.name
  );
}

/**
 * O caminho da regra é o que vem depois do token da URL: um caminho que começa com o próprio
 * token (`/{uuid}/pagamentos`) nunca casa. Devolve o caminho sem o token, ou `null` quando não há
 * o que corrigir.
 */
export function pathWithoutToken(path: string, tokenId: string): string | null {
  const prefix = `/${tokenId}`.toLowerCase();
  if (!tokenId || !path.toLowerCase().startsWith(prefix)) {
    return null;
  }
  const rest = path.slice(prefix.length);
  if (rest === '') {
    return '/';
  }
  return rest.startsWith('/') ? rest : null;
}
