import { NearMiss, RuleRef } from '../rules/rule';

/** Valor de query string ou formulário: texto, ou lista/objeto quando vem de `a[]=1`. */
export type FieldValue = string | FieldValue[] | { [name: string]: FieldValue };

/** Mensagem recebida pela URL, no formato da API (`Storage/Request.php` no app atual). */
export interface WebhookRequest {
  uuid: string;
  token_id: string;
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
  created_at: string;
  updated_at: string;
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
