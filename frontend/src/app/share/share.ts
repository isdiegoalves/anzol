import { WebhookRequest } from '../requests/webhook-request';

/** Validades que o servidor aceita em `expires_in`; o padrão é 7 dias. */
export const SHARE_EXPIRATIONS = ['1h', '1d', '7d', '30d'] as const;
export type ShareExpiration = (typeof SHARE_EXPIRATIONS)[number];
export const DEFAULT_SHARE_EXPIRATION: ShareExpiration = '7d';

export const SHARE_EXPIRATION_LABELS: Record<ShareExpiration, string> = {
  '1h': '1 hour',
  '1d': '1 day',
  '7d': '7 days',
  '30d': '30 days',
};

/** Pedido de `POST /token/{id}/request/{rid}/share`. */
export interface ShareOptions {
  expires_in: ShareExpiration;
  /** Mascara headers de credencial e query com nome de segredo; o corpo nunca é mascarado. */
  redact: boolean;
}

/**
 * Link só-leitura, como a API devolve ao criar e em `GET /token/{id}/shares`. `url` é o caminho na
 * tela (`/#/share/{id}`). `request_id` pode faltar na listagem.
 */
export interface ShareLink {
  id: string;
  url: string;
  expires_at: string;
  redact: boolean;
  request_id?: string;
}

/** `GET /share/{id}`: a mensagem (mesmo JSON de `GET /request`) e as datas do link. */
export type SharedRequest = WebhookRequest & { shared_at: string; expires_at: string };
