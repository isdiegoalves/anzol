import { BodyMatcher, Rule } from './rule';

/**
 * Chave de uma condição da regra, no formato do 422 do `PUT /rules` sem o índice da lista e de
 * `near_miss.conditions` (B1): `match.method`, `match.path`, `match.query.<nome>`,
 * `match.headers.<nome como na regra>`, `match.body.<i>`, `match.signature`, `match.schema`,
 * `match.decryption`,
 * `scenario`, `active_from`, `active_until` e `chance`.
 */
export type ConditionKey = string;

/** As chaves de cada frase de `failed`; `inferred` quando saíram da frase, não do servidor. */
export interface FailedConditions {
  keys: (ConditionKey | null)[];
  inferred: boolean;
}

/**
 * A condição de cada frase de `failed`. Usa `conditions` do servidor quando vem alinhada com
 * `failed`; mensagem gravada antes do campo (`null`) ou servidor anterior a ele (ausente) cai no
 * prefixo da frase, lido contra a regra de hoje (a da época pode ter mudado). Frase que não se
 * reconhece fica `null`.
 */
export function failedConditions(
  failed: readonly string[],
  conditions: readonly string[] | null | undefined,
  rule: Rule | undefined,
): FailedConditions {
  if (conditions && conditions.length === failed.length) {
    return { keys: [...conditions], inferred: false };
  }
  return { keys: failed.map((phrase) => conditionOfPhrase(phrase, rule)), inferred: true };
}

/**
 * A condição que produziu a frase, pelo prefixo que o servidor escreve (`RuleMatching.kt`):
 * `method:`, `path:`, `query <nome>:`, `header <nome em minúsculas>:`, `body:`, `body <JSONPath>:`,
 * `signature:`, `schema:`, `decryption:`, `scenario <nome>:`, `chance ` e `window: opens`/`window: closed`.
 * Cabeçalho e corpo são achados na regra: o nome do cabeçalho sem caixa, o JSONPath pelo caminho
 * e as demais condições de corpo pelo tipo e pelo valor citado na frase.
 */
export function conditionOfPhrase(phrase: string, rule: Rule | undefined): ConditionKey | null {
  for (const [prefix, key] of SINGLE_PREFIXES) {
    if (phrase.startsWith(prefix)) {
      return key;
    }
  }
  if (/^scenario .*: expected state /.test(phrase)) {
    return 'scenario';
  }
  if (phrase.startsWith('body: ')) {
    return bodyByKind(phrase, rule);
  }
  if (phrase.startsWith('body ')) {
    return bodyByJsonPath(phrase, rule);
  }
  const field = /^(query|header) (.+?): (?:absent|present|expected )/.exec(phrase);
  if (field) {
    return field[1] === 'query'
      ? `match.query.${field[2]}`
      : `match.headers.${headerName(field[2], rule)}`;
  }
  return null;
}

const SINGLE_PREFIXES: readonly [string, ConditionKey][] = [
  ['method: ', 'match.method'],
  ['path: ', 'match.path'],
  ['signature: ', 'match.signature'],
  ['schema: ', 'match.schema'],
  ['decryption: ', 'match.decryption'],
  ['chance ', 'chance'],
  ['window: opens at ', 'active_from'],
  ['window: closed at ', 'active_until'],
];

/** A frase traz o cabeçalho em minúsculas; a chave, o nome como a regra o escreve. */
function headerName(lowercase: string, rule: Rule | undefined): string {
  const names = Object.keys(rule?.match?.headers ?? {});
  return names.find((name) => name.toLowerCase() === lowercase) ?? lowercase;
}

function bodyIndex(rule: Rule | undefined, test: (matcher: BodyMatcher) => boolean): number {
  return (rule?.match?.body ?? []).findIndex(test);
}

function bodyKey(index: number): ConditionKey {
  return index < 0 ? 'match.body' : `match.body.${index}`;
}

/** `body $.status: …`: o JSONPath de mesmo caminho (o caminho pode ter espaço e dois-pontos). */
function bodyByJsonPath(phrase: string, rule: Rule | undefined): ConditionKey {
  return bodyKey(
    bodyIndex(rule, (m) => 'jsonPath' in m && phrase.startsWith(`body ${m.jsonPath.path}: `)),
  );
}

/**
 * `body: …` sem caminho: `equals`, `contains`, `regex` e `equalToJson` escrevem frases
 * diferentes; o valor citado (JSON do texto) separa duas condições do mesmo tipo.
 */
function bodyByKind(phrase: string, rule: Rule | undefined): ConditionKey {
  const rest = phrase.slice('body: '.length);
  const text = (value: string) => JSON.stringify(value);
  if (rest === 'body is not JSON' || rest === 'not equal to the expected JSON') {
    return bodyKey(bodyIndex(rule, (m) => 'equalToJson' in m));
  }
  if (rest.startsWith('expected to contain ')) {
    return bodyKey(
      bodyIndex(rule, (m) => 'contains' in m && rest === `expected to contain ${text(m.contains)}`),
    );
  }
  if (rest.startsWith('expected to match ')) {
    return bodyKey(
      bodyIndex(rule, (m) => 'regex' in m && rest === `expected to match ${text(m.regex)}`),
    );
  }
  return bodyKey(
    bodyIndex(rule, (m) => 'equals' in m && rest.startsWith(`expected ${text(m.equals)}, got `)),
  );
}

/** Quantas vezes cada condição falhou, e se alguma chave saiu da frase (mensagem antiga). */
export interface ConditionTally {
  counts: ReadonlyMap<ConditionKey, number>;
  inferred: boolean;
}

/** Soma, por condição, as falhas de várias mensagens (uma vez por mensagem). */
export function tallyConditions(
  misses: readonly { failed: readonly string[]; conditions?: readonly string[] | null }[],
  rule: Rule | undefined,
): ConditionTally {
  const counts = new Map<ConditionKey, number>();
  let inferred = false;
  for (const miss of misses) {
    const result = failedConditions(miss.failed, miss.conditions, rule);
    inferred ||= result.inferred;
    for (const key of new Set(result.keys)) {
      if (key) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return { counts, inferred };
}
