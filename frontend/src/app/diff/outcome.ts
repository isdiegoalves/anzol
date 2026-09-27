import { CapturedRequest, SignatureResult } from '../requests/webhook-request';
import { compareHeaders, compareQuery } from './request-diff';

/** Uma diferença entre A e B que o servidor ligou ao desfecho (assinatura, schema ou regra). */
export interface OutcomeCause {
  check: 'signature' | 'schema' | 'rule';
  /** Onde: o caminho do schema (`/amount`), a condição da regra (`match.method`) ou `signature`. */
  where: string;
  a: string;
  b: string;
}

/** O que a comparação diz além do diff linha a linha (S9). */
export interface OutcomeReport {
  /** "N changes explain the outcome": só com sinais do servidor, nada deduzido do diff. */
  causes: OutcomeCause[];
  /** Diferenças que todo par de entregas do provedor tem (ids, timestamps, a própria assinatura). */
  noise: string[];
  /** O resto: headers, query, linha da requisição e campos do corpo que mudaram. */
  other: string[];
}

/** Headers que mudam a cada entrega, por provedor, mais o tamanho do corpo. */
export const NOISE_HEADERS = [
  'stripe-signature',
  'x-github-delivery',
  'x-slack-request-timestamp',
  'content-length',
] as const;

/** Campos do corpo que mudam a cada evento da Stripe. */
const STRIPE_NOISE_FIELDS = ['/id', '/created'];

/**
 * Classifica as diferenças de A e B (S9). "Explica o desfecho" só o que o servidor gravou: os
 * caminhos de `schema.errors`, as condições de `near_miss` (`conditions`, ou as frases de `failed`
 * em mensagem antiga) e o `signature.reason`. Nada de causalidade inventada: o que sobra vai para
 * "noise" (lista conhecida por provedor) ou "other".
 */
export function explainOutcome(a: CapturedRequest, b: CapturedRequest): OutcomeReport {
  const causes = [...signatureCauses(a, b), ...schemaCauses(a, b), ...ruleCauses(a, b)];
  const noise: string[] = [];
  const other: string[] = [];

  if (a.method !== b.method) {
    other.push('method');
  }
  if (a.url !== b.url) {
    other.push('URL');
  }
  for (const row of compareHeaders(a.headers, b.headers)) {
    if (row.status !== 'equal') {
      const noisy = (NOISE_HEADERS as readonly string[]).includes(row.name.toLowerCase());
      (noisy ? noise : other).push(`header ${row.name.toLowerCase()}`);
    }
  }
  for (const row of compareQuery(a.query, b.query)) {
    if (row.status !== 'equal') {
      other.push(`query ${row.name}`);
    }
  }

  const stripe = isStripe(a) || isStripe(b);
  const causePaths = causes.filter((cause) => cause.check === 'schema').map((cause) => cause.where);
  for (const field of bodyDifferences(a.content, b.content)) {
    if (stripe && STRIPE_NOISE_FIELDS.includes(field)) {
      noise.push(`body ${field}`);
    } else if (!causePaths.some((path) => within(field, path))) {
      other.push(field === '' ? 'body' : `body ${field}`);
    }
  }
  return { causes, noise, other };
}

function signatureText(signature: SignatureResult | null | undefined): string {
  if (!signature) {
    return 'not checked';
  }
  return signature.valid ? 'valid' : (signature.reason ?? 'invalid');
}

function signatureCauses(a: CapturedRequest, b: CapturedRequest): OutcomeCause[] {
  const [textA, textB] = [signatureText(a.signature), signatureText(b.signature)];
  return textA === textB ? [] : [{ check: 'signature', where: 'signature', a: textA, b: textB }];
}

/** Caminho do erro de schema → mensagem; `null` quando a mensagem não foi validada. */
function schemaErrors(request: CapturedRequest): Map<string, string> | null {
  const schema = request.schema;
  if (!schema) {
    return null;
  }
  return new Map(
    [...schema.errors].reverse().map((error): [string, string] => [error.path, error.message]),
  );
}

function schemaCauses(a: CapturedRequest, b: CapturedRequest): OutcomeCause[] {
  const [errorsA, errorsB] = [schemaErrors(a), schemaErrors(b)];
  if (!errorsA || !errorsB) {
    return errorsA === errorsB
      ? []
      : [
          {
            check: 'schema',
            where: 'schema',
            a: errorsA ? (errorsA.size ? 'invalid' : 'valid') : 'not checked',
            b: errorsB ? (errorsB.size ? 'invalid' : 'valid') : 'not checked',
          },
        ];
  }
  const paths = [...new Set([...errorsA.keys(), ...errorsB.keys()])].sort();
  return paths
    .filter((path) => errorsA.get(path) !== errorsB.get(path))
    .map((path) => ({
      check: 'schema',
      where: path,
      a: errorsA.get(path) ?? 'valid here',
      b: errorsB.get(path) ?? 'valid here',
    }));
}

/** Condição que falhou → frase, pela `conditions` (alinhada à `failed`) ou pela própria frase. */
function failedConditions(request: CapturedRequest): Map<string, string> {
  const nearMiss = request.near_miss;
  if (!nearMiss) {
    return new Map();
  }
  const keys = nearMiss.conditions?.length === nearMiss.failed.length ? nearMiss.conditions : null;
  return new Map(nearMiss.failed.map((phrase, index) => [keys?.[index] ?? phrase, phrase]));
}

/**
 * Só compara condições da mesma regra: a do near miss de um lado contra o outro lado ter sido
 * respondido por ela (todas passaram) ou ter chegado perto dela também.
 */
function ruleCauses(a: CapturedRequest, b: CapturedRequest): OutcomeCause[] {
  const ruleId = a.near_miss?.id ?? b.near_miss?.id;
  if (!ruleId) {
    return [];
  }
  const evaluated = (request: CapturedRequest) =>
    request.rule?.id === ruleId || request.near_miss?.id === ruleId;
  if (!evaluated(a) || !evaluated(b)) {
    return [];
  }
  const [failedA, failedB] = [failedConditions(a), failedConditions(b)];
  const keys = [...new Set([...failedA.keys(), ...failedB.keys()])];
  return keys
    .filter((key) => failedA.get(key) !== failedB.get(key))
    .map((key) => ({
      check: 'rule',
      where: key,
      a: failedA.get(key) ?? 'passed',
      b: failedB.get(key) ?? 'passed',
    }));
}

function isStripe(request: CapturedRequest): boolean {
  return request.signature?.provider === 'stripe' || 'stripe-signature' in request.headers;
}

/** O campo está no caminho do erro ou embaixo dele (`/a/b` está em `/a`; tudo está em `""`). */
function within(field: string, path: string): boolean {
  return path === '' || field === path || field.startsWith(`${path}/`);
}

/**
 * JSON Pointers das folhas que mudaram entre os dois corpos JSON; `['']` quando algum não é JSON
 * e os textos diferem; `[]` quando são iguais.
 */
export function bodyDifferences(a: string | null, b: string | null): string[] {
  if ((a ?? '') === (b ?? '')) {
    return [];
  }
  const [leavesA, leavesB] = [leaves(a), leaves(b)];
  if (!leavesA || !leavesB) {
    return [''];
  }
  const pointers = [...new Set([...leavesA.keys(), ...leavesB.keys()])].sort();
  return pointers.filter((pointer) => leavesA.get(pointer) !== leavesB.get(pointer));
}

function leaves(content: string | null): Map<string, string> | null {
  let value: unknown;
  try {
    value = JSON.parse(content ?? '');
  } catch {
    return null;
  }
  const found = new Map<string, string>();
  const walk = (node: unknown, pointer: string) => {
    if (node !== null && typeof node === 'object') {
      const entries = Array.isArray(node)
        ? node.map((item, index): [string, unknown] => [String(index), item])
        : Object.entries(node as Record<string, unknown>);
      if (entries.length === 0) {
        found.set(pointer, JSON.stringify(node));
      }
      for (const [key, child] of entries) {
        walk(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      }
    } else {
      found.set(pointer, JSON.stringify(node));
    }
  };
  walk(value, '');
  return found;
}
