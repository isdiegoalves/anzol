import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { abrirMensagem, detalhes, verificacoes } from './support/inbox';
import { TokenTracker, expect, test } from './support/fixtures';
import { seedStorage } from './support/storage';

// Item 14, E11: regressão visual das telas principais, no tema claro e no escuro, nas classes compacta (390),
// expandida (1400) e grande (1600). Roda só na imagem Docker do Playwright da versão instalada (./e2e-visual.sh,
// `VISUAL=1`), para a fonte e o rasterizador serem os mesmos em toda máquina; as baselines estão commitadas em
// `visual.spec.ts-snapshots/`.
// O que muda de uma execução para outra fica congelado ou mascarado: o relógio do navegador é fixo, as animações
// ficam desligadas (padrão do `toHaveScreenshot`), e UUIDs, datas, hora e host (a porta do stack muda entre o CI e a
// máquina de quem roda) ficam sob máscara.

const SECRET = 'segredo-visual';
const RELOGIO = new Date('2026-09-26T12:00:00Z');

const TEMAS = ['light', 'dark'] as const;
const CLASSES = [
  { nome: 'compacta', viewport: { width: 390, height: 844 } },
  { nome: 'expandida', viewport: { width: 1400, height: 900 } },
  { nome: 'grande', viewport: { width: 1600, height: 1000 } },
] as const;

function github(secret: string, body: string) {
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    data: body,
  };
}

/**
 * O que muda entre execuções em toda tela: a URL da webhook no cabeçalho e todo texto com UUID (inteiro ou o `#` dos
 * 5 primeiros), data, hora, IP ou o host com a porta do stack.
 */
const VOLATEIS = [
  /[0-9a-f]{8}-[0-9a-f]{4}-/,
  /#[0-9a-f]{5}\b/,
  /\b[A-Z][a-z]{2} \d{1,2}, \d{4}\b/,
  /\b\d{1,2}:\d{2}\b/,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /host\.docker\.internal|localhost:\d+/,
];

function mascarasComuns(page: Page): Locator[] {
  return [
    page.getByRole('textbox', { name: 'Webhook URL' }),
    ...VOLATEIS.map((texto) => page.getByText(texto)),
  ];
}

/** Itens da lista: o `#` do UUID, o IP e a data. */
function mascarasDaLista(page: Page): Locator[] {
  return [page.locator('.item .id'), page.locator('.item .meta')];
}

async function fotografar(page: Page, nome: string, mascaras: Locator[] = []): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${nome}.png`, {
    mask: [...mascarasComuns(page), ...mascaras],
    maxDiffPixelRatio: 0.002,
  });
}

interface Tela {
  nome: string;
  abrir(page: Page, tokens: TokenTracker): Promise<Locator[]>;
}

const TELAS: Tela[] = [
  {
    nome: 'inbox-detalhe',
    async abrir(page, tokens) {
      const tokenId = await tokens.create({
        signature: { provider: 'github', secret: SECRET },
        schema: { type: 'object', required: ['id'] },
      });
      await tokens.send(tokenId, { method: 'GET', path: '/status' });
      const requestId = await tokens.send(tokenId, {
        path: '/pedidos',
        ...github(SECRET, '{"id":42,"itens":[{"sku":"A1","qtd":2}],"status":"pago"}'),
      });
      await seedStorage(page, { formatJsonEnable: 'true', hideTutorial: 'true' });
      await abrirMensagem(page, tokenId, requestId);
      await expect(verificacoes(page)).toContainText('Signature valid');
      return [...mascarasDaLista(page), detalhes(page)];
    },
  },
  {
    nome: 'checks',
    async abrir(page, tokens) {
      const tokenId = await tokens.create({
        default_status: '202',
        default_content: '{"ok":true}',
        default_content_type: 'application/json',
        signature: { provider: 'github', secret: SECRET },
        schema: { type: 'object', required: ['id'] },
      });
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/checks`);
      await expect(page.getByRole('region', { name: 'Signature verification' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Health' })).toBeVisible();
      return [];
    },
  },
  {
    nome: 'rules-editor',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      const response = await page.request.put(`/token/${tokenId}/rules`, {
        data: [
          {
            name: 'Pix pago',
            priority: 1,
            match: {
              method: ['POST'],
              path: { equals: '/pagamentos' },
              body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
            },
            response: { status: 201, headers: {}, body: '{"ok":true}' },
          },
          { name: 'Tudo o resto', priority: 9, response: { status: 404 } },
        ],
      });
      expect(response.status()).toBe(200);
      const [{ id }] = (await response.json()) as { id: string }[];
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/rules/${id}`);
      await expect(page.getByRole('region', { name: 'Edit rule Pix pago' })).toBeVisible();
      return [];
    },
  },
  {
    nome: 'outbound',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/outbound`);
      await expect(page.getByRole('table', { name: 'Outbound history' })).toBeVisible();
      return [];
    },
  },
  {
    nome: 'insights',
    async abrir(page, tokens) {
      const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
      await tokens.send(tokenId, github(SECRET, '{"id":1}'));
      await tokens.send(tokenId, github(SECRET, '{"id":2}'));
      await tokens.send(tokenId, github('outro-segredo', '{"id":3}'));
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/insights`);
      await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
        'of the last 500 kept',
      );
      // O gráfico e a tabela por hora dependem da hora em que o teste roda.
      return [page.getByRole('region', { name: 'Requests per hour' })];
    },
  },
  {
    nome: 'compare',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      const json = { 'Content-Type': 'application/json' };
      const a = await tokens.send(tokenId, {
        headers: { ...json, 'X-Retry': '1' },
        data: '{"id":42,"status":"pending"}',
      });
      const b = await tokens.send(tokenId, {
        headers: { ...json, 'X-Retry': '2' },
        data: '{"id":42,"status":"paid"}',
      });
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/compare/${a}/${b}`);
      const view = page.getByRole('region', { name: 'Compare requests' });
      await expect(view).toBeVisible();
      return [];
    },
  },
  {
    nome: 'onboarding',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}`);
      const pronta = page.getByRole('region', { name: 'Your URL is ready' });
      await expect(pronta).toBeVisible();
      return [pronta.locator('.url'), pronta.locator('.command')];
    },
  },
  {
    nome: 'share',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      const requestId = await tokens.send(tokenId, {
        path: '/hook?token=abc123&page=2',
        headers: { 'Content-Type': 'application/json', authorization: 'Bearer secreto' },
        data: '{"cartao":"4111","valor":10}',
      });
      const link = await page.request.post(`/token/${tokenId}/request/${requestId}/share`, {
        data: {},
      });
      expect([200, 201]).toContain(link.status());
      const { id } = (await link.json()) as { id: string };
      await seedStorage(page, { formatJsonEnable: 'true' });
      await page.goto(`/#/share/${id}`);
      await expect(page.getByText(/Shared read-only link · expires/)).toBeVisible();
      return [page.getByText(/Shared read-only link · expires/), detalhes(page)];
    },
  },
];

test.use({ axeNoFim: false });

for (const colorScheme of TEMAS) {
  for (const classe of CLASSES) {
    test.describe(`Dado o tema ${colorScheme} na classe ${classe.nome}`, () => {
      test.use({ colorScheme, viewport: classe.viewport });

      for (const tela of TELAS) {
        test(`deve bater com a baseline: ${tela.nome}`, async ({ page, tokens }) => {
          await page.clock.setFixedTime(RELOGIO);
          const mascaras = await tela.abrir(page, tokens);
          await fotografar(page, `${tela.nome}-${colorScheme}-${classe.nome}`, mascaras);
        });
      }
    });
  }
}
