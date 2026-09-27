import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirMensagem, verificacoes } from './support/inbox';
import { editor, gravarRegras } from './support/regras';

// UX de Regras, tela de C1 — "Why not rule…?" (WM-23; guia-ux §3.10; CA-5). No cartão da regra do detalhe da
// mensagem, `button "Why not rule…?"` abre `menu "Rules"` (ordem de avaliação, ligadas primeiro, desligadas com
// "(off)"); escolher uma chama `GET …/request/{id}/rules/trace` (backend pronto) e abre `region "Rule trace"`.
// SUPOSIÇÕES:
// - SUPOSIÇÃO: cada item do trace é um `listitem` que começa por "#{posição} {nome}"; a desligada, sem posição, começa
//   pelo nome.
// - SUPOSIÇÃO: "This request no longer exists." aparece quando o trace responde 404 (simulado na rota, porque a
//   mensagem apagada some do detalhe).

const PIX = {
  name: 'Pix pago',
  priority: 1,
  match: { method: ['POST'], headers: { 'X-Tenant': { equals: 'acme' } } },
  response: { status: 201 },
};
const TUDO = { name: 'Tudo o resto', priority: 9, response: { status: 404 } };
const PARADA = { name: 'Parada', priority: 5, enabled: false, response: { status: 503 } };

async function porQueNao(page: Page, regra: string) {
  await verificacoes(page).getByRole('button', { name: 'Why not rule…?' }).click();
  const menu = page.getByRole('menu', { name: 'Rules' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: regra, exact: true }).click();
  return page.getByRole('region', { name: 'Rule trace' });
}

test.describe('Dado uma mensagem que outra regra respondeu (WM-23; CA-5)', () => {
  test('deve explicar condição por condição por que a regra escolhida não casou', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const [pix] = await gravarRegras(request, tokenId, [PIX, TUDO, PARADA]);
    const id = await tokens.send(tokenId, { headers: { 'X-Tenant': 'outra' } });
    await abrirMensagem(page, tokenId, id);

    await verificacoes(page).getByRole('button', { name: 'Why not rule…?' }).click();
    const menu = page.getByRole('menu', { name: 'Rules' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Pix pago',
      'Tudo o resto',
      'Parada (off)',
    ]);
    await menu.getByRole('menuitem', { name: 'Pix pago', exact: true }).click();

    const trace = page.getByRole('region', { name: 'Rule trace' });
    await expect(trace).toContainText('Answered by: Tudo o resto');
    const itens = trace.getByRole('listitem');
    await expect(itens.filter({ hasText: /^\s*#1 Pix pago/ })).toContainText(
      'did not match: header x-tenant: expected "acme", got "outra"',
    );
    await expect(itens.filter({ hasText: /^\s*#2 Tudo o resto/ })).toContainText(
      'matched · answered',
    );
    await expect(trace.getByRole('link', { name: 'Pix pago', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`#/${tokenId}/rules/${pix.id}`),
    );
    await trace.getByRole('link', { name: 'Pix pago', exact: true }).click();
    await expect(editor(page, 'Edit rule Pix pago')).toBeVisible();
  });

  test('deve dizer "matched, but an earlier rule answered" para a regra que casou depois', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX, TUDO]);
    const id = await tokens.send(tokenId, { headers: { 'X-Tenant': 'acme' } });
    await abrirMensagem(page, tokenId, id);

    const trace = await porQueNao(page, 'Tudo o resto');

    await expect(trace).toContainText('Answered by: Pix pago');
    await expect(
      trace.getByRole('listitem').filter({ hasText: /^\s*#2 Tudo o resto/ }),
    ).toContainText('matched, but an earlier rule answered');
  });

  test('deve avisar que o estado do cenário é o de agora', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { ...PIX, scenario: { name: 'entrega', requiredState: 'pago' } },
      TUDO,
    ]);
    const id = await tokens.send(tokenId, { headers: { 'X-Tenant': 'acme' } });
    await abrirMensagem(page, tokenId, id);

    const trace = await porQueNao(page, 'Pix pago');

    await expect(trace).toContainText('Scenario state as of now.');
  });
});

test.describe('Dado uma mensagem que nenhuma regra respondeu (WM-23)', () => {
  test('deve dizer "No rule answered" e explicar a regra escolhida', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    const id = await tokens.send(tokenId, { method: 'GET' });
    await abrirMensagem(page, tokenId, id);

    const trace = await porQueNao(page, 'Pix pago');

    await expect(trace).toContainText('No rule answered');
    await expect(trace.getByRole('listitem').filter({ hasText: /^\s*#1 Pix pago/ })).toContainText(
      'method: expected POST, got GET',
    );
  });
});

test.describe('Dado o trace carregando ou com erro (WM-23)', () => {
  test('deve mostrar "Checking the rules…" ocupado e depois o erro com o status', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    const id = await tokens.send(tokenId, { method: 'GET' });
    await page.route(/\/rules\/trace$/, async (rota) => {
      await new Promise((fim) => setTimeout(fim, 1_000));
      await rota.fulfill({ status: 500, json: { error: 'boom' } });
    });
    await abrirMensagem(page, tokenId, id);

    const trace = await porQueNao(page, 'Pix pago');

    await expect(trace).toHaveAttribute('aria-busy', 'true');
    await expect(trace).toContainText('Checking the rules…');
    await expect(trace).toContainText('Could not check the rules (500).');
  });

  test('deve dizer que a mensagem não existe mais Quando o trace responde 404', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    const id = await tokens.send(tokenId, { method: 'GET' });
    await page.route(/\/rules\/trace$/, (rota) =>
      rota.fulfill({ status: 404, json: { error: 'Request not found' } }),
    );
    await abrirMensagem(page, tokenId, id);

    const trace = await porQueNao(page, 'Pix pago');

    await expect(trace).toContainText('This request no longer exists.');
  });
});
