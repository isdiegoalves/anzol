import { Locator, Page, Request } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirRegras, gravarRegras, novaRegra, parte } from './support/regras';

// UX de Regras, tela de C4 — "Preview response" (E-05; guia-ux §3.10 e §3.4; CA-10 na parte da tela). Na aba Test,
// `button "Preview response"` (habilitado com ≥ 1 "Would match"; senão com a dica "Nothing would match yet") chama
// `POST /rules/test?render=3` só sob pedido (nunca no rerun) e abre `region "Rendered responses"` com uma aba por
// mensagem: status, cabeçalhos e corpo; "Fault: {type}"; "Timed out (1 s)"; a ressalva "seq and now are from now.".
// Backend pronto. SUPOSIÇÕES:
// - SUPOSIÇÃO: a dica do botão desabilitado é `title` ou MatTooltip num elemento em volta (o botão desabilitado não
//   recebe hover); o teste lê o texto na página.
// - SUPOSIÇÃO: as abas da região são `tab` com o nome "{method} {path} · {time}".

function renders(page: Page, tokenId: string): Request[] {
  const pedidos: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes(`/token/${tokenId}/rules/test`)) {
      pedidos.push(r);
    }
  });
  return pedidos;
}

async function regraTestada(page: Page, tokenId: string, corpo: string): Promise<Locator> {
  await abrirRegras(page, tokenId);
  const regra = await novaRegra(page);
  await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Eco');
  await parte(regra, 'Response');
  await regra.getByRole('spinbutton', { name: 'Status' }).fill('202');
  await regra.getByRole('switch', { name: 'Template' }).click();
  await regra.getByRole('textbox', { name: 'Response body' }).fill(corpo);
  await regra.getByRole('button', { name: 'Test against history' }).click();
  await expect(regra.getByRole('status', { name: 'History test' })).toBeVisible();
  return regra;
}

test.describe('Dado o teste de uma regra com template (E-05; CA-10)', () => {
  test('deve mostrar a resposta renderizada por mensagem, só quando pedida', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, {
      path: '/pagamentos',
      headers: { 'Content-Type': 'application/json' },
      data: '{"status":"pago"}',
    });
    const pedidos = renders(page, tokenId);
    const regra = await regraTestada(
      page,
      tokenId,
      `{"eco": "{{jsonPath request.body '$.status'}}"}`,
    );
    expect(pedidos.every((p) => !p.url().includes('render='))).toBe(true);

    const [pedido] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/rules/test?render=3')),
      regra.getByRole('button', { name: 'Preview response' }).click(),
    ]);
    expect(new URL(pedido.url()).searchParams.get('render')).toBe('3');

    const respostas = regra.getByRole('region', { name: 'Rendered responses' });
    await expect(respostas.getByRole('tab', { name: /^POST \/pagamentos · .+/ })).toBeVisible();
    await expect(respostas).toContainText('202');
    await expect(respostas).toContainText('"eco": "pago"');
    await expect(respostas).toContainText('seq and now are from now.');

    // O rerun (F4) nunca pede render.
    const antes = pedidos.length;
    await parte(regra, 'Match');
    await regra.getByRole('button', { name: 'Add query condition' }).click();
    await regra.getByRole('textbox', { name: 'Query 1 name' }).fill('tipo');
    await expect.poll(() => pedidos.length, { timeout: 5_000 }).toBeGreaterThan(antes);
    expect(pedidos.slice(antes).every((p) => !p.url().includes('render='))).toBe(true);
  });

  test('deve desabilitar "Preview response" com a dica Quando nada casaria', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { method: 'GET', path: '/outra' });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Só POST');
    await parte(regra, 'Match');
    await regra
      .getByRole('group', { name: 'Methods' })
      .getByRole('button', { name: 'POST', exact: true })
      .click();
    await regra.getByRole('button', { name: 'Test against history' }).click();

    const previa = regra.getByRole('button', { name: 'Preview response' });
    await expect(previa).toBeDisabled();
    await expect(
      regra
        .locator('[title="Nothing would match yet"]')
        .or(regra.getByText('Nothing would match yet')),
    ).toHaveCount(1);
  });

  test('deve mostrar "Fault: {type}" e "Timed out (1 s)" nas entradas que não renderizam', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const a = await tokens.send(tokenId, { path: '/a' });
    const b = await tokens.send(tokenId, { path: '/b' });
    await page.route(/\/rules\/test\?render=3$/, async (rota) => {
      const resposta = await rota.fetch();
      const corpo = (await resposta.json()) as Record<string, unknown>;
      corpo['rendered'] = [
        { uuid: b, fault: 'connection_reset' },
        { uuid: a, error: 'timeout' },
      ];
      await rota.fulfill({ response: resposta, json: corpo });
    });
    const regra = await regraTestada(page, tokenId, 'ok');

    await regra.getByRole('button', { name: 'Preview response' }).click();

    const respostas = regra.getByRole('region', { name: 'Rendered responses' });
    await respostas.getByRole('tab', { name: /^POST \/b · / }).click();
    await expect(respostas).toContainText('Fault: connection_reset');
    await respostas.getByRole('tab', { name: /^POST \/a · / }).click();
    await expect(respostas).toContainText('Timed out (1 s)');
  });
});
