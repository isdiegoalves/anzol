import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import {
  anuncios,
  corpo as corpoDoDetalhe,
  detalhes,
  expectCorpo,
  item,
  textoDoCorpo,
} from './support/inbox';
import { seedStorage } from './support/storage';

// Checklist 7 e 13, e o auto-navegar do 9. Precisam do SSE (`GET /token/{id}/stream`, item 02).
// Item 14, E4 — mudança de CENÁRIO (§3 item 4): o snackbar "Request received" de 1 s sai. A chegada entra na lista
// com destaque, é anunciada pelo `LiveAnnouncer` (agregado, no máximo a cada 5 s) e, com uma mensagem aberta e
// "Follow new" desligado, a tela não pula: aparece a pílula "↑ N new request(s)" (C §2.8). "Auto Navigate" vira o
// `switch "Follow new"` (mesma chave `autoNavEnable`, S13/S14).
// SUPOSIÇÕES: o anúncio contém "1 new request" (ou "N new requests"); a pílula é um `button` com
// "N new request(s)" no nome.

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

  test('deve mostrar a mensagem nova, anunciar e contar não lida no título Quando um webhook chega', async ({
    page,
    tokens,
  }) => {
    await openListening(page, tokenId);
    await expect(page.getByText('Waiting for first request...')).toBeVisible();

    const requestId = await tokens.send(tokenId, { data: 'ao vivo' });

    await expect(item(page, requestId)).toBeVisible();
    await expect(anuncios(page).filter({ hasText: /\b1 new request\b/ })).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(page.getByText('Request received')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
    await expect(detalhes(page)).toContainText(requestId);
    await expectCorpo(page, 'ao vivo');
    const segunda = await tokens.send(tokenId, { data: 'segunda' });
    // Patamar, B1 (guia-combinacao §3.1, UX-21): o título diz o destino e a URL.
    await expect(page).toHaveTitle(`(1) Inbox · URL ${tokenId.substring(0, 5)} · Anzol`);
    // Com a primeira aberta, a segunda não rouba o detalhe: entra na lista e na pílula.
    await expect(item(page, segunda)).toBeVisible();
    await expect(page.getByRole('button', { name: /\b1 new request\b/ })).toBeVisible();
    await expect(detalhes(page)).toContainText(requestId);
  });

  test('deve ir para a mensagem nova Quando "Follow new" está ligado', async ({ page, tokens }) => {
    await tokens.send(tokenId, { data: 'antiga' });
    await seedStorage(page, { autoNavEnable: 'true' });
    await openListening(page, tokenId);
    await expect(page.getByRole('switch', { name: 'Follow new' })).toBeChecked();
    await expectCorpo(page, 'antiga');

    const nova = await tokens.send(tokenId, { data: 'nova' });

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${nova}/1$`));
    await expectCorpo(page, 'nova');
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
    await expect(detalhes(page)).toContainText(requestId);
    await expect(corpoDoDetalhe(page)).toBeVisible();
    expect((await textoDoCorpo(page)).length).toBe(corpo.length);
  });
});
