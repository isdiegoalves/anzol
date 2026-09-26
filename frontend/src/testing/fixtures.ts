import { RequestPage, WebhookRequest } from '../app/requests/webhook-request';
import { Token } from '../app/token/token';

export const TOKEN_ID = '3dbd68f4-8890-4f56-affb-c7c9b297e666';

export function token(overrides: Partial<Token> = {}): Token {
  return {
    uuid: TOKEN_ID,
    ip: '127.0.0.1',
    user_agent: 'curl/8',
    default_content: 'ok',
    default_status: 200,
    default_content_type: 'text/plain',
    timeout: 0,
    cors: false,
    created_at: '2026-09-26 00:43:49',
    updated_at: '2026-09-26 00:43:49',
    ...overrides,
  };
}

/** Mensagem com UUID derivado de `n` (1 → 00000000-0000-4000-8000-000000000001). */
export function webhookRequest(n: number, overrides: Partial<WebhookRequest> = {}): WebhookRequest {
  return {
    uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    token_id: TOKEN_ID,
    ip: '192.168.0.1',
    hostname: 'localhost',
    method: 'POST',
    user_agent: 'curl/8',
    content: `{"n":${n}}`,
    query: null,
    headers: { 'content-type': ['application/json'] },
    url: `http://localhost:8084/${TOKEN_ID}`,
    created_at: '2026-09-26 00:43:49',
    updated_at: '2026-09-26 00:43:49',
    ...overrides,
  };
}

export function requestPage(
  data: WebhookRequest[],
  overrides: Partial<RequestPage> = {},
): RequestPage {
  return {
    data,
    total: data.length,
    per_page: 50,
    current_page: 1,
    is_last_page: true,
    from: 1,
    to: data.length,
    ...overrides,
  };
}
