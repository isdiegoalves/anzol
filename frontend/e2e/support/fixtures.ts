import { APIRequestContext, Page, test as base, expect } from '@playwright/test';

export interface TokenFields {
  default_status?: string;
  default_content_type?: string;
  timeout?: string;
  default_content?: string;
  retry_after?: string | number | null;
}

export interface Webhook {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  data?: string;
}

/** Tokens criados pelo teste (pela API ou pela tela), apagados no fim. */
export class TokenTracker {
  private readonly ids = new Set<string>();

  constructor(private readonly api: APIRequestContext) {}

  async create(fields: TokenFields = {}): Promise<string> {
    const response = await this.api.post('/token', { data: fields });
    expect(response.status()).toBe(201);
    const { uuid } = (await response.json()) as { uuid: string };
    this.ids.add(uuid);
    return uuid;
  }

  /** Registra um token que a tela criou sozinha (ex.: `/` sem token salvo). */
  track(uuid: string): void {
    this.ids.add(uuid);
  }

  async send(tokenId: string, webhook: Webhook = {}): Promise<string> {
    const response = await this.api.fetch(`/${tokenId}${webhook.path ?? ''}`, {
      method: webhook.method ?? 'POST',
      headers: webhook.headers,
      data: webhook.data,
    });
    return response.headers()['x-request-id'];
  }

  /** Token como a API devolve em `GET /token/{id}`. */
  async read(tokenId: string): Promise<Record<string, unknown>> {
    return (await (await this.api.get(`/token/${tokenId}`)).json()) as Record<string, unknown>;
  }

  /**
   * Mensagens na ordem da API. A API ordena por `created_at`, que tem resolução de segundo:
   * mensagens do mesmo segundo vêm em ordem arbitrária, então o teste não supõe a ordem de envio.
   */
  async listed(tokenId: string, page = 1): Promise<{ uuid: string; method: string }[]> {
    const response = await this.api.get(`/token/${tokenId}/requests`, { params: { page } });
    return ((await response.json()) as { data: { uuid: string; method: string }[] }).data;
  }

  /** O DELETE do token não apaga as mensagens no app atual: apaga as mensagens antes. */
  async cleanup(): Promise<void> {
    for (const id of this.ids) {
      await this.api.delete(`/token/${id}/request`);
      await this.api.delete(`/token/${id}`);
    }
  }
}

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** Token que a URL da tela mostra agora (`#/{token}` ou `#/{token}/{mensagem}/{página}`). */
export function tokenInUrl(page: Page): string {
  const match = new RegExp(`#/(${UUID.source})`).exec(page.url());
  if (!match) {
    throw new Error(`Sem token na URL ${page.url()}`);
  }
  return match[1];
}

export const test = base.extend<{ tokens: TokenTracker }>({
  tokens: async ({ request }, use) => {
    const tracker = new TokenTracker(request);
    await use(tracker);
    await tracker.cleanup();
  },
});

export { expect };
