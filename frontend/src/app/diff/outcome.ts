import { decryptionReasonText } from '../pipeline/decryption';
import { conditionPhrase, decryptionState, schemaPhrase, target } from '../pipeline/server-phrases';
import {
  SLACK_TIMESTAMP_HEADER,
  signatureCheck,
  signatureReasonText,
} from '../pipeline/signature-check';
import { CapturedRequest, SignatureResult } from '../requests/webhook-request';
import { Token } from '../token/token';
import { compareHeaders, compareQuery } from './request-diff';

/** Uma diferença entre A e B que o servidor ligou ao desfecho (assinatura, schema ou regra). */
export interface OutcomeCause {
  check: 'signature' | 'schema' | 'decryption' | 'rule';
  /** Onde: o caminho do schema (`/amount`), a condição da regra (`match.method`) ou `signature`. */
  where: string;
  a: string;
  b: string;
  /** Na assinatura: o cabeçalho de onde ela foi lida, quando o valor dele difere entre A e B. */
  header?: string;
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
export function explainOutcome(
  a: CapturedRequest,
  b: CapturedRequest,
  token: Token | null = null,
): OutcomeReport {
  const changedHeaders = compareHeaders(a.headers, b.headers)
    .filter((row) => row.status !== 'equal')
    .map((row) => row.name.toLowerCase());
  const causes = [
    ...signatureCauses(a, b, token, changedHeaders),
    ...schemaCauses(a, b),
    ...decryptionCauses(a, b),
    ...ruleCauses(a, b),
  ];
  const noise: string[] = [];
  const other: string[] = [];

  if (a.method !== b.method) {
    other.push($localize`:compared part|:method`);
  }
  if (a.url !== b.url) {
    other.push('URL');
  }
  const risen = causes.map((cause) => cause.header);
  for (const name of changedHeaders.filter((changed) => !risen.includes(changed))) {
    const noisy = (NOISE_HEADERS as readonly string[]).includes(name);
    (noisy ? noise : other).push(target('header', name));
  }
  for (const row of compareQuery(a.query, b.query)) {
    if (row.status !== 'equal') {
      other.push(target('query', row.name));
    }
  }

  const stripe = isStripe(a) || isStripe(b);
  const causePaths = causes.filter((cause) => cause.check === 'schema').map((cause) => cause.where);
  for (const field of bodyDifferences(a.content, b.content)) {
    if (stripe && STRIPE_NOISE_FIELDS.includes(field)) {
      noise.push(target('body', field));
    } else if (!causePaths.some((path) => within(field, path))) {
      other.push(field === '' ? $localize`:compared part|:body` : target('body', field));
    }
  }
  return { causes, noise, other };
}

function signatureText(signature: SignatureResult | null | undefined): string {
  if (!signature) {
    return $localize`:compared signature|:not checked`;
  }
  if (signature.valid) {
    return $localize`:compared signature|:valid`;
  }
  return signature.reason === 'signature mismatch'
    ? $localize`:compared signature|:does not match (signature mismatch)`
    : signatureReasonText(signature.reason ?? 'invalid');
}

/**
 * O cabeçalho que carrega a assinatura sobe com a causa quando mudou de A para B; o timestamp do
 * Slack, que a conta também lê, continua no ruído.
 */
function signatureCauses(
  a: CapturedRequest,
  b: CapturedRequest,
  token: Token | null,
  changedHeaders: string[],
): OutcomeCause[] {
  const [textA, textB] = [signatureText(a.signature), signatureText(b.signature)];
  if (textA === textB) {
    return [];
  }
  const read = [a, b].flatMap((request) => [
    ...(signatureCheck(request, token)?.rows.keys() ?? []),
  ]);
  const header = read.find(
    (name) => name !== SLACK_TIMESTAMP_HEADER && changedHeaders.includes(name),
  );
  return [
    { check: 'signature', where: 'signature', a: textA, b: textB, ...(header && { header }) },
  ];
}

/** O estado da decifra; na inválida, a frase do motivo com o código que o servidor gravou. */
function decryptionText(request: CapturedRequest): string {
  const decryption = request.decryption;
  if (!decryption) {
    return $localize`:compared decryption|:not decrypted`;
  }
  return decryption.reason
    ? decryptionReasonText(decryption.reason)
    : decryptionState(decryption.state);
}

function decryptionCauses(a: CapturedRequest, b: CapturedRequest): OutcomeCause[] {
  const [textA, textB] = [decryptionText(a), decryptionText(b)];
  return textA === textB ? [] : [{ check: 'decryption', where: 'decryption', a: textA, b: textB }];
}

/** Caminho do erro de schema → mensagem; `null` quando a mensagem não foi validada. */
function schemaErrors(request: CapturedRequest): Map<string, string> | null {
  const schema = request.schema;
  if (!schema) {
    return null;
  }
  return new Map(
    [...schema.errors]
      .reverse()
      .map((error): [string, string] => [error.path, schemaPhrase(error.message)]),
  );
}

function schemaText(errors: Map<string, string> | null): string {
  if (!errors) {
    return $localize`:compared schema|:not checked`;
  }
  return errors.size ? $localize`:compared schema|:invalid` : $localize`:compared schema|:valid`;
}

function schemaCauses(a: CapturedRequest, b: CapturedRequest): OutcomeCause[] {
  const [errorsA, errorsB] = [schemaErrors(a), schemaErrors(b)];
  if (!errorsA || !errorsB) {
    return errorsA === errorsB
      ? []
      : [{ check: 'schema', where: 'schema', a: schemaText(errorsA), b: schemaText(errorsB) }];
  }
  const validHere = $localize`:compared schema|:valid here`;
  const paths = [...new Set([...errorsA.keys(), ...errorsB.keys()])].sort();
  return paths
    .filter((path) => errorsA.get(path) !== errorsB.get(path))
    .map((path) => ({
      check: 'schema',
      where: path,
      a: errorsA.get(path) ?? validHere,
      b: errorsB.get(path) ?? validHere,
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
  const side = (phrase: string | undefined) =>
    phrase === undefined ? $localize`:compared rule|:passed` : conditionPhrase(phrase).text;
  return keys
    .filter((key) => failedA.get(key) !== failedB.get(key))
    .map((key) => ({
      check: 'rule',
      where: key,
      a: side(failedA.get(key)),
      b: side(failedB.get(key)),
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
