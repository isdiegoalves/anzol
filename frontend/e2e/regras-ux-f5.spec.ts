import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirMensagem } from './support/inbox';
import { dialogo, editor, gravarRegras, lerRegras, parte, snackbar } from './support/regras';

// UX de Regras, fatia F5 — criar regra da mensagem sem superajustar (WM-31, E-03, WM-28; guia-ux §3.5; CA-6).
// "Create rule from this request" abre a folha com as condições em caixas (id, datas e UUIDs desmarcados), a
// resposta ao lado e a contagem ao vivo; "Create rule" grava direto, "Open in editor" leva ao editor. SUPOSIÇÕES:
// - SUPOSIÇÃO: o texto do guia ("desmarcadas quando o nome parece id/data ou o valor parece UUID/epoch; marcadas nos
//   demais") vale para a query também; o wireframe mostra `Query env` desmarcada, e o teste segue o texto.
// - SUPOSIÇÃO: os valores nos nomes das caixas vêm como na mensagem, com ou sem aspas JSON (`= "pago"` ou `= pago`);
//   o nome do cabeçalho em qualquer caixa.
// - SUPOSIÇÃO: "Create rule" volta a `#/{token}/rules` com a regra nova na lista (e o snackbar "Rule saved").
// - SUPOSIÇÃO: "Test a variation" abre o compositor de "Send as new…" (`region "Send request"`) com a `textbox "URL"`
//   apontada para a própria URL + caminho da mensagem.

const EVENTO = {
  path: '/pagamentos?env=prod',
  headers: { 'Content-Type': 'application/json', 'X-Tenant': 'acme' },
  data: JSON.stringify({
    id: 'p2',
    status: 'pago',
    created_at: 1790512142,
    pedido_id: 'x9',
    ref: '550e8400-e29b-41d4-a716-446655440000',
  }),
};

/** O valor (com ou sem aspas) numa regex de nome acessível. */
const valor = (v: string) => `"?${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`;

function caixa(folha: Locator, nome: RegExp): Locator {
  return folha.getByRole('checkbox', { name: nome });
}

/** Abre a mensagem e a folha "Create rule from this request". */
async function abrirFolha(page: Page, tokenId: string, id: string): Promise<Locator> {
  await abrirMensagem(page, tokenId, id);
  await page.getByRole('button', { name: 'Create rule from this request' }).click();
  const folha = dialogo(page, 'Create rule from this request');
  await expect(folha).toBeVisible();
  return folha;
}

test.describe('Dado uma mensagem JSON e "Create rule from this request" (WM-31; CA-6)', () => {
  test('deve propor as condições sem id, datas e UUIDs, com a resposta ao lado e a contagem', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, EVENTO);
    const folha = await abrirFolha(page, tokenId, id);
    await expect(page).not.toHaveURL(/\/rules\/new/);

    await expect(caixa(folha, /^Method POST$/)).toBeChecked();
    await expect(caixa(folha, /^Path \/pagamentos$/)).toBeChecked();
    await expect(
      folha.getByRole('radiogroup', { name: 'Path match' }).getByRole('radio', { name: 'Equals' }),
    ).toBeChecked();
    await expect(caixa(folha, new RegExp(`^Query env = ${valor('prod')}$`))).toBeChecked();
    await expect(caixa(folha, new RegExp(`^Body \\$\\.status = ${valor('pago')}$`))).toBeChecked();
    for (const campo of ['id', 'created_at', 'pedido_id', 'ref']) {
      await expect(caixa(folha, new RegExp(`^Body \\$\\.${campo} = `))).not.toBeChecked();
    }
    await expect(folha).toContainText('looks like an id');
    await expect(folha).toContainText('timestamp');
    await expect(folha).toContainText('UUID');
    await expect(
      caixa(folha, new RegExp(`^Header x-tenant = ${valor('acme')}$`, 'i')),
    ).not.toBeChecked();

    await expect(folha.getByRole('spinbutton', { name: 'Status' })).toHaveValue('200');
    await expect(folha.getByRole('textbox', { name: 'Body', exact: true })).toBeVisible();
    await expect(folha).toContainText('1 of the last 500 requests would match');
    await expect(caixa(folha, /^Method POST$/)).toBeFocused();
  });

  test('deve gravar com "Create rule" antes da pega-tudo e responder à próxima entrega do mesmo evento', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Tudo o resto', priority: 9, response: { status: 404 } },
    ]);
    const id = await tokens.send(tokenId, EVENTO);
    const folha = await abrirFolha(page, tokenId, id);
    await folha.getByRole('spinbutton', { name: 'Status' }).fill('201');

    await folha.getByRole('button', { name: 'Create rule' }).click();

    await expect(folha).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules`));
    await expect(snackbar(page, 'Rule saved')).toBeVisible();
    const regras = await lerRegras(request, tokenId);
    expect(regras.map((r) => r.name)).toEqual(['POST /pagamentos', 'Tudo o resto']);
    expect(regras[0]).toMatchObject({
      match: {
        method: ['POST'],
        path: { equals: '/pagamentos' },
        query: { env: { equals: 'prod' } },
        body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
      },
      response: { status: 201 },
    });
    expect(JSON.stringify(regras[0]['match'])).not.toMatch(/created_at|pedido_id|p2|550e8400/);

    const proxima = await request.post(`/${tokenId}/pagamentos?env=prod`, {
      headers: { 'Content-Type': 'application/json', 'X-Tenant': 'outra' },
      data: JSON.stringify({
        id: 'p3',
        status: 'pago',
        created_at: 1790512999,
        pedido_id: 'y1',
        ref: '6fa459ea-ee8a-3ca4-894e-db77e160355e',
      }),
    });
    expect(proxima.status()).toBe(201);
  });

  test('deve levar ao editor com o rascunho em "Open in editor", sem gravar', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, EVENTO);
    const folha = await abrirFolha(page, tokenId, id);
    await folha.getByRole('spinbutton', { name: 'Status' }).fill('202');

    await folha.getByRole('button', { name: 'Open in editor' }).click();

    const regra = editor(page);
    await expect(regra).toBeVisible();
    await expect(regra.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'POST /pagamentos',
    );
    await parte(regra, 'Match');
    await expect(regra.getByRole('textbox', { name: 'Path', exact: true })).toHaveValue(
      '/pagamentos',
    );
    await expect(regra.getByRole('textbox', { name: 'Body 1 path' })).toHaveValue('$.status');
    await expect(regra.getByRole('textbox', { name: 'Body 2 path' })).toHaveCount(0);
    await parte(regra, 'Response');
    await expect(regra.getByRole('spinbutton', { name: 'Status' })).toHaveValue('202');
    expect(await lerRegras(request, tokenId)).toEqual([]);
  });

  test('não deve gravar nada Quando "Cancel"', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, EVENTO);
    const folha = await abrirFolha(page, tokenId, id);

    await folha.getByRole('button', { name: 'Cancel' }).click();

    await expect(folha).toBeHidden();
    expect(await lerRegras(request, tokenId)).toEqual([]);
  });
});

test.describe('Dado uma regra específica demais (E-03)', () => {
  test('deve avisar que só esta casaria entre ≥ 5 do mesmo caminho e afrouxar com "Loosen"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    for (const status of ['pendente', 'recusado', 'estornado', 'em análise', 'cancelado']) {
      await tokens.send(tokenId, {
        path: '/pagamentos',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ status }),
      });
    }
    const id = await tokens.send(tokenId, {
      path: '/pagamentos',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ status: 'pago' }),
    });
    const folha = await abrirFolha(page, tokenId, id);

    await expect(folha).toContainText('1 of the last 500 requests would match');
    await expect(folha).toContainText(
      'Too specific: only this request would match (of the last 500).',
    );
    await folha.getByRole('button', { name: 'Loosen' }).click();

    await expect(
      caixa(folha, new RegExp(`^Body \\$\\.status = ${valor('pago')}$`)),
    ).not.toBeChecked();
    await expect(folha).toContainText('6 of the last 500 requests would match');
    await expect(folha).not.toContainText('Too specific');
  });
});

test.describe('Dado uma mensagem com corpo que não é JSON (WM-31)', () => {
  test('deve oferecer o corpo inteiro como texto, desmarcado', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, {
      path: '/form',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'nome=Ana&idade=30',
    });
    const folha = await abrirFolha(page, tokenId, id);

    await expect(caixa(folha, /^Body equals the text \(10 KiB max\)$/)).not.toBeChecked();
    await expect(caixa(folha, /^Path \/form$/)).toBeChecked();
  });
});

test.describe('Dado "Test a variation" no detalhe da mensagem (WM-28)', () => {
  test('deve abrir o "Send as new…" apontado para a própria URL e caminho', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, EVENTO);
    await abrirMensagem(page, tokenId, id);

    await page.getByRole('button', { name: 'Test a variation' }).click();

    const envio = page.getByRole('region', { name: 'Send request' });
    await expect(envio.getByRole('textbox', { name: 'URL', exact: true })).toHaveValue(
      new RegExp(`/${tokenId}/pagamentos(\\?env=prod)?$`),
    );
    await expect(envio.getByRole('textbox', { name: 'Body' })).toHaveValue(EVENTO.data);
  });
});
