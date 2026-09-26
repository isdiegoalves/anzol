import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { seedStorage } from './support/storage';

// Checklist 7 e 13, e o auto-navegar do 9. Precisam do SSE (`GET /token/{id}/stream`, item 02).

/** Abre a URL e espera o `EventSource` receber os cabeçalhos (assinatura pronta no servidor). */
async function openListening(page: Page, tokenId: string): Promise<void> {
  const stream = page.waitForResponse((response) =>
    response.url().endsWith(`/token/${tokenId}/stream`),
  );
  await page.goto(`/#/${tokenId}`);
  expect((await stream).status()).toBe(200);
}

test.describe('Dado a tela aberta recebendo em tempo real (checklist 7)', () => {
  let tokenId: string;

  test.beforeEach(async ({ page, tokens }) => {
    tokenId = await tokens.create();
    await seedStorage(page, {});
  });

  test('deve mostrar a mensagem nova, avisar e contar não lida no título Quando um webhook chega', async ({
    page,
    tokens,
  }) => {
    await openListening(page, tokenId);
    await expect(page.getByText('Waiting for first request...')).toBeVisible();

    const requestId = await tokens.send(tokenId, { data: 'ao vivo' });

    await expect(page.getByText('Request received')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Request Details' })).toContainText(requestId);
    await expect(page.locator('pre')).toHaveText('ao vivo');
    await tokens.send(tokenId, { data: 'segunda' });
    await expect(page).toHaveTitle('(1) Webhook.site');
  });

  test('deve ir para a mensagem nova Quando "Auto Navigate" está ligado', async ({
    page,
    tokens,
  }) => {
    await tokens.send(tokenId, { data: 'antiga' });
    await seedStorage(page, { autoNavEnable: 'true' });
    await openListening(page, tokenId);
    await expect(page.locator('pre')).toHaveText('antiga');

    const nova = await tokens.send(tokenId, { data: 'nova' });

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${nova}/1$`));
    await expect(page.locator('pre')).toHaveText('nova');
  });

  test('deve buscar a mensagem inteira pela API Quando o evento chega truncado (> 1 MB, checklist 13)', async ({
    page,
    tokens,
  }) => {
    await openListening(page, tokenId);
    // 600.000 barras viram 1.200.000 caracteres no JSON do evento (`/` → `\/`): o servidor corta.
    const corpo = '/'.repeat(600_000);
    const detalhe = page.waitForResponse((response) =>
      new RegExp(`/token/${tokenId}/request/[0-9a-f-]{36}$`).test(response.url()),
    );

    const requestId = await tokens.send(tokenId, {
      data: corpo,
      headers: { 'content-type': 'text/plain' },
    });

    expect((await detalhe).url()).toContain(requestId);
    await expect(page.getByRole('table', { name: 'Request Details' })).toContainText(requestId);
    expect((await page.locator('pre').textContent())?.length).toBe(corpo.length);
  });
});
