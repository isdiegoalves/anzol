import {
  BodyMatcher,
  DELAY_MAX_MS,
  DRIBBLE_MAX_CHUNKS,
  FAULTS_WITH_RESPONSE,
  PathMatcher,
  RULE_DEFAULT_PRIORITY,
  RULE_DEFAULT_STATUS,
  RULE_FAULTS,
  Rule,
  RuleDelay,
  RuleFault,
  RuleScenario,
  SCHEMA_CONDITIONS,
  SIGNATURE_CONDITIONS,
  SchemaCondition,
  SignatureCondition,
  ValueMatcher,
} from './rule';

// Conversão entre a regra (JSON da API) e os valores do formulário do editor, e onde cada erro
// 422 do servidor aparece no formulário. Funções puras: o componente só liga ao Reactive Forms.

export const TEXT_OPERATORS = ['equals', 'contains', 'regex'] as const;
export type TextOperator = (typeof TEXT_OPERATORS)[number];
export type ValueOperator = TextOperator | 'present' | 'absent';
/** Como o caminho casa; com o caminho vazio, qualquer um casa (WM-14). */
export type PathMode = 'equals' | 'prefix' | 'regex';
export type BodyType = TextOperator | 'jsonPath' | 'equalToJson';

export interface ConditionRow {
  name: string;
  operator: ValueOperator;
  value: string;
}

/** Condição de corpo: `value` para texto e `equalToJson`; `path` e `equals` para o JSONPath. */
export interface BodyRow {
  type: BodyType;
  value: string;
  path: string;
  /** Valor JSON (`"pago"`, `10`, `true`); texto que não é JSON vale como texto; vazio = existe. */
  equals: string;
}

export interface HeaderRow {
  name: string;
  value: string;
}

export interface RuleFormValue {
  name: string;
  enabled: boolean;
  priority: number;
  methods: string[];
  pathMode: PathMode;
  path: string;
  query: ConditionRow[];
  headers: ConditionRow[];
  body: BodyRow[];
  /** `any` = sem condição (a chave fica fora do match). */
  signature: SignatureOption;
  /** `any` = sem condição (a chave fica fora do match). */
  schema: SchemaOption;
  /** Vazio = toda requisição que casa (a chave fica fora da regra). */
  chance: number | null;
  windowMode: WindowMode;
  /** "For the next minutes": a janela vai da hora do Save até N minutos depois. */
  windowMinutes: number;
  /** "Between dates": vazio = ponta aberta. */
  activeFrom: string;
  activeUntil: string;
  status: number;
  responseHeaders: HeaderRow[];
  responseBody: string;
  template: boolean;
  /** Os parâmetros de todos os tipos ficam no formulário; só os do tipo escolhido vão na regra. */
  delayType: DelayType;
  delayFixed: number;
  delayMin: number;
  delayMax: number;
  delayMedian: number;
  delaySigma: number;
  dribble: boolean;
  dribbleChunks: number;
  dribbleDuration: number;
  fault: FaultOption;
  /** Vazio = regra sem cenário. */
  scenarioName: string;
  /** Vazio = qualquer estado. */
  requiredState: string;
  /** Vazio = mantém o estado. */
  newState: string;
}

export type SignatureOption = 'any' | SignatureCondition;
export type SchemaOption = 'any' | SchemaCondition;
export type DelayType = 'none' | 'fixed' | 'uniform' | 'lognormal';
export type FaultOption = 'none' | RuleFault;
export type WindowMode = 'always' | 'minutes' | 'dates';

export const WINDOW_MINUTES_DEFAULT = 15;
/** Uma semana. */
export const WINDOW_MINUTES_MAX = 10_080;

/** Valores que o editor sugere ao escolher um tipo de atraso ou ligar o dribble. */
const PHASE_B_DEFAULTS = {
  delayFixed: 1000,
  delayMin: 500,
  delayMax: 2000,
  delayMedian: 1000,
  delaySigma: 0.5,
  dribbleChunks: 5,
  dribbleDuration: 2000,
};

/** Regra nova: habilitada, prioridade e status padrão do servidor, casando qualquer mensagem. */
export function newRule(): Rule {
  return {
    name: '',
    enabled: true,
    priority: RULE_DEFAULT_PRIORITY,
    match: { method: [], path: null, query: {}, headers: {}, body: [] },
    response: { status: RULE_DEFAULT_STATUS, headers: {}, body: '' },
  };
}

export function toFormValue(rule: Rule): RuleFormValue {
  const match = rule.match ?? {};
  const path = match.path ?? null;
  const pathMode = path ? (Object.keys(path)[0] as PathMode) : 'equals';
  return {
    name: rule.name ?? '',
    enabled: rule.enabled ?? true,
    priority: rule.priority ?? RULE_DEFAULT_PRIORITY,
    methods: [...(match.method ?? [])],
    pathMode,
    // `equals ""` é a raiz, como "/"; vazio no formulário passou a ser qualquer caminho.
    path: path ? Object.values(path)[0] || (pathMode === 'equals' ? '/' : '') : '',
    query: conditionRows(match.query),
    headers: conditionRows(match.headers),
    body: (match.body ?? []).map(bodyRow),
    signature: match.signature ?? 'any',
    schema: match.schema ?? 'any',
    chance: rule.chance ?? null,
    windowMode: rule.active_from || rule.active_until ? 'dates' : 'always',
    windowMinutes: WINDOW_MINUTES_DEFAULT,
    activeFrom: rule.active_from ?? '',
    activeUntil: rule.active_until ?? '',
    status: rule.response?.status ?? RULE_DEFAULT_STATUS,
    responseHeaders: Object.entries(rule.response?.headers ?? {}).map(([name, value]) => ({
      name,
      value,
    })),
    responseBody: rule.response?.body ?? '',
    template: rule.response?.template ?? false,
    ...delayFields(rule.response?.delay),
    dribble: !!rule.response?.dribble,
    dribbleChunks: rule.response?.dribble?.chunks ?? PHASE_B_DEFAULTS.dribbleChunks,
    dribbleDuration: rule.response?.dribble?.durationMs ?? PHASE_B_DEFAULTS.dribbleDuration,
    fault: rule.response?.fault ?? 'none',
    scenarioName: rule.scenario?.name ?? '',
    requiredState: rule.scenario?.requiredState ?? '',
    newState: rule.scenario?.newState ?? '',
  };
}

function delayFields(delay: RuleDelay | null | undefined) {
  const fields = { delayType: 'none' as DelayType, ...PHASE_B_DEFAULTS };
  if (!delay) {
    return fields;
  }
  if ('fixed' in delay) {
    return { ...fields, delayType: 'fixed' as const, delayFixed: delay.fixed };
  }
  if ('uniform' in delay) {
    const { min, max } = delay.uniform;
    return { ...fields, delayType: 'uniform' as const, delayMin: min, delayMax: max };
  }
  const { median, sigma } = delay.lognormal;
  return { ...fields, delayType: 'lognormal' as const, delayMedian: median, delaySigma: sigma };
}

function delayOf(form: RuleFormValue): RuleDelay | null {
  switch (form.delayType) {
    case 'fixed':
      return { fixed: Number(form.delayFixed) };
    case 'uniform':
      return { uniform: { min: Number(form.delayMin), max: Number(form.delayMax) } };
    case 'lognormal':
      return {
        lognormal: { median: Number(form.delayMedian), sigma: Number(form.delaySigma) },
      };
    default:
      return null;
  }
}

/** Nome vazio = sem cenário; estado vazio fica de fora (qualquer estado / mantém o estado). */
function scenarioOf(form: RuleFormValue): RuleScenario | null {
  if (form.scenarioName.trim() === '') {
    return null;
  }
  return {
    name: form.scenarioName,
    ...(form.requiredState.trim() !== '' && { requiredState: form.requiredState }),
    ...(form.newState.trim() !== '' && { newState: form.newState }),
  };
}

function windowOf(form: RuleFormValue, now: number): Pick<Rule, 'active_from' | 'active_until'> {
  switch (form.windowMode) {
    case 'minutes': {
      const from = Math.floor(now / 1000) * 1000;
      return {
        active_from: isoSecond(from),
        active_until: isoSecond(from + Number(form.windowMinutes) * 60_000),
      };
    }
    case 'dates':
      return {
        active_from: form.activeFrom.trim() || null,
        active_until: form.activeUntil.trim() || null,
      };
    default:
      return { active_from: null, active_until: null };
  }
}

/** `2026-09-29T12:00:30Z`: o formato em que o servidor devolve as pontas da janela. */
export function isoSecond(time: number): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Regra com os valores do formulário por cima de `base`: o que a tela não edita (`id` e campos
 * que ela não conhece) segue como veio. O match e a resposta saem no formato normalizado do
 * servidor, com as seções vazias em vez de ausentes. Com falha, atraso e dribble vão nulos (o
 * servidor os ignoraria); status, headers e corpo ficam, para a regra voltar a eles sem a falha.
 * Chance e janela vazias saem da regra, como o servidor as devolve.
 */
export function fromFormValue(form: RuleFormValue, base: Rule, now: number = Date.now()): Rule {
  const faulted = form.fault !== 'none';
  const match = {
    ...base.match,
    method: [...form.methods],
    // Caminho vazio = qualquer caminho (WM-14): o modo só vale com texto.
    path: form.path === '' ? null : ({ [form.pathMode]: form.path } as PathMatcher),
    query: conditionMap(form.query),
    headers: conditionMap(form.headers),
    body: form.body.map(bodyMatcher),
    signature: form.signature === 'any' ? undefined : form.signature,
    schema: form.schema === 'any' ? undefined : form.schema,
  };
  // Sem condição de assinatura ou de schema, a chave fica fora, como o servidor a devolve.
  if (match.signature === undefined) {
    delete match.signature;
  }
  if (match.schema === undefined) {
    delete match.schema;
  }
  const rule: Rule = {
    ...base,
    name: form.name,
    enabled: form.enabled,
    priority: Number(form.priority),
    chance: form.chance === null ? null : Number(form.chance),
    ...windowOf(form, now),
    match,
    scenario: scenarioOf(form),
    response: {
      ...base.response,
      status: Number(form.status),
      headers: Object.fromEntries(form.responseHeaders.map((row) => [row.name, row.value])),
      body: form.responseBody,
      template: form.template,
      delay: faulted ? null : delayOf(form),
      dribble:
        faulted || !form.dribble
          ? null
          : { chunks: Number(form.dribbleChunks), durationMs: Number(form.dribbleDuration) },
      fault: form.fault === 'none' ? null : form.fault,
    },
  };
  for (const key of ['chance', 'active_from', 'active_until'] as const) {
    if (rule[key] === null || rule[key] === undefined) {
      delete rule[key];
    }
  }
  return rule;
}

function conditionRows(conditions: Record<string, ValueMatcher> | undefined): ConditionRow[] {
  return Object.entries(conditions ?? {}).map(([name, condition]) => {
    if ('present' in condition) {
      return { name, operator: condition.present ? 'present' : 'absent', value: '' };
    }
    const operator = TEXT_OPERATORS.find((op) => op in condition) ?? 'equals';
    return { name, operator, value: (condition as Record<TextOperator, string>)[operator] ?? '' };
  });
}

function conditionMap(rows: readonly ConditionRow[]): Record<string, ValueMatcher> {
  return Object.fromEntries(
    rows.map((row): [string, ValueMatcher] => {
      if (row.operator === 'present' || row.operator === 'absent') {
        return [row.name, { present: row.operator === 'present' }];
      }
      return [row.name, { [row.operator]: row.value } as ValueMatcher];
    }),
  );
}

function bodyRow(condition: BodyMatcher): BodyRow {
  const row: BodyRow = { type: 'equals', value: '', path: '', equals: '' };
  if ('jsonPath' in condition) {
    const { path, equals } = condition.jsonPath;
    return {
      ...row,
      type: 'jsonPath',
      path: path ?? '',
      equals: equals === undefined ? '' : JSON.stringify(equals),
    };
  }
  if ('equalToJson' in condition) {
    const json = condition.equalToJson;
    return {
      ...row,
      type: 'equalToJson',
      value: typeof json === 'string' ? json : JSON.stringify(json),
    };
  }
  const type = TEXT_OPERATORS.find((op) => op in condition) ?? 'equals';
  return { ...row, type, value: (condition as Record<TextOperator, string>)[type] ?? '' };
}

function bodyMatcher(row: BodyRow): BodyMatcher {
  switch (row.type) {
    case 'jsonPath':
      return {
        jsonPath:
          row.equals.trim() === ''
            ? { path: row.path }
            : { path: row.path, equals: looseJson(row.equals) },
      };
    case 'equalToJson': {
      // Texto que é JSON de objeto, lista, número... vai como JSON; o resto vai como o texto de um
      // JSON, que o servidor valida (inválido → 422 no campo).
      const parsed = looseJson(row.value);
      return { equalToJson: typeof parsed === 'string' ? row.value : parsed };
    }
    default:
      return { [row.type]: row.value } as BodyMatcher;
  }
}

/** JSON quando o texto é JSON; senão, o próprio texto (`pago` vale `"pago"`). */
function looseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

type SingleField = Exclude<
  keyof RuleFormValue,
  'enabled' | 'pathMode' | 'query' | 'headers' | 'body' | 'responseHeaders'
>;
type RowList = 'query' | 'headers' | 'body' | 'responseHeaders';
type RowField = 'name' | 'value' | 'path' | 'equals';

/** Campo do formulário onde um erro do servidor aparece. */
export type FieldRef = { field: SingleField } | { list: RowList; index: number; field: RowField };

/** Prefixo da chave → campo; o prefixo mais longo que casa vence. */
const SINGLE_FIELDS: [string, SingleField][] = (
  [
    ['name', 'name'],
    ['priority', 'priority'],
    ['match.method', 'methods'],
    ['match.path', 'path'],
    ['match.signature', 'signature'],
    ['match.schema', 'schema'],
    ['response.status', 'status'],
    ['response.body', 'responseBody'],
    ['response.template', 'template'],
    ['response.delay.fixed', 'delayFixed'],
    ['response.delay.uniform.min', 'delayMin'],
    ['response.delay.uniform', 'delayMax'],
    ['response.delay.lognormal.median', 'delayMedian'],
    ['response.delay.lognormal', 'delaySigma'],
    ['response.dribble.durationMs', 'dribbleDuration'],
    ['response.dribble', 'dribbleChunks'],
    ['response.fault', 'fault'],
    ['scenario.requiredState', 'requiredState'],
    ['scenario.newState', 'newState'],
    ['scenario', 'scenarioName'],
    ['chance', 'chance'],
    ['active_from', 'activeFrom'],
    ['active_until', 'activeUntil'],
  ] as [string, SingleField][]
).sort(([a], [b]) => b.length - a.length);

/** Erro no atraso inteiro: vai para o parâmetro principal do tipo escolhido. */
const DELAY_FIELDS: Record<DelayType, SingleField> = {
  none: 'delayType',
  fixed: 'delayFixed',
  uniform: 'delayMin',
  lognormal: 'delayMedian',
};

/**
 * Campo do formulário para a chave de um erro 422, já sem o índice da regra na lista
 * (`match.path.regex`, `match.headers.X-Signature.present`, `match.body.1.jsonPath.path`).
 * `null` quando o erro não tem campo no formulário.
 */
export function locateError(key: string, form: RuleFormValue): FieldRef | null {
  if (key === 'response.delay') {
    return { field: DELAY_FIELDS[form.delayType] };
  }
  const single = SINGLE_FIELDS.find(([prefix]) => key === prefix || key.startsWith(`${prefix}.`));
  if (single) {
    return { field: single[1] };
  }
  const body = /^match\.body\.(\d+)(?:\.(.+))?$/.exec(key);
  if (body) {
    return locateBodyError(Number(body[1]), body[2], form);
  }
  for (const [prefix, list] of [
    ['match.query.', 'query'],
    ['match.headers.', 'headers'],
    ['response.headers.', 'responseHeaders'],
  ] as const) {
    if (key.startsWith(prefix)) {
      return locateNamedRow(list, key.slice(prefix.length), form);
    }
  }
  return null;
}

function locateBodyError(
  index: number,
  rest: string | undefined,
  form: RuleFormValue,
): FieldRef | null {
  const row = form.body[index];
  if (!row) {
    return null;
  }
  if (rest === 'jsonPath.equals') {
    return { list: 'body', index, field: 'equals' };
  }
  const onPath = rest?.startsWith('jsonPath') || (rest === undefined && row.type === 'jsonPath');
  return { list: 'body', index, field: onPath ? 'path' : 'value' };
}

/** Linha pelo nome (cabeçalho sem caixa); o erro na própria chave do nome vai para o nome. */
function locateNamedRow(
  list: 'query' | 'headers' | 'responseHeaders',
  rest: string,
  form: RuleFormValue,
): FieldRef | null {
  const caseless = list !== 'query';
  const normalize = (text: string) => (caseless ? text.toLowerCase() : text);
  const target = normalize(rest);
  const index = form[list].findIndex(({ name }) => {
    const candidate = normalize(name);
    return target === candidate || target.startsWith(`${candidate}.`);
  });
  if (index < 0) {
    return null;
  }
  const onName = target === normalize(form[list][index].name) && list !== 'responseHeaders';
  return { list, index, field: onName ? 'name' : 'value' };
}

export interface ParsedRule {
  rule?: Rule;
  errors: string[];
}

/**
 * JSON da aba "JSON": precisa ser uma regra no formato do servidor, para o formulário poder
 * mostrá-la. Erros com a chave em notação de ponto e mensagens no estilo das do servidor; o que
 * depende do servidor (regex Java, JSONPath, campos das fatias seguintes) fica para o 422.
 */
export function parseRuleJson(text: string): ParsedRule {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { errors: [$localize`Invalid JSON: ${(error as Error).message}`] };
  }
  if (!isObject(value)) {
    return { errors: [$localize`The rule must be a JSON object.`] };
  }
  const errors = [
    ...ruleFieldErrors(value),
    ...matchErrors(value['match']),
    ...responseErrors(value['response']),
    ...scenarioErrors(value['scenario']),
  ];
  return errors.length > 0 ? { errors } : { rule: value as Rule, errors };
}

function ruleFieldErrors(rule: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const name = rule['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('name: The name field is required.');
  } else if (name.length > 100) {
    errors.push('name: The name may not be greater than 100 characters.');
  }
  if (rule['enabled'] !== undefined && typeof rule['enabled'] !== 'boolean') {
    errors.push('enabled: The enabled field must be true or false.');
  }
  const priority = rule['priority'];
  if (priority !== undefined && !(Number.isInteger(priority) && (priority as number) >= 1)) {
    errors.push('priority: The priority must be an integer of at least 1.');
  }
  const chance = rule['chance'];
  if (chance !== undefined && chance !== null) {
    if (!Number.isInteger(chance)) {
      errors.push('chance: The chance must be an integer.');
    } else if ((chance as number) < 1 || (chance as number) > 100) {
      errors.push('chance: The chance must be between 1 and 100.');
    }
  }
  for (const [key, field] of [
    ['active_from', 'active from'],
    ['active_until', 'active until'],
  ]) {
    const value = rule[key];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      errors.push(
        `${key}: The ${field} must be an ISO-8601 date-time with a time zone, like 2026-09-29T12:00:00Z.`,
      );
    }
  }
  return errors;
}

function matchErrors(match: unknown): string[] {
  if (match === undefined || match === null) {
    return [];
  }
  if (!isObject(match)) {
    return ['match: The match must be an object.'];
  }
  const errors: string[] = [];
  const method = match['method'];
  if (
    method !== undefined &&
    !(Array.isArray(method) && method.every((m) => typeof m === 'string'))
  ) {
    errors.push('match.method: The method must be a list of HTTP methods.');
  }
  const path = match['path'];
  if (path !== undefined && path !== null && !hasOneTextKey(path, ['equals', 'prefix', 'regex'])) {
    errors.push('match.path: The path must have exactly one of equals, prefix, regex.');
  }
  errors.push(...conditionErrors('match.query', match['query']));
  errors.push(...conditionErrors('match.headers', match['headers']));
  errors.push(...bodyErrors(match['body']));
  const signature = match['signature'];
  if (
    signature !== undefined &&
    signature !== null &&
    !SIGNATURE_CONDITIONS.includes(signature as SignatureCondition)
  ) {
    errors.push('match.signature: The selected signature is invalid.');
  }
  const schema = match['schema'];
  if (
    schema !== undefined &&
    schema !== null &&
    !SCHEMA_CONDITIONS.includes(schema as SchemaCondition)
  ) {
    errors.push('match.schema: The selected schema is invalid.');
  }
  return errors;
}

function conditionErrors(key: string, conditions: unknown): string[] {
  if (conditions === undefined || conditions === null) {
    return [];
  }
  if (!isObject(conditions)) {
    return [`${key}: The conditions must be an object.`];
  }
  return Object.entries(conditions)
    .filter(([, condition]) => !isValueCondition(condition))
    .map(
      ([name]) =>
        `${key}.${name}: The condition must have exactly one of equals, contains, regex, present.`,
    );
}

function isValueCondition(condition: unknown): boolean {
  if (!isObject(condition) || Object.keys(condition).length !== 1) {
    return false;
  }
  return 'present' in condition
    ? typeof condition['present'] === 'boolean'
    : hasOneTextKey(condition, TEXT_OPERATORS);
}

function bodyErrors(body: unknown): string[] {
  if (body === undefined || body === null) {
    return [];
  }
  if (!Array.isArray(body)) {
    return ['match.body: The body must be a list of conditions.'];
  }
  return body.flatMap((condition, index): string[] => {
    const key = `match.body.${index}`;
    if (!isObject(condition) || Object.keys(condition).length !== 1) {
      return [`${key}: The condition must have exactly one of ${BODY_KEYS}.`];
    }
    if ('jsonPath' in condition) {
      const jsonPath = condition['jsonPath'];
      const path = isObject(jsonPath) ? jsonPath['path'] : undefined;
      return typeof path === 'string' && path !== ''
        ? []
        : [`${key}.jsonPath.path: The path field is required.`];
    }
    if ('equalToJson' in condition) {
      return [];
    }
    return hasOneTextKey(condition, TEXT_OPERATORS)
      ? []
      : [`${key}: The condition must have exactly one of ${BODY_KEYS}.`];
  });
}

const BODY_KEYS = 'equals, contains, regex, jsonPath, equalToJson';

function responseErrors(response: unknown): string[] {
  if (response === undefined || response === null) {
    return [];
  }
  if (!isObject(response)) {
    return ['response: The response must be an object.'];
  }
  const errors: string[] = [];
  const status = response['status'];
  if (
    status !== undefined &&
    !(Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599)
  ) {
    errors.push('response.status: The status must be an integer between 100 and 599.');
  }
  const headers = response['headers'];
  if (headers !== undefined && headers !== null) {
    if (!isObject(headers)) {
      errors.push('response.headers: The headers must be an object.');
    } else {
      for (const [name, value] of Object.entries(headers)) {
        if (typeof value !== 'string') {
          errors.push(`response.headers.${name}: The header value must be text.`);
        }
      }
    }
  }
  if (response['body'] !== undefined && typeof response['body'] !== 'string') {
    errors.push('response.body: The body must be text.');
  }
  const template = response['template'];
  if (template !== undefined && template !== null && typeof template !== 'boolean') {
    errors.push('response.template: The template field must be true or false.');
  }
  errors.push(...delayErrors(response['delay']));
  errors.push(...dribbleErrors(response['dribble']));
  const fault = response['fault'];
  if (fault !== undefined && fault !== null && !RULE_FAULTS.includes(fault as RuleFault)) {
    errors.push(`response.fault: The fault must be one of ${RULE_FAULTS.join(', ')}.`);
  }
  if (FAULTS_WITH_RESPONSE.includes(fault as RuleFault) && !response['body']) {
    errors.push(`response.body: The body field is required when fault is ${String(fault)}.`);
  }
  return errors;
}

const MS_RANGE = `an integer between 0 and ${DELAY_MAX_MS}`;

function isMs(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= DELAY_MAX_MS;
}

function delayErrors(delay: unknown): string[] {
  if (delay === undefined || delay === null) {
    return [];
  }
  const key = 'response.delay';
  const types = ['fixed', 'uniform', 'lognormal'];
  if (
    !isObject(delay) ||
    Object.keys(delay).length !== 1 ||
    !types.includes(Object.keys(delay)[0])
  ) {
    return [`${key}: The delay must have exactly one of fixed, uniform, lognormal.`];
  }
  if ('fixed' in delay) {
    return isMs(delay['fixed']) ? [] : [`${key}.fixed: The delay must be ${MS_RANGE} ms.`];
  }
  if ('uniform' in delay) {
    const uniform = isObject(delay['uniform']) ? delay['uniform'] : {};
    const errors = ['min', 'max']
      .filter((field) => !isMs(uniform[field]))
      .map((field) => `${key}.uniform.${field}: The ${field} must be ${MS_RANGE} ms.`);
    if (errors.length === 0 && (uniform['min'] as number) > (uniform['max'] as number)) {
      errors.push(`${key}.uniform.max: The max must be at least the min.`);
    }
    return errors;
  }
  const lognormal = isObject(delay['lognormal']) ? delay['lognormal'] : {};
  const errors: string[] = [];
  if (!isMs(lognormal['median'])) {
    errors.push(`${key}.lognormal.median: The median must be ${MS_RANGE} ms.`);
  }
  const sigma = lognormal['sigma'];
  if (typeof sigma !== 'number' || sigma < 0) {
    errors.push(`${key}.lognormal.sigma: The sigma must be a number of at least 0.`);
  }
  return errors;
}

function dribbleErrors(dribble: unknown): string[] {
  if (dribble === undefined || dribble === null) {
    return [];
  }
  if (!isObject(dribble)) {
    return ['response.dribble: The dribble must be an object with chunks and durationMs.'];
  }
  const errors: string[] = [];
  const chunks = dribble['chunks'];
  const count = chunks as number;
  if (!(Number.isInteger(chunks) && count >= 1 && count <= DRIBBLE_MAX_CHUNKS)) {
    errors.push(
      `response.dribble.chunks: The chunks must be an integer between 1 and ${DRIBBLE_MAX_CHUNKS}.`,
    );
  }
  if (!isMs(dribble['durationMs'])) {
    errors.push(`response.dribble.durationMs: The duration must be ${MS_RANGE} ms.`);
  }
  return errors;
}

function scenarioErrors(scenario: unknown): string[] {
  if (scenario === undefined || scenario === null) {
    return [];
  }
  if (!isObject(scenario)) {
    return ['scenario: The scenario must be an object.'];
  }
  const errors: string[] = [];
  const name = scenario['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('scenario.name: The scenario name field is required.');
  } else if (name.length > 100) {
    errors.push('scenario.name: The scenario name may not be greater than 100 characters.');
  }
  for (const field of ['requiredState', 'newState']) {
    const state = scenario[field];
    if (state !== undefined && state !== null && typeof state !== 'string') {
      errors.push(`scenario.${field}: The ${field} must be text.`);
    }
  }
  return errors;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOneTextKey(value: unknown, keys: readonly string[]): boolean {
  if (!isObject(value)) {
    return false;
  }
  const present = Object.keys(value);
  return present.length === 1 && keys.includes(present[0]) && typeof value[present[0]] === 'string';
}
