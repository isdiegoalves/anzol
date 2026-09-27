import { CapturedRequest, SignatureResult, absentHeader } from '../requests/webhook-request';
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
    signature: signatureResult(request.signature),
    schema: schemaResult(request),
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

function signatureResult(signature: SignatureResult | null | undefined): CheckResult {
  const kind = 'signature';
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
    };
  }
  const provider = SIGNATURE_PROVIDER_LABELS[signature.provider] ?? signature.provider;
  if (signature.valid) {
    return {
      kind,
      state: 'valid',
      tone: 'ok',
      title: $localize`Signature valid`,
      detail: provider,
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
    };
  }
  return {
    kind,
    state: STALE_REASON.test(reason) ? 'stale' : 'invalid',
    tone: 'bad',
    title: $localize`Signature invalid`,
    detail: reason,
  };
}

function schemaResult(request: CapturedRequest): CheckResult {
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
    };
  }
  if (schema.valid) {
    return {
      kind,
      state: 'valid',
      tone: 'ok',
      title: $localize`Schema valid`,
      detail: $localize`Body matches the schema`,
    };
  }
  const [first] = schema.errors;
  const count = schema.errors.length;
  const detail = first
    ? `${first.path || $localize`(root)`} ${first.message}${count > 1 ? $localize` (+${count - 1}:count: more)` : ''}`
    : $localize`Body does not match the schema`;
  return { kind, state: 'invalid', tone: 'bad', title: $localize`Schema invalid`, detail };
}

function ruleResult(request: CapturedRequest): CheckResult {
  const kind = 'rule';
  if (request.rule) {
    return {
      kind,
      state: 'answered',
      tone: 'ok',
      title: $localize`Answered by rule`,
      detail: request.rule.name,
    };
  }
  if (request.near_miss) {
    const failed = request.near_miss.failed.length;
    return {
      kind,
      state: 'near-miss',
      tone: 'near',
      title: $localize`No rule matched`,
      detail:
        failed === 1
          ? $localize`Closest: ${request.near_miss.name}:rule: (1 condition failed)`
          : $localize`Closest: ${request.near_miss.name}:rule: (${failed}:count: conditions failed)`,
    };
  }
  return {
    kind,
    state: 'default',
    tone: 'none',
    title: $localize`Default response`,
    detail:
      request.rule === undefined ? $localize`Received before rules` : $localize`No rule answered`,
  };
}
