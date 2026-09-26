import { FieldValue } from '../requests/webhook-request';

/** Acima disso, o diff compara só o começo do corpo (em caracteres, como o corte do SSE). */
export const BODY_LIMIT = 1_000_000;

/** Linha da tabela de headers ou de query da comparação. */
export interface FieldRow {
  name: string;
  /** `null` = o campo não existe naquela mensagem. */
  a: string | null;
  b: string | null;
  status: 'equal' | 'different' | 'only-a' | 'only-b';
}

/** Corpo das duas mensagens pronto para o diff de linhas. */
export interface BodyPair {
  a: string;
  b: string;
  /** Os dois eram JSON e foram formatados com as chaves ordenadas. */
  json: boolean;
  /** Algum dos dois passou de `BODY_LIMIT` e foi cortado. */
  truncated: boolean;
}

/**
 * JSON em forma canônica: chaves de objeto em ordem (por código de caractere), arrays na ordem
 * original e indentação de 2 espaços. Duas entregas com as mesmas chaves em outra ordem dão o
 * mesmo texto. `null` quando o conteúdo não é JSON.
 */
export function canonicalJson(content: string | null | undefined): string | null {
  if (!content) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  return write(value, '');
}

/**
 * Escrito à mão, e não com `JSON.stringify` de um objeto com as chaves já em ordem: o JavaScript
 * põe chaves numéricas ("10", "2") antes das outras, em ordem numérica, seja qual for a inserção.
 */
function write(value: unknown, indent: string): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const items = value.map((item) => `${inner}${write(item, inner)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    if (keys.length === 0) {
      return '{}';
    }
    const members = keys.map(
      (key) => `${inner}${JSON.stringify(key)}: ${write(object[key], inner)}`,
    );
    return `{\n${members.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/**
 * Corpos para o diff: se os dois forem JSON, a forma canônica; senão, o texto como chegou. Cada
 * lado passa por `BODY_LIMIT` depois de formatado.
 */
export function bodyPair(a: string | null, b: string | null): BodyPair {
  const canonicalA = canonicalJson(a);
  const canonicalB = canonicalJson(b);
  const json = canonicalA !== null && canonicalB !== null;
  const textA = json ? canonicalA : (a ?? '');
  const textB = json ? canonicalB : (b ?? '');
  return {
    a: textA.slice(0, BODY_LIMIT),
    b: textB.slice(0, BODY_LIMIT),
    json,
    truncated: textA.length > BODY_LIMIT || textB.length > BODY_LIMIT,
  };
}

/** Seção "Request": método e URL gravada. */
export function compareRequestLine(
  a: { method: string; url: string },
  b: { method: string; url: string },
): FieldRow[] {
  return [
    { name: 'Method', a: a.method, b: b.method, status: status(a.method, b.method) },
    { name: 'URL', a: a.url, b: b.url, status: status(a.url, b.url) },
  ];
}

/**
 * Headers por nome, sem diferenciar maiúsculas (`Content-Type` = `content-type`). Vários valores
 * do mesmo header viram um texto só, na ordem em que chegaram. O nome mostrado é o da mensagem A
 * (ou o da B, se só ela tem). Linhas em ordem alfabética.
 */
export function compareHeaders(
  a: Record<string, string[]> | null | undefined,
  b: Record<string, string[]> | null | undefined,
): FieldRow[] {
  const values = (headers: Record<string, string[]>) =>
    Object.entries(headers).map(([name, list]): [string, string] => [name, list.join(', ')]);
  return compareFields(values(a ?? {}), values(b ?? {}), (name) => name.toLowerCase());
}

/** Query string por nome, diferenciando maiúsculas (`?Id=1` e `?id=1` são campos diferentes). */
export function compareQuery(
  a: Record<string, FieldValue> | null | undefined,
  b: Record<string, FieldValue> | null | undefined,
): FieldRow[] {
  const values = (query: Record<string, FieldValue>) =>
    Object.entries(query).map(([name, value]): [string, string] => [
      name,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]);
  return compareFields(values(a ?? {}), values(b ?? {}), (name) => name);
}

function compareFields(
  a: [string, string][],
  b: [string, string][],
  keyOf: (name: string) => string,
): FieldRow[] {
  const sideA = group(a, keyOf);
  const sideB = group(b, keyOf);
  const keys = [...new Set([...sideA.keys(), ...sideB.keys()])].sort();
  return keys.map((key) => {
    const fieldA = sideA.get(key);
    const fieldB = sideB.get(key);
    const valueA = fieldA?.value ?? null;
    const valueB = fieldB?.value ?? null;
    return {
      name: (fieldA ?? fieldB)?.name ?? key,
      a: valueA,
      b: valueB,
      status: status(valueA, valueB),
    };
  });
}

/** Nomes que só diferem na caixa, na mesma mensagem, viram uma linha com os valores juntos. */
function group(
  fields: [string, string][],
  keyOf: (name: string) => string,
): Map<string, { name: string; value: string }> {
  const grouped = new Map<string, { name: string; value: string }>();
  for (const [name, value] of fields) {
    const key = keyOf(name);
    const existing = grouped.get(key);
    grouped.set(
      key,
      existing ? { ...existing, value: `${existing.value}, ${value}` } : { name, value },
    );
  }
  return grouped;
}

function status(a: string | null, b: string | null): FieldRow['status'] {
  if (a === null) {
    return 'only-b';
  }
  if (b === null) {
    return 'only-a';
  }
  return a === b ? 'equal' : 'different';
}
