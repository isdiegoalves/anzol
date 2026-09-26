import {
  BodyMatcher,
  PathMatcher,
  RULE_DEFAULT_PRIORITY,
  RULE_DEFAULT_STATUS,
  Rule,
  ValueMatcher,
} from './rule';

// Conversão entre a regra (JSON da API) e os valores do formulário do editor, e onde cada erro
// 422 do servidor aparece no formulário. Funções puras: o componente só liga ao Reactive Forms.

export const TEXT_OPERATORS = ['equals', 'contains', 'regex'] as const;
export type TextOperator = (typeof TEXT_OPERATORS)[number];
export type ValueOperator = TextOperator | 'present' | 'absent';
export type PathMode = 'any' | TextOperator | 'prefix';
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
  status: number;
  responseHeaders: HeaderRow[];
  responseBody: string;
}

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
  const pathMode = path ? (Object.keys(path)[0] as PathMode) : 'any';
  return {
    name: rule.name ?? '',
    enabled: rule.enabled ?? true,
    priority: rule.priority ?? RULE_DEFAULT_PRIORITY,
    methods: [...(match.method ?? [])],
    pathMode,
    path: path ? Object.values(path)[0] : '',
    query: conditionRows(match.query),
    headers: conditionRows(match.headers),
    body: (match.body ?? []).map(bodyRow),
    status: rule.response?.status ?? RULE_DEFAULT_STATUS,
    responseHeaders: Object.entries(rule.response?.headers ?? {}).map(([name, value]) => ({
      name,
      value,
    })),
    responseBody: rule.response?.body ?? '',
  };
}

/**
 * Regra com os valores do formulário por cima de `base`: o que a tela não edita (`id`,
 * `scenario`, `template`, `delay`...) segue como veio. O match sai no formato normalizado do
 * servidor, com as seções vazias em vez de ausentes.
 */
export function fromFormValue(form: RuleFormValue, base: Rule): Rule {
  return {
    ...base,
    name: form.name,
    enabled: form.enabled,
    priority: Number(form.priority),
    match: {
      ...base.match,
      method: [...form.methods],
      path: form.pathMode === 'any' ? null : ({ [form.pathMode]: form.path } as PathMatcher),
      query: conditionMap(form.query),
      headers: conditionMap(form.headers),
      body: form.body.map(bodyMatcher),
    },
    response: {
      ...base.response,
      status: Number(form.status),
      headers: Object.fromEntries(form.responseHeaders.map((row) => [row.name, row.value])),
      body: form.responseBody,
    },
  };
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

type SingleField = 'name' | 'priority' | 'methods' | 'path' | 'status' | 'responseBody';
type RowList = 'query' | 'headers' | 'body' | 'responseHeaders';
type RowField = 'name' | 'value' | 'path' | 'equals';

/** Campo do formulário onde um erro do servidor aparece. */
export type FieldRef = { field: SingleField } | { list: RowList; index: number; field: RowField };

const SINGLE_FIELDS: Record<string, SingleField> = {
  name: 'name',
  priority: 'priority',
  'match.method': 'methods',
  'match.path': 'path',
  'response.status': 'status',
  'response.body': 'responseBody',
};

/**
 * Campo do formulário para a chave de um erro 422, já sem o índice da regra na lista
 * (`match.path.regex`, `match.headers.X-Signature.present`, `match.body.1.jsonPath.path`).
 * `null` quando o erro não tem campo no formulário (ex.: `response.template`).
 */
export function locateError(key: string, form: RuleFormValue): FieldRef | null {
  const single = Object.entries(SINGLE_FIELDS).find(
    ([prefix]) => key === prefix || key.startsWith(`${prefix}.`),
  );
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
    return { errors: [`Invalid JSON: ${(error as Error).message}`] };
  }
  if (!isObject(value)) {
    return { errors: ['The rule must be a JSON object.'] };
  }
  const errors = [
    ...ruleFieldErrors(value),
    ...matchErrors(value['match']),
    ...responseErrors(value['response']),
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
