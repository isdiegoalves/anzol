import {
  BodyMatcher,
  FAULT_LABELS,
  RULE_DEFAULT_STATUS,
  Rule,
  RuleDelay,
  ValueMatcher,
} from './rule';

/** Acima disto, o texto citado na frase é cortado. */
const QUOTE_MAX = 40;

/**
 * A regra "em palavras" (C §2.4; B "In plain words"): "When a POST to /payments has header
 * X-Signature present and a valid signature, answer 201." Só descreve; o que vale é
 * o JSON salvo.
 */
export function ruleInWords(rule: Rule): string {
  const match = rule.match ?? {};
  const methods = match.method ?? [];
  const who = methods.length === 0 ? 'When any request' : `When a ${orList(methods)}`;
  const conditions = [
    ...Object.entries(match.query ?? {}).map(([name, m]) => valueWords(`query ${name}`, m)),
    ...Object.entries(match.headers ?? {}).map(([name, m]) => valueWords(`header ${name}`, m)),
    ...(match.body ?? []).map(bodyWords),
    ...(match.signature ? [SIGNATURE_WORDS[match.signature]] : []),
    ...(match.schema ? [SCHEMA_WORDS[match.schema]] : []),
  ];
  const scenario = rule.scenario?.name ? rule.scenario : null;
  return [
    who,
    pathWords(match.path),
    conditions.length ? ` has ${andList(conditions)}` : '',
    scenario?.requiredState
      ? `, while scenario ${scenario.name} is in ${quoted(scenario.requiredState)}`
      : '',
    `, ${responseWords(rule)}`,
    scenario?.newState
      ? ` and moves scenario ${scenario.name} to ${quoted(scenario.newState)}`
      : '',
    '.',
  ].join('');
}

const SIGNATURE_WORDS = {
  valid: 'a valid signature',
  invalid: 'an invalid signature',
  absent: 'no signature header',
} as const;

const SCHEMA_WORDS = {
  valid: 'a body valid against the schema',
  invalid: 'a body invalid against the schema',
} as const;

function pathWords(path: NonNullable<Rule['match']>['path']): string {
  if (!path) {
    return '';
  }
  if ('equals' in path) {
    return ` to ${path.equals}`;
  }
  if ('prefix' in path) {
    return ` to a path starting with ${path.prefix}`;
  }
  return ` to a path matching ${path.regex}`;
}

function valueWords(target: string, matcher: ValueMatcher): string {
  if ('present' in matcher) {
    return matcher.present ? `${target} present` : `no ${target}`;
  }
  if ('equals' in matcher) {
    return `${target} equal to ${quoted(matcher.equals)}`;
  }
  if ('contains' in matcher) {
    return `${target} containing ${quoted(matcher.contains)}`;
  }
  return `${target} matching ${matcher.regex}`;
}

function bodyWords(matcher: BodyMatcher): string {
  if ('jsonPath' in matcher) {
    const { path, equals } = matcher.jsonPath;
    return equals === undefined
      ? `${path} present`
      : `${path} equal to ${cut(JSON.stringify(equals))}`;
  }
  if ('equalToJson' in matcher) {
    return 'a body equal to the given JSON';
  }
  if ('equals' in matcher) {
    return `a body equal to ${quoted(matcher.equals)}`;
  }
  if ('contains' in matcher) {
    return `a body containing ${quoted(matcher.contains)}`;
  }
  return `a body matching ${matcher.regex}`;
}

function responseWords(rule: Rule): string {
  const response = rule.response ?? {};
  if (response.fault) {
    const label = FAULT_LABELS[response.fault] ?? response.fault;
    return `fail with ${label[0].toLowerCase()}${label.slice(1)}`;
  }
  const status = response.status ?? RULE_DEFAULT_STATUS;
  // O corpo fixo é detalhe; o template muda o que a resposta diz, então entra na frase.
  const body = response.body && response.template ? ' with a templated body' : '';
  const delay = response.delay ? ` after ${delayWords(response.delay)}` : '';
  return `answer ${status}${body}${delay}`;
}

function delayWords(delay: RuleDelay): string {
  if ('fixed' in delay) {
    return `${delay.fixed} ms`;
  }
  if ('uniform' in delay) {
    return `${delay.uniform.min}–${delay.uniform.max} ms`;
  }
  return `about ${delay.lognormal.median} ms`;
}

function quoted(text: string): string {
  return cut(`"${text}"`);
}

function cut(text: string): string {
  return text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text;
}

function orList(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

function andList(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
