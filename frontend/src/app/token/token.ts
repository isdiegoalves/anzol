import type { AbstractControl, ValidationErrors } from '@angular/forms';

/** URL de webhook, como a API devolve em `GET /token/{id}` (e como o app atual grava no localStorage). */
export interface Token {
  uuid: string;
  ip: string;
  user_agent: string | null;
  default_content: string;
  default_status: number;
  default_content_type: string;
  timeout: number;
  cors: boolean;
  /**
   * `Retry-After` que o webhook devolve: segundos ou data HTTP; `null` desliga. Ausente no token
   * gravado no localStorage por versões anteriores da tela.
   */
  retry_after?: string | number | null;
  /**
   * Limpeza automática: o servidor guarda só as N mais recentes; `null` desliga (vale o teto
   * global). Ausente no token gravado no localStorage por versões anteriores da tela.
   */
  auto_cleanup?: AutoCleanup | null;
  /**
   * Verificação de assinatura HMAC; `null` desliga. O `secret` vem mascarado (`••••` e os 4
   * últimos). Ausente no token gravado no localStorage por versões anteriores da tela.
   */
  signature?: SignatureConfig | null;
  /**
   * JSON Schema que valida o corpo de cada mensagem; `null` desliga. Ausente no token gravado no
   * localStorage por versões anteriores da tela.
   */
  schema?: JsonSchema | null;
  /**
   * A URL exige o segredo de leitura para ver e gerir (o segredo nunca volta). Ausente no token
   * gravado no localStorage por versões anteriores da tela.
   */
  protected?: boolean;
  /**
   * Decifra de atributo (JWE de um JWS) na captura; `null` desliga. Ausente no token gravado no
   * localStorage por versões anteriores da tela.
   */
  e2ee?: E2eePolicy | null;
  /** Chaves de cifra da URL, só a parte pública. Ausente em versões anteriores da tela. */
  e2ee_keys?: E2eeKey[];
  created_at: string;
  updated_at: string;
}

/** Limites aceitos pelo servidor para `auto_cleanup`. */
export const AUTO_CLEANUP_LIMITS = [500, 1000, 5000, 10000] as const;
export type AutoCleanup = (typeof AUTO_CLEANUP_LIMITS)[number];

export const SIGNATURE_PROVIDERS = ['stripe', 'github', 'shopify', 'slack', 'generic'] as const;
export type SignatureProvider = (typeof SIGNATURE_PROVIDERS)[number];

export const SIGNATURE_PROVIDER_LABELS: Record<SignatureProvider, string> = {
  stripe: 'Stripe',
  github: 'GitHub',
  shopify: 'Shopify',
  slack: 'Slack',
  generic: 'Generic',
};

export const SIGNATURE_ALGORITHMS = ['sha1', 'sha256', 'sha512'] as const;
export type SignatureAlgorithm = (typeof SIGNATURE_ALGORITHMS)[number];
export type SignatureEncoding = 'hex' | 'base64';

/**
 * Configuração da assinatura. `header`, `algorithm`, `encoding` e `prefix` só no `generic`;
 * `toleranceSeconds` só na Stripe e no Slack. No `PUT`, `secret` ausente mantém o atual.
 */
export interface SignatureConfig {
  provider: SignatureProvider;
  secret?: string;
  header?: string;
  algorithm?: SignatureAlgorithm;
  encoding?: SignatureEncoding;
  prefix?: string;
  toleranceSeconds?: number;
}

/** Documento JSON Schema (draft 2020-12 por padrão): sempre um objeto JSON. */
export type JsonSchema = Record<string, unknown>;

/** JWK como a API devolve ou recebe (só chaves públicas). */
export type Jwk = Record<string, unknown>;

/** JSONPath no envelope em claro; o objeto compara sem caixa. */
export type E2eeBinding = string | { path: string; ignore_case?: boolean };

/**
 * Política da decifra: o atributo em `path` chega como JWE de um JWS ES256 de um dos
 * `trusted_signers`, com `aud` igual a `audience` e `jti`/`evt`/`app` iguais aos `bindings`.
 */
export interface E2eePolicy {
  path: string;
  required: boolean;
  audience: string;
  bindings: { jti: E2eeBinding; evt: E2eeBinding; app: E2eeBinding };
  max_age_seconds: number;
  trusted_signers: Jwk[];
}

/** Chave de cifra da URL (`use=enc`, `alg=ECDH-ES`); a privada fica no servidor. */
export interface E2eeKey {
  kid: string;
  created_at: string;
  jwk: Jwk;
}

/** Até quantas chaves de cifra a URL guarda (a atual e a da rotação). */
export const E2EE_KEYS_MAX = 2;

/**
 * Corpo do `POST`/`PUT /token`. No `PUT`, campo ausente volta ao padrão: Checks manda sempre a
 * configuração inteira (`savedSettings`), com a parte do cartão trocada. `read_secret` é a exceção
 * (ver o campo).
 */
export interface TokenSettings {
  default_status?: string;
  default_content_type?: string;
  timeout?: string;
  default_content?: string;
  retry_after?: string | null;
  auto_cleanup?: AutoCleanup | null;
  signature?: SignatureConfig | null;
  schema?: JsonSchema | null;
  e2ee?: E2eePolicy | null;
  /**
   * Segredo de leitura. Só vai quando muda: no `PUT`, ausente mantém o atual (ao contrário dos
   * outros campos) e `null` tira a proteção.
   */
  read_secret?: string | null;
}

const SECONDS = /^\d+$/;
/** O servidor guarda os segundos num `Long`: acima disso, 422. */
const MAX_SECONDS = 9223372036854775807n;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IMF_FIXDATE = new RegExp(
  `^(${DAYS.join('|')}), (\\d{2}) (${MONTHS.join('|')}) (\\d{4}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$`,
);

/**
 * `Retry-After = HTTP-date / delay-seconds` (RFC 9110 §10.2.3), como o servidor valida:
 * segundos (só dígitos, até o `Long`) ou data no formato IMF-fixdate, que precisa existir e ter
 * o dia da semana certo. Formatos obsoletos (RFC 850, asctime) e espaço em volta são recusados.
 */
export function isRetryAfter(value: string): boolean {
  if (SECONDS.test(value)) {
    return BigInt(value) <= MAX_SECONDS;
  }
  const match = IMF_FIXDATE.exec(value);
  if (!match) {
    return false;
  }
  const [, day, date, month, year, hour, minute, second] = match;
  const parsed = new Date(Date.UTC(+year, MONTHS.indexOf(month), +date, +hour, +minute, +second));
  return (
    parsed.getUTCFullYear() === +year &&
    parsed.getUTCMonth() === MONTHS.indexOf(month) &&
    parsed.getUTCDate() === +date &&
    parsed.getUTCHours() === +hour &&
    parsed.getUTCMinutes() === +minute &&
    parsed.getUTCSeconds() === +second &&
    parsed.getUTCDay() === DAYS.indexOf(day)
  );
}

/**
 * Validador do campo Retry-After (Create New URL e Checks › Response): vazio desliga o header;
 * preenchido, precisa ser um `Retry-After` válido.
 */
export function retryAfterValidator(control: AbstractControl<string>): ValidationErrors | null {
  return control.value === '' || isRetryAfter(control.value) ? null : { retryAfter: true };
}

/**
 * O comando do CLI que encaminha as mensagens da URL para o app local (onboarding e o menu da
 * URL): `anzol listen --server {origem} --forward http://localhost:3000 --token {uuid}`.
 */
export function cliListenCommand(server: string, tokenId: string): string {
  return `anzol listen --server ${server} --forward http://localhost:3000 --token ${tokenId}`;
}
