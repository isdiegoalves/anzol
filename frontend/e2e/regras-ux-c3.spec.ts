import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirMensagem, item, mostrarLista, verificacoes } from './support/inbox';
import { gravarRegras } from './support/regras';

// UX de Regras, tela de C3 — o status realmente respondido (E-06; guia-ux §3.10; CA-9 no selo). O selo da lista da
// Entrada e o cartão do detalhe mostram o `response.status` gravado na mensagem ("404 · Tudo o resto"); com
// `response.fault`, "Fault · {nome}"; mensagem antiga, sem `response`, só "Rule: {nome}" sem número. Backend pronto.
// SUPOSIÇÕES:
// - SUPOSIÇÃO: o cartão continua "Answered by rule · {status}" com o nome da regra; o status passa a vir do gravado.
// - SUPOSIÇÃO: a mensagem antiga é simulada tirando `response` na rota (o app atual sempre grava).

const TUDO = { name: 'Tudo o resto', priority: 9, response: { status: 404 } };

/** Abre a mensagem e mostra a lista da Entrada (a 390 px, um painel por vez: volta à lista pelo detalhe). */
async function abrirLista(page: Page, tokenId: string, id: string): Promise<void> {
  await abrirMensagem(page, tokenId, id);
  await mostrarLista(page);
  await expect(item(page, id)).toBeVisible();
}

test.describe('Dado uma mensagem respondida por regra que mudou depois (E-06; CA-9)', () => {
  test('deve mostrar o status gravado, e não o status atual da regra', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [TUDO]);
    const id = await tokens.send(tokenId);
    await gravarRegras(request, tokenId, [{ ...TUDO, response: { status: 418 } }]);

    await abrirMensagem(page, tokenId, id);

    await expect(verificacoes(page)).toContainText(/Answered by rule · 404\s*Tudo o resto/);
    await mostrarLista(page);
    await expect(item(page, id)).toContainText('404 · Tudo o resto');
    await expect(item(page, id)).not.toContainText('418');
  });
});

test.describe('Dado uma mensagem respondida por uma falha de rede (E-06)', () => {
  test('deve mostrar "Fault · {nome}" no lugar do status', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Reset de conexão', response: { fault: 'connection_reset' } },
    ]);
    await request.post(`/${tokenId}`).catch(() => undefined);
    await expect.poll(async () => (await tokens.listed(tokenId)).length).toBe(1);
    const [{ uuid }] = await tokens.listed(tokenId);

    await abrirLista(page, tokenId, uuid);

    await expect(item(page, uuid)).toContainText('Fault · Reset de conexão');
  });
});

test.describe('Dado uma mensagem antiga, gravada sem a resposta (E-06)', () => {
  test('deve mostrar só "Rule: {nome}", sem número', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [TUDO]);
    const id = await tokens.send(tokenId);
    await page.route(new RegExp(`/token/${tokenId}/requests?(/[^/]+)?(\\?.*)?$`), async (rota) => {
      if (rota.request().method() !== 'GET') {
        await rota.continue();
        return;
      }
      const resposta = await rota.fetch();
      const corpo = (await resposta.json()) as Record<string, unknown>;
      const tirar = (m: Record<string, unknown>) => delete m['response'];
      if (Array.isArray(corpo['data'])) {
        (corpo['data'] as Record<string, unknown>[]).forEach(tirar);
      } else {
        tirar(corpo);
      }
      await rota.fulfill({ response: resposta, json: corpo });
    });

    await abrirLista(page, tokenId, id);

    await expect(item(page, id)).toContainText('Rule: Tudo o resto');
    await expect(item(page, id)).not.toContainText('404');
  });
});
