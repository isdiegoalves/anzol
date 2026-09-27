// Frases do servidor na língua da tela (WM-05): as do "por que não casou" (near miss, teste contra
// o histórico, trace) e as mensagens do 422 das regras. O servidor responde sempre em inglês; a
// tabela reconhece as famílias de frase (RuleMatching.kt, BodyMatching.kt, RuleFailures.kt,
// RuleReader.kt, RuleParser.kt) e remonta cada uma com `$localize`, cujo texto-fonte é a própria
// frase do servidor: em inglês nada muda. Frase desconhecida fica como veio. Funções, e não
// constantes de módulo: a tradução carrega antes de elas rodarem.

/** Uma frase do servidor, traduzida quando a tabela a conhece. */
export interface ServerPhrase {
  /** O que a tela mostra. */
  text: string;
  /** A frase como o servidor a mandou (no `title` e no "Show original"). */
  original: string;
  /** A tela mostra outra coisa que o original (o idioma não é o inglês e a frase é conhecida). */
  translated: boolean;
}

type Family = [RegExp, (...parts: string[]) => string];

/** `query env` → "query env"; `header x` → "cabeçalho x"; `body $.a` → "corpo $.a". */
function target(kind: string, name: string): string {
  if (kind === 'header') {
    return $localize`:server phrase|Target of a failed condition:header ${name}:name:`;
  }
  if (kind === 'body') {
    return $localize`:server phrase|Target of a failed condition:body ${name}:path:`;
  }
  return $localize`:server phrase|Target of a failed condition:query ${name}:name:`;
}

/** As famílias do near miss, na ordem: a primeira que casa vale. */
function conditionFamilies(): Family[] {
  return [
    [
      /^method: expected one of (.+), got (.+)$/,
      (list, got) => $localize`method: expected one of ${list}:list:, got ${got}:got:`,
    ],
    [
      /^method: expected (.+), got (.+)$/,
      (expected, got) => $localize`method: expected ${expected}:expected:, got ${got}:got:`,
    ],
    [
      /^path: expected prefix (".*"), got (".*")$/s,
      (prefix, got) => $localize`path: expected prefix ${prefix}:expected:, got ${got}:got:`,
    ],
    [
      /^path: expected to match (".*"), got (".*")$/s,
      (regex, got) => $localize`path: expected to match ${regex}:expected:, got ${got}:got:`,
    ],
    [
      /^path: expected (".*"), got (".*")$/s,
      (expected, got) => $localize`path: expected ${expected}:expected:, got ${got}:got:`,
    ],
    [
      /^(query|header) (.+?): absent$/,
      (kind, name) => $localize`${target(kind, name)}:target:: absent`,
    ],
    [
      /^(query|header) (.+?): present$/,
      (kind, name) => $localize`${target(kind, name)}:target:: present`,
    ],
    [
      /^(query|header) (.+?): expected to contain (".*"), got (".*")$/s,
      (kind, name, expected, got) =>
        $localize`${target(kind, name)}:target:: expected to contain ${expected}:expected:, got ${got}:got:`,
    ],
    [
      /^(query|header) (.+?): expected to match (".*"), got (".*")$/s,
      (kind, name, expected, got) =>
        $localize`${target(kind, name)}:target:: expected to match ${expected}:expected:, got ${got}:got:`,
    ],
    [
      /^(query|header) (.+?): expected (".*"), got (".*")$/s,
      (kind, name, expected, got) =>
        $localize`${target(kind, name)}:target:: expected ${expected}:expected:, got ${got}:got:`,
    ],
    [
      /^body (\$.*?): body is not JSON$/,
      (path) => $localize`${target('body', path)}:target:: body is not JSON`,
    ],
    [/^body (\$.*?): absent$/, (path) => $localize`${target('body', path)}:target:: absent`],
    [
      /^body (\$.*?): expected (.*), got (.*)$/s,
      (path, expected, got) =>
        $localize`${target('body', path)}:target:: expected ${expected}:expected:, got ${got}:got:`,
    ],
    [/^body: body is not JSON$/, () => $localize`body: body is not JSON`],
    [
      /^body: not equal to the expected JSON$/,
      () => $localize`body: not equal to the expected JSON`,
    ],
    [
      /^body: expected to contain (".*")$/s,
      (expected) => $localize`body: expected to contain ${expected}:expected:`,
    ],
    [
      /^body: expected to match (".*")$/s,
      (expected) => $localize`body: expected to match ${expected}:expected:`,
    ],
    [
      /^body: expected (".*"), got (".*")$/s,
      (expected, got) => $localize`body: expected ${expected}:expected:, got ${got}:got:`,
    ],
    [
      /^signature: expected (\w+), got not configured$/,
      (expected) => $localize`signature: expected ${expected}:expected:, got not configured`,
    ],
    [
      /^signature: expected (\w+), got (.+)$/,
      (expected, got) => $localize`signature: expected ${expected}:expected:, got ${got}:got:`,
    ],
    [
      /^schema: expected (\w+), got not configured$/,
      (expected) => $localize`schema: expected ${expected}:expected:, got not configured`,
    ],
    [
      /^schema: expected (\w+), got (.+)$/,
      (expected, got) => $localize`schema: expected ${expected}:expected:, got ${got}:got:`,
    ],
    [
      /^scenario (.+?): expected state (".*"), got (".*")$/s,
      (name, expected, got) =>
        $localize`scenario ${name}:name:: expected state ${expected}:expected:, got ${got}:got:`,
    ],
  ];
}

/** Mensagens do 422 das regras (lista fechada do RuleReader e do RuleParser). */
function validationFamilies(): Family[] {
  return [
    [/^The regex is invalid\.$/, () => $localize`The regex is invalid.`],
    [
      /^The status must be between (\d+) and (\d+)\.$/,
      (min, max) => $localize`The status must be between ${min}:min: and ${max}:max:.`,
    ],
    [/^The priority must be at least 1\.$/, () => $localize`The priority must be at least 1.`],
    [/^The name field is required\.$/, () => $localize`The name field is required.`],
    [
      /^The name may not be greater than (\d+) characters\.$/,
      (max) => $localize`The name may not be greater than ${max}:max: characters.`,
    ],
    [
      /^The (.+) may not be greater than (\d+) characters\.$/,
      (field, max) =>
        $localize`The ${field}:field: may not be greater than ${max}:max: characters.`,
    ],
    [
      /^The rules may not have more than (\d+) items\.$/,
      (max) => $localize`The rules may not have more than ${max}:max: items.`,
    ],
    [
      /^The schema is invalid: (.*)\.$/s,
      (reason) => $localize`The schema is invalid: ${reason}:reason:.`,
    ],
    [
      /^The (.+) must have exactly one of: (.+)\.$/,
      (subject, list) => $localize`The ${subject}:field: must have exactly one of: ${list}:list:.`,
    ],
    [
      /^The template is invalid: (.*)\.$/s,
      (reason) => $localize`The template is invalid: ${reason}:reason:.`,
    ],
    [
      /^The rendered template is too large\.$/,
      () => $localize`The rendered template is too large.`,
    ],
    [
      /^The template took too long to render\.$/,
      () => $localize`The template took too long to render.`,
    ],
    [/^The header name is invalid\.$/, () => $localize`The header name is invalid.`],
    [/^The header value is invalid\.$/, () => $localize`The header value is invalid.`],
    [/^The path is invalid\.$/, () => $localize`The path is invalid.`],
    [
      /^The id field has a duplicate value\.$/,
      () => $localize`The id field has a duplicate value.`,
    ],
    [/^The id must be a valid UUID\.$/, () => $localize`The id must be a valid UUID.`],
    [
      /^The max must be greater than or equal to the min\.$/,
      () => $localize`The max must be greater than or equal to the min.`,
    ],
    [
      /^The equalToJson must be a valid JSON string\.$/,
      () => $localize`The equalToJson must be a valid JSON string.`,
    ],
    [
      /^The selected (.+) is invalid\.$/,
      (field) => $localize`The selected ${field}:field: is invalid.`,
    ],
    [/^The (.+) is invalid\.$/, (field) => $localize`The ${field}:field: is invalid.`],
    [
      /^The (.+) field is required\.$/,
      (field) => $localize`The ${field}:field: field is required.`,
    ],
    [
      /^The (.+) must be between (.+) and (.+)\.$/,
      (field, min, max) =>
        $localize`The ${field}:field: must be between ${min}:min: and ${max}:max:.`,
    ],
    [
      /^The (.+) must be at least (.+)\.$/,
      (field, min) => $localize`The ${field}:field: must be at least ${min}:min:.`,
    ],
    [
      /^The (.+) must be an integer\.$/,
      (field) => $localize`The ${field}:field: must be an integer.`,
    ],
    [/^The (.+) must be a number\.$/, (field) => $localize`The ${field}:field: must be a number.`],
    [/^The (.+) must be a string\.$/, (field) => $localize`The ${field}:field: must be a string.`],
    [
      /^The (.+) must be an object\.$/,
      (field) => $localize`The ${field}:field: must be an object.`,
    ],
    [/^The (.+) must be an array\.$/, (field) => $localize`The ${field}:field: must be an array.`],
    [
      /^The (.+) field must be true or false\.$/,
      (field) => $localize`The ${field}:field: field must be true or false.`,
    ],
  ];
}

function translate(original: string, families: Family[]): ServerPhrase {
  for (const [pattern, build] of families) {
    const found = pattern.exec(original);
    if (found) {
      const text = build(...found.slice(1));
      return { text, original, translated: text !== original };
    }
  }
  return { text: original, original, translated: false };
}

/** Uma frase do "por que não casou" (near miss, teste, trace). */
export function conditionPhrase(original: string): ServerPhrase {
  return translate(original, conditionFamilies());
}

/** Uma mensagem do 422 das regras (o texto depois da chave). */
export function validationPhrase(original: string): ServerPhrase {
  return translate(original, validationFamilies());
}

/** "Original: {frase}", para o `title` da frase traduzida. */
export function originalTitle(phrase: ServerPhrase): string | null {
  return phrase.translated ? $localize`Original: ${phrase.original}:phrase:` : null;
}
