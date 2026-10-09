import { NearMiss, RuleRef } from '../rules/rule';
import { SignatureProvider } from '../token/token';

/** Valor de query string ou formulário: texto, ou lista/objeto quando vem de `a[]=1`. */
export type FieldValue = string | FieldValue[] | { [name: string]: FieldValue };

/**
 * Mensagem como qualquer leitura a devolve, inclusive o link só-leitura (`GET /share/{sid}`), que
 * não traz `token_id` e põe `[redacted]` no lugar do UUID da URL em `url`. Quem mostra a mensagem
 * sem agir sobre ela (detalhe, selos) usa este tipo.
 */
export interface CapturedRequest {
  uuid: string;
  /** Ausente no link só-leitura. */
  token_id?: string;
  ip: string;
  hostname: string;
  method: string;
  user_agent: string | null;
  content: string | null;
  query: Record<string, FieldValue> | null;
  headers: Record<string, string[]>;
  url: string;
  request?: Record<string, FieldValue> | null;
  /** Regra que respondeu; `null` sem regra (ausente em mensagens gravadas antes das regras). */
  rule?: RuleRef | null;
  /** Regra mais próxima quando havia regras ativas e nenhuma casou. */
  near_miss?: NearMiss | null;
  /**
   * O que a URL respondeu (C3): o status, ou a falha de rede da regra. Ausente (ou `null`) nas
   * mensagens gravadas antes dele: a tela omite o status.
   */
  response?: RecordedResponse | null;
  /** Verificação da assinatura; `null` quando a URL não verifica (ausente em mensagens antigas). */
  signature?: SignatureResult | null;
  /** Validação do corpo pelo schema da URL; `null` quando a URL não valida (ausente em mensagens antigas). */
  schema?: SchemaResult | null;
  /** Decifra do atributo; `null` quando a URL não decifra (ausente em mensagens antigas). */
  decryption?: DecryptionResult | null;
  /**
   * O atributo aberto (o claim `data`), só com a decifra válida e o segredo de leitura. Nunca vem
   * no evento `request.created` nem no link só-leitura.
   */
  decrypted?: unknown;
  created_at: string;
  updated_at: string;
  /** Ordem de gravação na URL; ausente em mensagens gravadas antes dele. */
  seq?: number | null;
}

/** Mensagem recebida pela URL, no formato da API (`Storage/Request.php` no app atual), lida pelo dono. */
export interface WebhookRequest extends CapturedRequest {
  token_id: string;
}

/** A resposta gravada na mensagem: `{status}` ou, com falha de rede, `{fault}`. */
export interface RecordedResponse {
  status?: number;
  fault?: string;
}

/** `reason` é `null` quando válida; senão uma frase curta (`signature mismatch`). */
export interface SignatureResult {
  provider: SignatureProvider;
  valid: boolean;
  reason: string | null;
}

/** Como a condição `match.signature` das regras lê o resultado. */
export type SignatureState = 'valid' | 'invalid' | 'absent';

const ABSENT_REASON = /^header (\S+) absent$/;

/** Ausente é faltar um header que a verificação exige (a assinatura ou, no Slack, o timestamp). */
export function signatureState(signature: SignatureResult): SignatureState {
  if (signature.valid) {
    return 'valid';
  }
  return absentHeader(signature) === null ? 'invalid' : 'absent';
}

/** O header que faltou, como o servidor o escreve no motivo (`X-Hub-Signature-256`). */
export function absentHeader(signature: SignatureResult): string | null {
  return ABSENT_REASON.exec(signature.reason ?? '')?.[1] ?? null;
}

/** Resultado da validação no momento da captura; até 20 erros, na ordem do servidor. */
export interface SchemaResult {
  valid: boolean;
  errors: SchemaError[];
}

/** `path` é o JSON Pointer da instância (`/itens/0/qtd`; `""` é o corpo inteiro). */
export interface SchemaError {
  path: string;
  message: string;
}

export const DECRYPTION_STATES = ['valid', 'invalid', 'unknown_kid', 'absent'] as const;
/** `absent`: o atributo não veio cifrado e a URL aceita texto em claro. */
export type DecryptionState = (typeof DECRYPTION_STATES)[number];

/**
 * Resultado da decifra na captura. `reason` é o código do servidor (`signature_invalid`) quando não
 * é válida; `duplicate_of` é a primeira mensagem com o mesmo `jti`. `kid_deleted_at`, com
 * `unknown_kid` ou `decrypt_failed`: quando a URL apagou uma chave com o `kid` (UTC); `null` sem
 * registro, e ausente em servidor anterior a ele. `aud`: o `aud` do JWS de assinatura verificada,
 * texto do remetente (até 5 valores; controle e formatação trocados por U+FFFD); `null` sem ele.
 */
export interface DecryptionResult {
  state: DecryptionState;
  kid: string | null;
  signature_kid: string | null;
  reason: string | null;
  jti: string | null;
  duplicate_of: string | null;
  kid_deleted_at?: string | null;
  aud?: string[] | null;
}

/** Página de `GET /token/{id}/requests`. */
export interface RequestPage {
  data: WebhookRequest[];
  total: number;
  per_page: number;
  current_page: number;
  is_last_page: boolean;
  from: number;
  to: number;
}

/** Payload do evento `request.created` (SSE `GET /token/{id}/stream`). */
export interface RequestCreated {
  request: WebhookRequest;
  total: number;
  truncated: boolean;
  /** Mensagens que a limpeza automática cortou ao gravar esta (ausente em servidores antigos). */
  removed?: string[];
}
