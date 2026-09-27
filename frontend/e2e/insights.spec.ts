import { createHmac } from 'node:crypto';
import { APIRequestContext, Page } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import { TokenTracker, Webhook, expect, test } from './support/fixtures';

// Item 14, E9: Insights (`#/{token}/insights`) a partir de `GET /token/{id}/stats` (B2): KPIs com a janela
// explícita, gráficos em SVG com tabela de dados alternativa (S19) e o link para o Grafana. SUPOSIÇÕES (combinadas
// com a fatia):
// - h1 "Insights"; `region "Summary"` com os KPIs e a frase "{evaluated} of the {evaluated} kept" quando a URL guarda
//   menos que a janela (fidelidade ao C, fase 2, RULES-39; antes "{evaluated} of the last 500 kept"), na janela
//   padrão de 500;
// - `region "Requests per hour"` com o gráfico (`img` com nome acessível) e a `table "Requests per hour data"`,
//   com uma coluna "Requests";
// - `region "Signature"` com os motivos (`signature.reasons`), `region "Schema"` com os caminhos
//   (`schema.paths`, "(root)" para a raiz) e `region "Rules"` com as regras que responderam;
// - `link "Open in Grafana"` para o dashboard `/d/webhook-site`.

const SECRET = 'segredo-dos-insights';

function github(secret: string | null, body: string): Webhook {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) {
    headers['X-Hub-Signature-256'] =
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }
  return { headers, data: body };
}

/** URL com 4 mensagens: 2 assinadas certo (uma respondida pela regra Pix), 1 errada, 1 sem assinatura e sem id. */
async function urlComMensagens(tokens: TokenTracker, api: APIRequestContext): Promise<string> {
  const tokenId = await tokens.create({
    signature: { provider: 'github', secret: SECRET },
    schema: { type: 'object', required: ['id'] },
  });
  const regras = await api.put(`/token/${tokenId}/rules`, {
    data: [{ name: 'Pix', match: { path: { equals: '/pix' } }, response: { status: 201 } }],
  });
  expect(regras.status()).toBe(200);
  await tokens.send(tokenId, { path: '/pix', ...github(SECRET, '{"id":1}') });
  await tokens.send(tokenId, github(SECRET, '{"id":2}'));
  await tokens.send(tokenId, github('outro-segredo', '{"id":3}'));
  await tokens.send(tokenId, github(null, '{"sem":"id"}'));
  return tokenId;
}

/** Abre Insights, espera o resumo e confere que ele veio do `stats` com a janela de 500. */
async function abrirInsights(page: Page, tokenId: string): Promise<void> {
  const janelas: (string | null)[] = [];
  page.on('request', (sent) => {
    if (sent.method() === 'GET' && sent.url().includes(`/token/${tokenId}/stats`)) {
      janelas.push(new URL(sent.url()).searchParams.get('window'));
    }
  });
  await page.goto(`/#/${tokenId}/insights`);
  await expect(
    page.getByRole('heading', { name: 'Insights', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible();
  expect(janelas.length, 'GET /token/{id}/stats').toBeGreaterThan(0);
  for (const janela of janelas) {
    expect([null, '500']).toContain(janela);
  }
}

test.describe('Dado uma URL com mensagens verificadas', () => {
  test('deve mostrar os KPIs com a janela, o gráfico por hora com a tabela e os motivos por verificação', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await urlComMensagens(tokens, request);

    await abrirInsights(page, tokenId);

    await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
      /\b4 of the 4 kept\b/,
    );
    const porHora = page.getByRole('region', { name: 'Requests per hour' });
    await expect(porHora.getByRole('img')).toHaveAccessibleName(/\S/);
    const tabela = porHora.getByRole('table', { name: 'Requests per hour data' });
    await expect(tabela).toBeVisible();
    const total = await tabela.evaluate((table) => {
      const cabecalhos = [...table.querySelectorAll('thead th')].map((th) =>
        th.textContent?.trim(),
      );
      const coluna = cabecalhos.indexOf('Requests');
      return [...table.querySelectorAll('tbody tr')]
        .map((tr) => Number(tr.querySelectorAll('th, td')[coluna]?.textContent?.trim()))
        .reduce((soma, n) => soma + n, 0);
    });
    expect(total).toBe(4);

    const assinatura = page.getByRole('region', { name: 'Signature', exact: true });
    await expect(assinatura).toContainText('signature mismatch');
    await expect(assinatura).toContainText('header X-Hub-Signature-256 absent');
    await expect(page.getByRole('region', { name: 'Schema', exact: true })).toContainText('(root)');
    await expect(page.getByRole('region', { name: 'Rules', exact: true })).toContainText('Pix');
  });

  test('deve levar ao dashboard do Grafana pelo link "Open in Grafana"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();

    await abrirInsights(page, tokenId);

    await expect(page.getByRole('link', { name: 'Open in Grafana' })).toHaveAttribute(
      'href',
      /\/d\/webhook-site(\/|\?|$)/,
    );
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`Dado Insights no tema ${colorScheme} a ${viewport.width}×${viewport.height} (axe, CA-2)`, () => {
      test.use({ colorScheme, viewport });

      test('deve passar no axe sem violação grave com dados', async ({ page, request, tokens }) => {
        const tokenId = await urlComMensagens(tokens, request);
        await abrirInsights(page, tokenId);
        await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
          /\b4 of the 4 kept\b/,
        );
        await expectSemViolacoesGraves(page, `Insights, ${colorScheme}, ${viewport.width} px`);
      });
    });
  }
}
