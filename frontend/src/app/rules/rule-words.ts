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
  return buildWords(rule);
}

/** Um pedaço da regra em palavras: texto corrido, destaque (método, status) ou código (caminho). */
export interface WordSegment {
  kind: 'text' | 'strong' | 'code';
  text: string;
}

/** Marcas em volta dos valores destacados; não aparecem em texto de regra nem de tradução. */
const STRONG = '\uE000';
const CODE = '\uE001';
let marking = false;
const strong = (text: string) => (marking ? `${STRONG}${text}${STRONG}` : text);
const code = (text: string) => (marking ? `${CODE}${text}${CODE}` : text);

/**
 * A regra em palavras em pedaços (C, RULES-15): o método e o status em destaque e o caminho como
 * código. As marcas passam pelos placeholders da tradução, então valem em qualquer idioma; o texto
 * junto é o de `ruleInWords`.
 */
export function ruleWordSegments(rule: Rule): WordSegment[] {
  marking = true;
  let text: string;
  try {
    text = buildWords(rule);
  } finally {
    marking = false;
  }
  return text
    .split(/(\uE000[^\uE000]*\uE000|\uE001[^\uE001]*\uE001)/)
    .filter((part) => part !== '')
    .map((part) =>
      part.startsWith(STRONG)
        ? { kind: 'strong', text: part.slice(1, -1) }
        : part.startsWith(CODE)
          ? { kind: 'code', text: part.slice(1, -1) }
          : { kind: 'text', text: part },
    );
}

function buildWords(rule: Rule): string {
  const match = rule.match ?? {};
  const methods = match.method ?? [];
  const who =
    methods.length === 0
      ? $localize`When any request`
      : $localize`When a ${orList(methods.map(strong))}:methods:`;
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
    return $localize` to ${code(path.equals)}:path:`;
  }
  if ('prefix' in path) {
    return $localize` to a path starting with ${code(path.prefix)}:prefix:`;
  }
  return $localize` to a path matching ${code(path.regex)}:regex:`;
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
  const status = strong(String(response.status ?? RULE_DEFAULT_STATUS));
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

/**
 * Linha 2 da regra na lista (C, RULES-02): todas as condições, curtas e separadas por " · ", e o
 * que muda a resposta no tempo (atraso ou falha): `POST /pagamentos · $.status = "pago" ·
 * signature valid · delay 300 ms`. Sem condição, "any request".
 */
export function matchLine(rule: Rule): string {
  const match = rule.match ?? {};
  const methods = match.method ?? [];
  const path = match.path;
  const parts: string[] = [];
  if (path && 'equals' in path) {
    parts.push(methods.length ? `${methods.join(', ')} ${path.equals}` : path.equals);
  } else {
    if (methods.length) {
      parts.push(methods.join(', '));
    }
    if (path && 'prefix' in path) {
      parts.push($localize`path starts with ${path.prefix}:prefix:`);
    } else if (path) {
      parts.push($localize`path matches ${path.regex}:regex:`);
    }
  }
  parts.push(
    ...Object.entries(match.query ?? {}).map(([name, m]) =>
      shortValue($localize`query ${name}:name:`, m),
    ),
    ...Object.entries(match.headers ?? {}).map(([name, m]) =>
      shortValue($localize`header ${name}:name:`, m),
    ),
    ...(match.body ?? []).map(shortBody),
  );
  if (match.signature) {
    parts.push($localize`signature ${match.signature}:state:`);
  }
  if (match.schema) {
    parts.push($localize`schema ${match.schema}:state:`);
  }
  if (parts.length === 0) {
    parts.push($localize`any request`);
  }
  const timing = responseTiming(rule);
  return [...parts, ...(timing ? [timing] : [])].join(' · ');
}

/**
 * A transição de uma regra de cenário (linha 3 da lista, RULES-07): `Started → falhou 1`; sem
 * estado novo, só o estado em que ela responde. `null` fora de cenário.
 */
export function scenarioTransition(rule: Rule): string | null {
  const scenario = rule.scenario;
  if (!scenario?.name) {
    return null;
  }
  const from = scenario.requiredState || $localize`any state`;
  return scenario.newState ? `${from} → ${scenario.newState}` : from;
}

function shortValue(target: string, matcher: ValueMatcher): string {
  if ('present' in matcher) {
    return matcher.present ? $localize`${target}:target: present` : $localize`no ${target}:target:`;
  }
  if ('equals' in matcher) {
    return `${target} = ${quoted(matcher.equals)}`;
  }
  if ('contains' in matcher) {
    return $localize`${target}:target: contains ${quoted(matcher.contains)}:value:`;
  }
  return `${target} ~ ${matcher.regex}`;
}

function shortBody(matcher: BodyMatcher): string {
  if ('jsonPath' in matcher) {
    const { path, equals } = matcher.jsonPath;
    return equals === undefined
      ? $localize`${path}:path: present`
      : `${path} = ${cut(JSON.stringify(equals))}`;
  }
  if ('equalToJson' in matcher) {
    return $localize`body = JSON`;
  }
  if ('equals' in matcher) {
    return $localize`body = ${quoted(matcher.equals)}:value:`;
  }
  if ('contains' in matcher) {
    return $localize`body contains ${quoted(matcher.contains)}:value:`;
  }
  return $localize`body ~ ${matcher.regex}:regex:`;
}

/** Falha de rede (que manda sobre o resto) ou atraso da resposta; `null` sem nenhum dos dois. */
function responseTiming(rule: Rule): string | null {
  const response = rule.response ?? {};
  if (response.fault) {
    const label = FAULT_LABELS[response.fault] ?? response.fault;
    const fault = `${label[0].toLowerCase()}${label.slice(1)}`;
    return $localize`fault: ${fault}:fault:`;
  }
  const delay = response.delay;
  if (!delay) {
    return null;
  }
  return 'lognormal' in delay
    ? $localize`lognormal delay, median ${delay.lognormal.median}:median: ms`
    : $localize`delay ${delayWords(delay)}:delay:`;
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
