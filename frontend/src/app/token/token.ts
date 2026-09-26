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
  created_at: string;
  updated_at: string;
}

/** Campos editáveis nos diálogos criar/editar; só os preenchidos vão para a API. */
export interface TokenSettings {
  default_status?: string;
  default_content_type?: string;
  timeout?: string;
  default_content?: string;
}
