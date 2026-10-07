import type { Token } from '../token/token';
import {
  BodyMatcher,
  PathMatcher,
  RULE_DEFAULT_PRIORITY,
  Rule,
  RuleMatch,
  SCENARIO_STARTED,
  ValueMatcher,
  evaluationOrder,
} from './rule';
import type { Scenario } from './scenario-store';

/**
 * Diagnóstico da lista de regras no navegador (E-01, E-11, WM-30), só com prova: nenhuma regex é
 * avaliada aqui (regex só implica regex de texto idêntico) e condição que a tela não conhece não
 * prova nada. As regras de casamento espelham `RuleMatching.kt`: caminho, query e valores com
 * caixa; cabeçalho pelo nome em minúsculas com `_` → `-`; método sem caixa.
 */

/** Campos de `match` que a tela sabe comparar; qualquer outro com valor impede a prova. */
const KNOWN_MATCH = new Set([
  'method',
  'path',
  'query',
  'headers',
  'body',
  'signature',
  'schema',
  'decryption',
]);

/** Regra sem nenhuma condição e sem estado exigido: responde tudo o que chegar a ela (WM-30). */
export function isCatchAll(rule: Rule): boolean {
  const match = rule.match ?? {};
  return (
    !letsSomeThrough(rule) &&
    !rule.scenario?.requiredState &&
    !match.method?.length &&
    !match.path &&
    isEmpty(match.query) &&
    isEmpty(match.headers) &&
    !match.body?.length &&
    !match.signature &&
    !match.schema &&
    !match.decryption &&
    unknownConditions(match).length === 0
  );
}

/**
 * A (ligada) casa tudo o que B casa: cada condição de A é implicada por uma de B. A ordem entre as
 * duas fica com quem chama (`shadowedBy`).
 */
export function shadows(a: Rule, b: Rule): boolean {
  if (a.enabled === false || letsSomeThrough(a)) {
    return false;
  }
  const ma = a.match ?? {};
  const mb = b.match ?? {};
  return (
    unknownConditions(ma).length === 0 &&
    methodImplied(ma.method, mb.method) &&
    pathImplied(ma.path, mb.path) &&
    fieldsImplied(ma.query, mb.query, (name) => name) &&
    fieldsImplied(ma.headers, mb.headers, headerName) &&
    (ma.body ?? []).every((item) => (mb.body ?? []).some((other) => sameBody(item, other))) &&
    (!ma.signature || ma.signature === mb.signature) &&
    (!ma.schema || ma.schema === mb.schema) &&
    (!ma.decryption || ma.decryption === mb.decryption) &&
    scenarioImplied(a.scenario, b.scenario)
  );
}

/** Com chance ou janela, parte do que a regra casa segue para as regras seguintes. */
function letsSomeThrough(rule: Rule): boolean {
  return (rule.chance ?? 100) < 100 || !!rule.active_from || !!rule.active_until;
}

/**
 * Para cada índice da lista salva, a primeira regra ligada antes dela na ordem de avaliação que a
 * sombreia. A desligada também entra, pela posição que teria se ligada (o tooltip "if turned on").
 */
export function shadowedBy(rules: readonly Rule[]): Map<number, Rule> {
  const order = evaluationOrder(rules);
  const result = new Map<number, Rule>();
  order.forEach((index, position) => {
    const by = order
      .slice(0, position)
      .map((earlier) => rules[earlier])
      .find((earlier) => shadows(earlier, rules[index]));
    if (by) {
      result.set(index, by);
    }
  });
  return result;
}

/** Onde a regra nova entra para poder responder (E-01): antes da primeira pega-tudo ligada. */
export interface Placement {
  /** Índice na lista salva (a regra nova entra nele, empurrando a pega-tudo). */
  index: number;
  /** A prioridade da pega-tudo: empate, vale a ordem da lista. */
  priority: number;
  /** O nome da pega-tudo, para o aviso do editor. */
  before: string;
}

export function catchAllPlacement(rules: readonly Rule[]): Placement | null {
  const index = evaluationOrder(rules).find(
    (i) => rules[i].enabled !== false && isCatchAll(rules[i]),
  );
  if (index === undefined) {
    return null;
  }
  const catchAll = rules[index];
  return {
    index,
    priority: catchAll.priority ?? RULE_DEFAULT_PRIORITY,
    before: catchAll.name,
  };
}

export type NeverMatch =
  { cause: 'signature' | 'schema' | 'decryption' } | { cause: 'state'; state: string };

/**
 * A regra não pode casar (E-11): exige assinatura, schema ou decifra e a URL não verifica (`null`; ausente é
 * configuração ainda desconhecida e não acusa nada); ou exige um estado que nenhuma outra regra
 * ligada do cenário produz, que não é Started nem o estado de agora (provável erro de digitação).
 */
export function neverMatches(
  rule: Rule,
  rules: readonly Rule[],
  token: Pick<Token, 'signature' | 'schema' | 'e2ee'>,
  scenarios: readonly Scenario[],
): NeverMatch | null {
  if (rule.match?.signature && token.signature === null) {
    return { cause: 'signature' };
  }
  if (rule.match?.schema && token.schema === null) {
    return { cause: 'schema' };
  }
  if (rule.match?.decryption && token.e2ee === null) {
    return { cause: 'decryption' };
  }
  const name = rule.scenario?.name;
  const state = rule.scenario?.requiredState;
  if (!name || !state || state === SCENARIO_STARTED) {
    return null;
  }
  const reachable =
    scenarios.some((scenario) => scenario.name === name && scenario.state === state) ||
    rules.some(
      (other) =>
        other !== rule &&
        other.enabled !== false &&
        other.scenario?.name === name &&
        other.scenario.newState === state,
    );
  return reachable ? null : { cause: 'state', state };
}

export type Diagnosis =
  | { kind: 'never'; cause: 'signature' | 'schema' | 'decryption' }
  | { kind: 'never'; cause: 'state'; state: string }
  | { kind: 'shadowed'; by: Rule }
  | { kind: 'likely'; by: Rule };

/** A evidência do "Test against history": as mensagens que B casaria e quem respondeu cada uma. */
export interface ShadowEvidence {
  /** Por `id` da regra salva, as mensagens que o teste dela (como está salva) casou. */
  tested: ReadonlyMap<string, readonly string[]>;
  /** Por mensagem, o `id` da regra que respondeu (`null`: a resposta padrão). */
  answered: ReadonlyMap<string, string | null>;
}

/**
 * O diagnóstico de cada regra ligada, pelo índice na lista salva: "nunca casa", depois a sombra
 * provada e, só com o teste rodado, a provável (todas as que B casaria já respondidas por uma regra
 * ligada antes dela).
 */
export function diagnose(
  rules: readonly Rule[],
  token: Pick<Token, 'signature' | 'schema' | 'e2ee'>,
  scenarios: readonly Scenario[],
  evidence?: ShadowEvidence,
): Map<number, Diagnosis> {
  const shadowed = shadowedBy(rules);
  const order = evaluationOrder(rules);
  const result = new Map<number, Diagnosis>();
  rules.forEach((rule, index) => {
    if (rule.enabled === false) {
      return;
    }
    const never = neverMatches(rule, rules, token, scenarios);
    const by = shadowed.get(index);
    const likely = evidence && likelyShadow(rules, order, index, evidence);
    const diagnosis: Diagnosis | undefined = never
      ? { kind: 'never', ...never }
      : by
        ? { kind: 'shadowed', by }
        : likely
          ? { kind: 'likely', by: likely }
          : undefined;
    if (diagnosis) {
      result.set(index, diagnosis);
    }
  });
  return result;
}

function likelyShadow(
  rules: readonly Rule[],
  order: readonly number[],
  index: number,
  { tested, answered }: ShadowEvidence,
): Rule | null {
  const matches = rules[index].id ? tested.get(rules[index].id) : undefined;
  if (!matches?.length) {
    return null;
  }
  const ids = new Set(matches.map((uuid) => answered.get(uuid)));
  const [id] = ids;
  if (ids.size !== 1 || !id || id === rules[index].id) {
    return null;
  }
  const earlier = order.slice(0, order.indexOf(index)).map((i) => rules[i]);
  return earlier.find((rule) => rule.id === id && rule.enabled !== false) ?? null;
}

/**
 * Os dois `match` pedem o mesmo: iguais depois de tirar o que vale "qualquer" (ausente, `null`,
 * lista ou mapa vazio), sem ordem de chaves. O editor e o servidor escrevem a mesma regra com
 * campos em ordens e formas diferentes.
 */
export function sameMatch(a: RuleMatch | undefined, b: RuleMatch | undefined): boolean {
  const meaningful = (match: RuleMatch | undefined) =>
    Object.fromEntries(
      Object.entries(match ?? {}).filter(
        ([, value]) =>
          value !== null &&
          value !== undefined &&
          !(Array.isArray(value) && value.length === 0) &&
          !(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0),
      ),
    );
  return sameJson(meaningful(a), meaningful(b));
}

function unknownConditions(match: RuleMatch): string[] {
  return Object.entries(match)
    .filter(([key, value]) => !KNOWN_MATCH.has(key) && value !== null && value !== undefined)
    .map(([key]) => key);
}

function isEmpty(record: Record<string, unknown> | undefined): boolean {
  return !record || Object.keys(record).length === 0;
}

function methodImplied(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a?.length) {
    return true;
  }
  const allowed = new Set(a.map((method) => method.toUpperCase()));
  return !!b?.length && b.every((method) => allowed.has(method.toUpperCase()));
}

function pathImplied(
  a: PathMatcher | null | undefined,
  b: PathMatcher | null | undefined,
): boolean {
  if (!a) {
    return true;
  }
  if (!b) {
    return false;
  }
  if ('equals' in a) {
    return 'equals' in b && b.equals === a.equals;
  }
  if ('prefix' in a) {
    const text = 'equals' in b ? b.equals : 'prefix' in b ? b.prefix : null;
    return text !== null && text.startsWith(a.prefix);
  }
  return 'regex' in b && b.regex === a.regex;
}

function headerName(name: string): string {
  return name.toLowerCase().replaceAll('_', '-');
}

function fieldsImplied(
  a: Record<string, ValueMatcher> | undefined,
  b: Record<string, ValueMatcher> | undefined,
  normalize: (name: string) => string,
): boolean {
  const others = Object.entries(b ?? {}).map(([name, matcher]) => ({
    name: normalize(name),
    matcher,
  }));
  return Object.entries(a ?? {}).every(([name, matcher]) =>
    others.some((other) => other.name === normalize(name) && valueImplied(matcher, other.matcher)),
  );
}

/** A condição de A vale em toda requisição em que a de B vale. */
function valueImplied(a: ValueMatcher, b: ValueMatcher): boolean {
  if ('present' in a) {
    return a.present ? !('present' in b) || b.present : 'present' in b && !b.present;
  }
  if ('equals' in a) {
    return 'equals' in b && b.equals === a.equals;
  }
  if ('contains' in a) {
    const text = 'equals' in b ? b.equals : 'contains' in b ? b.contains : null;
    return text !== null && text.includes(a.contains);
  }
  return 'regex' in b && b.regex === a.regex;
}

function scenarioImplied(a: Rule['scenario'], b: Rule['scenario']): boolean {
  if (!a?.requiredState) {
    return true;
  }
  return b?.name === a.name && b.requiredState === a.requiredState;
}

/** Condição do corpo idêntica; o `equalToJson` pela árvore (texto JSON lido), sem ordem de chaves. */
function sameBody(a: BodyMatcher, b: BodyMatcher): boolean {
  if ('equalToJson' in a && 'equalToJson' in b) {
    return sameJson(jsonTree(a.equalToJson), jsonTree(b.equalToJson));
  }
  return sameJson(a, b);
}

function jsonTree(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    );
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every(
        (key) =>
          Object.hasOwn(b, key) &&
          sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
      )
    );
  }
  return a === b;
}
