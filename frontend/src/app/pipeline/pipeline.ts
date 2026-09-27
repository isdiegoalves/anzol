import { CapturedRequest, SignatureResult, absentHeader } from '../requests/webhook-request';
import { conditionPhrase } from './server-phrases';
import { SIGNATURE_PROVIDER_LABELS, Token } from '../token/token';
import { SignatureCheck, signatureCheck } from './signature-check';

/** As três verificações que a tela mostra em toda mensagem, no mesmo componente (`app-check-chip`). */
export type CheckKind = 'signature' | 'schema' | 'rule';

/**
 * Tom do selo: `ok` passou; `bad` falhou; `near` nenhuma regra casou, mas uma chegou perto;
 * `none` não se aplica (a URL não verificava, ou a mensagem é de antes da verificação).
 */
export type CheckTone = 'ok' | 'bad' | 'near' | 'none';

/**
 * Estado fino de cada verificação. Assinatura: `valid`, `invalid` (o HMAC não bate), `stale`
 * (bate, mas o timestamp está fora da tolerância), `absent` (faltou um header exigido),
 * `unchecked`. Schema: `valid`, `invalid`, `unchecked`. Regra: `answered`, `near-miss`,
 * `default` (respondeu a resposta padrão).
 */
export type CheckState =
  'valid' | 'invalid' | 'stale' | 'absent' | 'unchecked' | 'answered' | 'near-miss' | 'default';

/** Resultado de uma verificação, pronto para o selo (lista) e o cartão (detalhe). */
export interface CheckResult {
  kind: CheckKind;
  state: CheckState;
  tone: CheckTone;
  /** Título curto: "Signature valid", "Schema invalid", "No rule matched". */
  title: string;
  /** Segunda linha: o provedor, o motivo do servidor, o primeiro erro, a regra. */
  detail: string;
  /**
   * O selo da lista (INBOX-13), em poucas palavras que dizem o que houve: "GitHub", "Mismatch",
   * "Stale timestamp", "2 schema errors", "201 · Pix".
   */
  short: string;
  /** A regra que o resultado cita (a que respondeu, ou a mais próxima): o link no cartão (WM-10). */
  ref?: { id: string; name: string };
}

/** O que a tela deriva de uma mensagem para mostrar a verificação dela. */
export interface RequestPipeline {
  method: string;
  /** Caminho e query depois do UUID da URL (`/pedidos?x=1`); `/` sem caminho. */
  route: string;
  signature: CheckResult;
  schema: CheckResult;
  rule: CheckResult;
  /** As linhas da tabela de headers que a assinatura leu; `null` sem verificação. */
  signatureHeaders: SignatureCheck | null;
}

/** O que mais a tela sabe além da mensagem. O link só-leitura não tem a URL. */
export interface PipelineContext {
  token?: Token | null;
}

/**
 * Deriva da mensagem gravada a assinatura, o schema e a regra, como a lista, o detalhe, o Compare
 * e o link só-leitura mostram. Não usa `token_id` nem o UUID da `url`: no link só-leitura o
 * primeiro não vem e o segundo é `[redacted]`.
 */
export function pipelineOf(
  request: CapturedRequest,
  context: PipelineContext = {},
): RequestPipeline {
  return {
    method: request.method,
    route: routeOf(request.url),
    signature: signatureResult(request),
    schema: schemaResult(request, context.token ?? null),
    rule: ruleResult(request),
    signatureHeaders: signatureCheck(request, context.token ?? null),
  };
}

/** Os três resultados na ordem em que a tela os mostra. */
export function checksOf(request: CapturedRequest): readonly CheckResult[] {
  const { signature, schema, rule } = pipelineOf(request);
  return [signature, schema, rule];
}

/**
 * Caminho depois do primeiro segmento da URL gravada, que é o da URL do webhook: o UUID, ou
 * `[redacted]` (também codificado) no link só-leitura.
 */
export function routeOf(url: string): string {
  const afterHost = url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, '');
  const [path, query = ''] = splitOnce(afterHost, '?');
  const rest = path.replace(/^\/[^/]*/, '');
  return `${rest || '/'}${query ? `?${query}` : ''}`;
}

function splitOnce(text: string, separator: string): [string, string?] {
  const at = text.indexOf(separator);
  return at < 0 ? [text] : [text.slice(0, at), text.slice(at + 1)];
}

const STALE_REASON = /^timestamp outside tolerance/;

function signatureResult(request: CapturedRequest): CheckResult {
  const kind = 'signature';
  const signature: SignatureResult | null | undefined = request.signature;
  if (!signature) {
    return {
      kind,
      state: 'unchecked',
      tone: 'none',
      title: $localize`Signature not checked`,
      detail:
        signature === undefined
          ? $localize`Received before signature checks`
          : $localize`This URL did not verify signatures`,
      short: $localize`No sig check`,
    };
  }
  const provider = SIGNATURE_PROVIDER_LABELS[signature.provider] ?? signature.provider;
  if (signature.valid) {
    const age = stripeAge(request);
    return {
      kind,
      state: 'valid',
      tone: 'ok',
      title: $localize`Signature valid`,
      detail:
        age === null
          ? provider
          : $localize`${provider}:provider: · signed ${age}:age: s before arrival`,
      short: provider,
    };
  }
  const reason = signature.reason ?? 'signature invalid';
  if (absentHeader(signature) !== null) {
    return {
      kind,
      state: 'absent',
      tone: 'bad',
      title: $localize`Signature absent`,
      detail: reason,
      short: $localize`No signature`,
    };
  }
  const stale = STALE_REASON.test(reason);
  return {
    kind,
    state: stale ? 'stale' : 'invalid',
    tone: 'bad',
    title: $localize`Signature invalid`,
    detail: reason,
    short: stale ? $localize`Stale timestamp` : $localize`Mismatch`,
  };
}

/**
 * Stripe: segundos entre o `t=` do `Stripe-Signature` e a chegada (INBOX-18), só com dados
 * gravados. `null` fora da Stripe ou sem o `t=`.
 */
function stripeAge(request: CapturedRequest): number | null {
  if (request.signature?.provider !== 'stripe') {
    return null;
  }
  const name = Object.keys(request.headers).find((key) => key.toLowerCase() === 'stripe-signature');
  const signed = /(?:^|,)\s*t=(\d+)/.exec(name ? (request.headers[name][0] ?? '') : '');
  if (!signed) {
    return null;
  }
  const arrival = new Date(`${request.created_at.replace(' ', 'T')}Z`).getTime() / 1000;
  return Math.max(0, Math.round(arrival - Number(signed[1])));
}

/** O dialeto do `$schema` da URL ("2020-12", "draft-07"), no cartão do schema (INBOX-18). */
function schemaDialect(token: Token | null): string | null {
  const uri = token?.schema?.['$schema'];
  const match = typeof uri === 'string' ? /draft[/-](\d{4}-\d{2}|\d+)/.exec(uri) : null;
  if (!match) {
    return null;
  }
  return /^\d{4}-/.test(match[1]) ? match[1] : `draft-${match[1].padStart(2, '0')}`;
}

function schemaResult(request: CapturedRequest, token: Token | null): CheckResult {
  const kind = 'schema';
  const schema = request.schema;
  if (!schema) {
    return {
      kind,
      state: 'unchecked',
      tone: 'none',
      title: $localize`Schema not checked`,
      detail:
        schema === undefined
          ? $localize`Received before schema checks`
          : $localize`This URL did not validate a schema`,
      short: $localize`No schema`,
    };
  }
  if (schema.valid) {
    const dialect = schemaDialect(token);
    return {
      kind,
      state: 'valid',
      tone: 'ok',
      title: $localize`Schema valid`,
      detail:
        dialect === null
          ? $localize`Body matches the schema`
          : $localize`Body matches the schema · ${dialect}:dialect:`,
      short: $localize`Schema`,
    };
  }
  const [first] = schema.errors;
  const count = schema.errors.length;
  const detail = first
    ? `${first.path || $localize`(root)`} ${first.message}${count > 1 ? $localize` (+${count - 1}:count: more)` : ''}`
    : $localize`Body does not match the schema`;
  const notJson = count === 1 && /not JSON/i.test(first?.message ?? '');
  return {
    kind,
    state: 'invalid',
    tone: 'bad',
    title: $localize`Schema invalid`,
    detail,
    short: notJson
      ? $localize`Not JSON`
      : count === 1
        ? $localize`1 schema error`
        : $localize`${count}:count: schema errors`,
  };
}

/**
 * C3 (E-06): o que a mensagem gravou que foi respondido — o status, ou "Fault" com falha de rede;
 * `undefined` na mensagem gravada antes do campo (a tela omite o status).
 */
function answeredWith(request: CapturedRequest): string | undefined {
  const response = request.response;
  if (response?.fault) {
    return $localize`:network fault instead of a response:Fault`;
  }
  return response?.status === undefined ? undefined : String(response.status);
}

function ruleResult(request: CapturedRequest): CheckResult {
  const kind = 'rule';
  if (request.rule) {
    const { id, name } = request.rule;
    const answer = answeredWith(request);
    return {
      kind,
      state: 'answered',
      tone: 'ok',
      title:
        answer === undefined
          ? $localize`Answered by rule`
          : $localize`Answered by rule · ${answer}:status:`,
      detail: name,
      short: answer === undefined ? $localize`Rule: ${name}:rule:` : `${answer} · ${name}`,
      ref: { id, name },
    };
  }
  if (request.near_miss) {
    const { id, name, failed } = request.near_miss;
    return {
      kind,
      state: 'near-miss',
      tone: 'near',
      title: $localize`No rule matched`,
      // INBOX-18: com uma condição só, a frase dela vai no cartão (sem o "Why? (n)").
      detail:
        failed.length === 1
          ? $localize`Closest: ${name}:rule: · ${conditionPhrase(failed[0]).text}:condition:`
          : $localize`Closest: ${name}:rule: (${failed.length}:count: conditions failed)`,
      short: $localize`Near miss`,
      ref: { id, name },
    };
  }
  return {
    kind,
    state: 'default',
    tone: 'none',
    title: $localize`Default response`,
    detail:
      request.rule === undefined ? $localize`Received before rules` : $localize`No rule answered`,
    short: $localize`Default`,
  };
}
