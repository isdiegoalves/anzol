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
  created_at: string;
  updated_at: string;
}

/**
 * Campos editáveis nos diálogos criar/editar. Os de texto só vão preenchidos; o `retry_after`
 * vai sempre, `null` quando vazio, porque o `PUT` volta ao padrão o campo ausente.
 */
export interface TokenSettings {
  default_status?: string;
  default_content_type?: string;
  timeout?: string;
  default_content?: string;
  retry_after?: string | null;
}
