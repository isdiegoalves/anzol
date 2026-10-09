import { expect, test } from './support/fixtures';
import { abrirMensagem, item, mostrarLista, verificacoes } from './support/inbox';
import {
  abrirRegra,
  abrirRegras,
  editor,
  gravarRegras,
  linhaDaRegra,
  novaRegra,
  parte,
} from './support/regras';

// UX de Regras, fatia F7 — Entrada ↔ Regras e atualização ao vivo (WM-10, WM-38; guia-ux §3.7; CA-9 na parte do
// link). Da mensagem se chega à regra (link no cartão, no "Closest" e na prévia S8) e de volta ("Back to request");
// a lista de Regras atualiza acertos e estado sozinha, sem mexer no editor. SUPOSIÇÕES:
// - SUPOSIÇÃO: o "Default response" do cartão aparece quando a URL tem regras e nenhuma casou, como `link` para
//   `#/{token}/checks?section=response` (o mesmo destino do rodapé da lista, RULES-09).
// - SUPOSIÇÃO: "Back to request" volta à rota da mensagem (`#/{token}/{id}…`).

const PIX = {
  name: 'Pix pago',
  priority: 1,
  match: { method: ['POST'], path: { equals: '/pagamentos' } },
  response: { status: 201 },
};

test.describe('Dado uma mensagem respondida por regra (WM-10; CA-9)', () => {
  test('deve levar da mensagem à regra pelo nome no cartão e voltar com "Back to request"', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const [pix] = await gravarRegras(request, tokenId, [PIX]);
    const id = await tokens.send(tokenId, { path: '/pagamentos' });
    await abrirMensagem(page, tokenId, id);

    const link = verificacoes(page).getByRole('link', { name: 'Pix pago', exact: true });
    await expect(link).toHaveAttribute('href', new RegExp(`#/${tokenId}/rules/${pix.id}`));
    await link.click();

    const regra = editor(page, 'Edit rule Pix pago');
    await expect(regra).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`from-request=${id}`));
    await regra.getByRole('button', { name: 'Back to request' }).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${id}`));
    await expect(page.getByRole('group', { name: 'Request metadata' })).toContainText(id);
  });

  test('não deve pôr link dentro do item da lista da Entrada', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    const id = await tokens.send(tokenId, { path: '/pagamentos' });
    await abrirMensagem(page, tokenId, id);

    await expect(verificacoes(page).getByRole('link', { name: 'Pix pago' })).toBeVisible();
    // A 390 px a Entrada mostra um painel por vez: volta à lista antes de olhar o item.
    await mostrarLista(page);
    await expect(item(page, id)).toContainText('Pix pago');
    await expect(item(page, id).getByRole('link')).toHaveCount(0);
  });
});

test.describe('Dado uma mensagem que nenhuma regra respondeu (WM-10)', () => {
  test('deve ter o "Closest" e a "Default response" como links', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const [pix] = await gravarRegras(request, tokenId, [PIX]);
    const id = await tokens.send(tokenId, { method: 'GET', path: '/pagamentos' });
    await abrirMensagem(page, tokenId, id);

    await expect(verificacoes(page)).toContainText(/No rule matched\. The closest is “Pix pago”/);
    await expect(
      verificacoes(page).getByRole('link', { name: 'Pix pago', exact: true }),
    ).toHaveAttribute('href', new RegExp(`#/${tokenId}/rules/${pix.id}`));
    await expect(page.getByRole('link', { name: /^default response$/i })).toHaveAttribute(
      'href',
      new RegExp(`#/${tokenId}/checks\\?section=response`),
    );
  });
});

test.describe('Dado a prévia S8 do teste (WM-10)', () => {
  test('deve ter o nome da regra anterior como link', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    const [primeira] = await gravarRegras(request, tokenId, [
      {
        name: 'Primeira',
        priority: 1,
        match: { path: { equals: '/x' } },
        response: { status: 201 },
      },
    ]);
    await tokens.send(tokenId, { path: '/x' });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Nova');
    await regra.getByRole('button', { name: 'Test against history' }).click();

    await expect(regra.getByText(/1 still answered by earlier rule Primeira/)).toBeVisible();
    await expect(regra.getByRole('link', { name: 'Primeira', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`#/${tokenId}/rules/${primeira.id}`),
    );
  });
});

test.describe('Dado Regras aberta enquanto chegam requisições (WM-38)', () => {
  test('deve atualizar os acertos sozinha, sem recarregar', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await tokens.send(tokenId, { method: 'GET', path: '/outra' });
    await abrirRegras(page, tokenId);
    const acertos = linhaDaRegra(page, 'Pix pago').locator('.hits');
    await expect(acertos).toContainText('Answered 0 of the last 1');

    expect((await request.post(`/${tokenId}/pagamentos`)).status()).toBe(201);

    await expect(acertos).toContainText('Answered 1 of the last 2', { timeout: 8_000 });
  });

  test('não deve mexer no editor aberto quando os acertos atualizam', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, 'Pix pago');
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Pix editado');
    await parte(regra, 'Response');
    await regra.getByRole('spinbutton', { name: 'Status' }).fill('202');
    const stats = page.waitForResponse((r) => r.url().includes(`/token/${tokenId}/stats`), {
      timeout: 8_000,
    });

    expect((await request.post(`/${tokenId}/pagamentos`)).status()).toBe(201);
    await stats;

    await expect(regra.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Pix editado',
    );
    await expect(regra.getByRole('spinbutton', { name: 'Status' })).toHaveValue('202');
    await expect(regra.getByText('Unsaved changes')).toBeVisible();
  });
});
