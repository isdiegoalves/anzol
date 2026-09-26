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

/**
 * Campos editáveis nos diálogos criar/editar. Os de texto só vão preenchidos; `retry_after`,
 * `auto_cleanup`, `signature` e `schema` vão sempre, `null` quando vazios, porque o `PUT` volta ao
 * padrão o campo ausente.
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
}
