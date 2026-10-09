import { APIRequestContext, Page, test as base, expect } from '@playwright/test';
import { expectSemViolacoesGraves } from './a11y';

export interface TokenFields {
  default_status?: string;
  default_content_type?: string;
  timeout?: string;
  default_content?: string;
  retry_after?: string | number | null;
  auto_cleanup?: number | null;
  signature?: Record<string, unknown> | null;
  schema?: Record<string, unknown> | null;
  read_secret?: string | null;
  e2ee?: Record<string, unknown> | null;
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
  /** Segredo de leitura de cada URL protegida: a limpeza precisa dele (sem ele, 401). */
  private readonly secrets = new Map<string, string>();

  constructor(private readonly api: APIRequestContext) {}

  async create(fields: TokenFields = {}): Promise<string> {
    const response = await this.api.post('/token', { data: fields });
    expect(response.status()).toBe(201);
    const { uuid } = (await response.json()) as { uuid: string };
    this.ids.add(uuid);
    if (fields.read_secret) {
      this.secrets.set(uuid, fields.read_secret);
    }
    return uuid;
  }

  /** Registra o segredo que a tela definiu (ou trocou) numa URL, para a limpeza. */
  protectedWith(uuid: string, secret: string): void {
    this.secrets.set(uuid, secret);
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

  /** Envia `count` webhooks em lotes paralelos (volume para a limpeza automática). */
  async sendMany(tokenId: string, count: number, batch = 50): Promise<void> {
    for (let sent = 0; sent < count; sent += batch) {
      const size = Math.min(batch, count - sent);
      await Promise.all(Array.from({ length: size }, () => this.send(tokenId)));
    }
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
      const secret = this.secrets.get(id);
      const headers = secret ? { 'X-Anzol-Secret': secret } : undefined;
      await this.api.delete(`/token/${id}/request`, { headers });
      await this.api.delete(`/token/${id}`, { headers });
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

export const test = base.extend<{ tokens: TokenTracker; axeNoFim: boolean; axeAutomatico: void }>({
  tokens: async ({ request }, use) => {
    const tracker = new TokenTracker(request);
    await use(tracker);
    await tracker.cleanup();
  },
  /** Item 14, E11 (CA-2): o axe roda no fim de todo teste que passou; `test.use({ axeNoFim: false })` desliga. */
  axeNoFim: [true, { option: true }],
  // Depende de `tokens` para rodar antes da limpeza (apagar a URL mudaria a tela).
  axeAutomatico: [
    async ({ page, axeNoFim, tokens }, use, testInfo) => {
      void tokens;
      await use();
      const passou = testInfo.status === testInfo.expectedStatus && testInfo.status === 'passed';
      const naTela = !page.isClosed() && page.url().startsWith('http');
      if (axeNoFim && passou && naTela) {
        await expectSemViolacoesGraves(page, `fim de "${testInfo.titlePath.slice(1).join(' › ')}"`);
      }
    },
    { auto: true },
  ],
});

export { expect };
