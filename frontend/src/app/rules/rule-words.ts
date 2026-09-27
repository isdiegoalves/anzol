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
 * o JSON salvo. Cada pedaço é uma mensagem com placeholders, para a tradução poder reordenar.
 */
export function ruleInWords(rule: Rule): string {
  const match = rule.match ?? {};
  const methods = match.method ?? [];
  const who =
    methods.length === 0
      ? $localize`When any request`
      : $localize`When a ${orList(methods)}:methods:`;
  const conditions = [
    ...Object.entries(match.query ?? {}).map(([name, m]) =>
      valueWords($localize`query ${name}:name:`, m),
    ),
    ...Object.entries(match.headers ?? {}).map(([name, m]) =>
      valueWords($localize`header ${name}:name:`, m),
    ),
    ...(match.body ?? []).map(bodyWords),
    ...(match.signature ? [signatureWords(match.signature)] : []),
    ...(match.schema ? [schemaWords(match.schema)] : []),
  ];
  const scenario = rule.scenario?.name ? rule.scenario : null;
  return [
    who,
    pathWords(match.path),
    conditions.length ? $localize` has ${andList(conditions)}:conditions:` : '',
    scenario?.requiredState
      ? $localize`, while scenario ${scenario.name}:scenario: is in ${quoted(scenario.requiredState)}:state:`
      : '',
    $localize`, ${responseWords(rule)}:response:`,
    scenario?.newState
      ? $localize` and moves scenario ${scenario.name}:scenario: to ${quoted(scenario.newState)}:state:`
      : '',
    '.',
  ].join('');
}

function signatureWords(signature: 'valid' | 'invalid' | 'absent'): string {
  switch (signature) {
    case 'valid':
      return $localize`a valid signature`;
    case 'invalid':
      return $localize`an invalid signature`;
    case 'absent':
      return $localize`no signature header`;
  }
}

function schemaWords(schema: 'valid' | 'invalid'): string {
  return schema === 'valid'
    ? $localize`a body valid against the schema`
    : $localize`a body invalid against the schema`;
}

function pathWords(path: NonNullable<Rule['match']>['path']): string {
  if (!path) {
    return '';
  }
  if ('equals' in path) {
    return $localize` to ${path.equals}:path:`;
  }
  if ('prefix' in path) {
    return $localize` to a path starting with ${path.prefix}:prefix:`;
  }
  return $localize` to a path matching ${path.regex}:regex:`;
}

function valueWords(target: string, matcher: ValueMatcher): string {
  if ('present' in matcher) {
    return matcher.present ? $localize`${target}:target: present` : $localize`no ${target}:target:`;
  }
  if ('equals' in matcher) {
    return $localize`${target}:target: equal to ${quoted(matcher.equals)}:value:`;
  }
  if ('contains' in matcher) {
    return $localize`${target}:target: containing ${quoted(matcher.contains)}:value:`;
  }
  return $localize`${target}:target: matching ${matcher.regex}:regex:`;
}

function bodyWords(matcher: BodyMatcher): string {
  if ('jsonPath' in matcher) {
    const { path, equals } = matcher.jsonPath;
    return equals === undefined
      ? $localize`${path}:path: present`
      : $localize`${path}:path: equal to ${cut(JSON.stringify(equals))}:value:`;
  }
  if ('equalToJson' in matcher) {
    return $localize`a body equal to the given JSON`;
  }
  if ('equals' in matcher) {
    return $localize`a body equal to ${quoted(matcher.equals)}:value:`;
  }
  if ('contains' in matcher) {
    return $localize`a body containing ${quoted(matcher.contains)}:value:`;
  }
  return $localize`a body matching ${matcher.regex}:regex:`;
}

function responseWords(rule: Rule): string {
  const response = rule.response ?? {};
  if (response.fault) {
    const label = FAULT_LABELS[response.fault] ?? response.fault;
    const fault = `${label[0].toLowerCase()}${label.slice(1)}`;
    return $localize`fail with ${fault}:fault:`;
  }
  const status = response.status ?? RULE_DEFAULT_STATUS;
  // O corpo fixo é detalhe; o template muda o que a resposta diz, então entra na frase.
  const body = response.body && response.template ? $localize` with a templated body` : '';
  const delay = response.delay ? $localize` after ${delayWords(response.delay)}:delay:` : '';
  return $localize`answer ${status}:status:${body}:body:${delay}:delay:`;
}

function delayWords(delay: RuleDelay): string {
  if ('fixed' in delay) {
    return `${delay.fixed} ms`;
  }
  if ('uniform' in delay) {
    return `${delay.uniform.min}–${delay.uniform.max} ms`;
  }
  return $localize`about ${delay.lognormal.median}:median: ms`;
}

function quoted(text: string): string {
  return cut(`"${text}"`);
}

function cut(text: string): string {
  return text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text;
}

function orList(items: readonly string[]): string {
  return items.length < 2
    ? items.join('')
    : $localize`${items.slice(0, -1).join(', ')}:first: or ${items.at(-1)}:last:`;
}

function andList(items: readonly string[]): string {
  return items.length < 2
    ? items.join('')
    : $localize`${items.slice(0, -1).join(', ')}:first: and ${items.at(-1)}:last:`;
}
