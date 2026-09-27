import { Locator, Page, Request } from '@playwright/test';
import { expect, test } from './support/fixtures';
import {
  abrirDetalhes,
  abrirRegras,
  gravarRegras,
  metodo,
  novaRegra,
  parte,
} from './support/regras';

// UX de Regras, fatia F4 — teste que não some (WM-22; guia-ux §3.4; CA-7). O resultado fica quando muda o que não é
// condição; com a condição mudada ganha "Out of date" e reroda sozinho (≥ 1 s depois da última mudança, um pedido
// por vez, só se o teste já foi pedido). Cada mensagem do resultado é `link "{method} {path} · {time}"` com o trecho
// do corpo e o selo da época, e abre a mensagem ao lado, dentro de Regras. SUPOSIÇÕES:
// - SUPOSIÇÃO: o `status "History test"` de hoje continua sendo o contêiner do resultado (o guia o chama de região
//   existente); o chip "Out of date" fica dentro dele.
// - SUPOSIÇÃO: o nome da `region "Request {id}"` usa o UUID inteiro ou os 5 primeiros caracteres (com ou sem "#").
// - SUPOSIÇÃO: "Testing…" é o texto do botão que dispara o teste enquanto ele roda ("Test against history" no rodapé
//   das abas ou "Test again" no resultado).

const pedidosDeTeste = (page: Page, tokenId: string): Request[] => {
  const pedidos: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes(`/token/${tokenId}/rules/test`)) {
      pedidos.push(r);
    }
  });
  return pedidos;
};

function resultado(regra: Locator): Locator {
  return regra.getByRole('status', { name: 'History test' });
}

function resumo(regra: Locator): Locator {
  return resultado(regra).locator('.summary');
}

/** URL com POST /pedidos e GET /outra; regra nova "Só POST" testada uma vez (1 de 2). */
async function testada(page: Page, tokenId: string): Promise<Locator> {
  await abrirRegras(page, tokenId);
  const regra = await novaRegra(page);
  await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Só POST');
  await parte(regra, 'Match');
  await metodo(regra, 'POST');
  await regra.getByRole('button', { name: 'Test against history' }).click();
  await expect(resumo(regra)).toHaveText(/^1 of the 2 most recent requests would match\.?$/);
  return regra;
}

test.describe('Dado um resultado do teste contra o histórico (WM-22; CA-7)', () => {
  test('não deve sumir nem desatualizar Quando só mudam nome, prioridade, ligada, resposta ou cenário', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedidos', data: '{"id":1}' });
    await tokens.send(tokenId, { method: 'GET', path: '/outra' });
    const regra = await testada(page, tokenId);
    const pedidos = pedidosDeTeste(page, tokenId);

    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Outro nome');
    await abrirDetalhes(page, regra);
    await regra.getByRole('spinbutton', { name: 'Priority' }).fill('3');
    await regra.getByRole('switch', { name: 'Enabled' }).click();
    await parte(regra, 'Response');
    await regra.getByRole('spinbutton', { name: 'Status' }).fill('202');
    await parte(regra, 'Scenario');
    await regra.getByRole('combobox', { name: 'Scenario name', exact: true }).fill('fluxo');
    await parte(regra, 'Test');

    await expect(resumo(regra)).toHaveText(/^1 of the 2 most recent requests would match\.?$/);
    await expect(resultado(regra).getByText('Out of date', { exact: true })).toHaveCount(0);
    // Nada disso é condição: não há rerun (a janela do rerun é de 1 s).
    await page.waitForTimeout(1_500);
    expect(pedidos).toHaveLength(0);
  });

  test('deve marcar "Out of date" e rerodar sozinho, um pedido só, ≥ 1 s depois da última mudança de condição', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedidos', data: '{"id":1}' });
    await tokens.send(tokenId, { method: 'GET', path: '/outra' });
    const regra = await testada(page, tokenId);
    const pedidos = pedidosDeTeste(page, tokenId);
    await parte(regra, 'Match');

    await regra.getByRole('button', { name: 'Add query condition' }).click();
    const consulta = regra.getByRole('textbox', { name: 'Query 1 name' });
    await consulta.click();
    await consulta.pressSequentially('tipo', { delay: 80 });
    const fimDaDigitacao = Date.now();
    // Dentro da janela de 1 s: o resultado ainda é o antigo, marcado como desatualizado.
    await parte(regra, 'Test');
    await expect(resultado(regra).getByText('Out of date', { exact: true })).toBeVisible();

    await expect.poll(() => pedidos.length, { timeout: 5_000 }).toBe(1);
    const [rerun] = pedidos;
    expect((await rerun.response())?.status()).toBe(200);
    expect(rerun.timing().startTime - fimDaDigitacao).toBeGreaterThanOrEqual(900);
    // Com a query "tipo" exigida, nenhuma das duas casa mais.
    await expect(resumo(regra)).toHaveText(/^0 of the 2 most recent requests would match\.?$/);
    await expect(resultado(regra).getByText('Out of date', { exact: true })).toHaveCount(0);
    await page.waitForTimeout(1_500);
    expect(pedidos).toHaveLength(1);
  });

  test('não deve rerodar Quando o teste nunca foi pedido', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedidos' });
    await abrirRegras(page, tokenId);
    const pedidos = pedidosDeTeste(page, tokenId);
    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Sem teste');
    await parte(regra, 'Match');
    await regra.getByRole('button', { name: 'Add query condition' }).click();
    await regra.getByRole('textbox', { name: 'Query 1 name' }).fill('tipo');

    await page.waitForTimeout(2_000);
    expect(pedidos).toHaveLength(0);
  });

  test('deve mostrar "Testing…" ocupado enquanto o teste roda', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedidos' });
    await page.route(/\/rules\/test(\?.*)?$/, async (rota) => {
      await new Promise((fim) => setTimeout(fim, 1_500));
      await rota.continue();
    });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Lenta');

    await regra.getByRole('button', { name: 'Test against history' }).click();

    const testando = regra.getByRole('button', { name: 'Testing…' }).first();
    await expect(testando).toBeVisible();
    await expect(testando).toHaveAttribute('aria-busy', 'true');
    await expect(resumo(regra)).toBeVisible();
  });
});

test.describe('Dado as mensagens no resultado do teste (WM-22)', () => {
  test('deve mostrar método, caminho, trecho do corpo e quem respondeu na época, e abrir a mensagem ao lado', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      {
        name: 'Antiga',
        priority: 1,
        match: { path: { equals: '/pedidos' } },
        response: { status: 201 },
      },
    ]);
    const corpo = JSON.stringify({ id: 42, texto: 'x'.repeat(150) });
    const id = await tokens.send(tokenId, {
      path: '/pedidos',
      headers: { 'Content-Type': 'application/json' },
      data: corpo,
    });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Nova');
    await regra.getByRole('button', { name: 'Test against history' }).click();

    const item = resultado(regra).getByRole('link', { name: /^POST \/pedidos · .+/ });
    await expect(item).toBeVisible();
    // `has` pede um locator relativo ao próprio li: ancorado na região, nunca casaria.
    const linha = resultado(regra)
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: /^POST \/pedidos · / }) });
    await expect(linha).toContainText(corpo.slice(0, 80));
    await expect(linha).not.toContainText(corpo);
    await expect(linha).toContainText('answered 201 by Antiga at the time');

    const abas = page.context().pages().length;
    await item.click();
    const aberta = page.getByRole('region', {
      name: new RegExp(`^Request #?(${id}|${id.substring(0, 5)})`),
    });
    await expect(aberta).toBeVisible();
    await expect(aberta).toContainText(id);
    expect(page.context().pages()).toHaveLength(abas);
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules`));
    await aberta.getByRole('button', { name: 'Close' }).click();
    await expect(aberta).toHaveCount(0);
    await expect(regra).toBeVisible();
  });

  test('deve pôr a prévia "With the rules before it" logo abaixo do contador', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      {
        name: 'Primeira',
        priority: 1,
        match: { path: { equals: '/x' } },
        response: { status: 201 },
      },
    ]);
    await tokens.send(tokenId, { path: '/x' });
    await tokens.send(tokenId, { path: '/y' });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Nova');
    await regra.getByRole('button', { name: 'Test against history' }).click();

    const previa = await regra
      .getByRole('heading', { name: 'With the rules before it' })
      .boundingBox();
    const contador = await resumo(regra).boundingBox();
    const casariam = await resultado(regra)
      .getByRole('heading', { name: /^Would match \(\d+\)$/ })
      .boundingBox();
    expect(previa!.y).toBeGreaterThan(contador!.y);
    expect(previa!.y).toBeLessThan(casariam!.y);
  });
});
