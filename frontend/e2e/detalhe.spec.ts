import { expect, test } from './support/fixtures';
import { aba, abrirAba, acoes, corpo, detalhes, expectCorpo, linhas } from './support/inbox';
import { seedStorage } from './support/storage';

// Checklist 8. Item 14, E4: o detalhe ganha abas (Body, Headers (n), Query (n), Form (n)) no lugar de
// "Hide Details" (S13), o "Format JSON/XML" vira o `switch "Pretty"` (lendo `formatJsonEnable`), o JSON sai pelo
// tokenizer próprio (S5) e Permalink e Raw content vão para o menu "More" (`menuitem`, §1).
// SUPOSIÇÕES (além das de `support/inbox.ts`):
// - o menu é aberto pelo `button "More"` (exato) do cabeçalho do detalhe;
// - o cabeçalho do detalhe tem o selo do método e o `heading` com a rota (caminho e query depois do token); a linha
//   URL da "Request Details" não repete o método;
// - a aba Body é a aberta por padrão; o corpo realça cada chave JSON num elemento próprio (`span`).
// Fidelidade ao C (item 14.1, F1): a tabela "Request Details" vira a linha de metadados `group "Request metadata"`
// (INBOX-17, trava 3: URL como link, Host + whois, data absoluta, ID completo, e mais tamanho, seq e "Copy request
// ID"); o JSON nasce formatado quando `formatJsonEnable` não existe (INBOX-22, trava 9: a escolha salva continua
// valendo e o corpo cru fica a um clique, sem reformatar o número grande).

test.describe('Dado uma mensagem JSON com query e header próprio (checklist 8)', () => {
  let tokenId: string;
  let requestId: string;

  test.beforeEach(async ({ page, tokens }) => {
    tokenId = await tokens.create();
    requestId = await tokens.send(tokenId, {
      method: 'POST',
      path: '/extra/path?x=1&y=',
      headers: { 'content-type': 'application/json', 'x-custom': 'abc', 'user-agent': 'e2e-agent' },
      data: '{"a":12345678901234567890,"b":[1,2]}',
    });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/${requestId}/1`);
  });

  test('deve mostrar URL, método, IP, data, ID, headers e query Quando a mensagem é aberta', async ({
    page,
  }) => {
    await expect(detalhes(page)).toContainText(requestId);
    await expect(
      page.getByRole('heading', { name: '/extra/path?x=1&y=', exact: true }),
    ).toBeVisible();
    const origin = new URL(page.url()).origin;
    const meta = detalhes(page);
    await expect(meta.getByRole('link', { name: /\/extra\/path/ }).first()).toHaveAttribute(
      'href',
      `${origin}/${tokenId}/extra/path?x=1&y=`,
    );
    await expect(meta).toContainText(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    await expect(meta.getByRole('link', { name: 'whois' })).toBeVisible();
    await expect(meta).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM)/);
    await expect(meta).toContainText(/a few seconds ago|\d+ s ago/);
    await expect(meta).toContainText('36 B');
    await expect(meta).toContainText(/\bseq \d+/);
    await meta.getByRole('button', { name: 'Copy request ID' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(requestId);
    await expect(page.getByRole('table', { name: 'Request Details' })).toHaveCount(0);

    await abrirAba(page, 'Headers');
    expect(await linhas(page, 'Headers')).toEqual(
      expect.arrayContaining([
        'x-custom abc',
        'user-agent e2e-agent',
        'content-type application/json',
      ]),
    );
    await abrirAba(page, 'Query');
    await expect(aba(page, 'Query')).toHaveAccessibleName('Query (2)');
    expect(await linhas(page, 'Query strings')).toEqual(['x 1', 'y (empty)']);
    await abrirAba(page, 'Form');
    await expect(aba(page, 'Form')).toHaveAccessibleName('Form (0)');
    await expect(page.getByRole('table', { name: 'Form values' })).toHaveCount(0);
  });

  // Fidelidade ao C (INBOX-22): sem a chave `formatJsonEnable`, o JSON nasce formatado; o cru fica a um clique.
  test('deve mostrar o corpo formatado com destaque e o cru Quando "Pretty" alterna', async ({
    page,
  }) => {
    await expect(aba(page, 'Body')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('switch', { name: 'Pretty', exact: true })).toBeChecked();
    await expectCorpo(page, '{\n  "a": 12345678901234567890,\n  "b": [\n    1,\n    2\n  ]\n}');
    await expect(corpo(page).locator('span', { hasText: /^"a"$/ }).first()).toBeVisible();

    await page.getByRole('switch', { name: 'Pretty', exact: true }).click();

    await expectCorpo(page, '{"a":12345678901234567890,"b":[1,2]}');
    await expect(page.getByRole('switch', { name: 'Format JSON/XML' })).toHaveCount(0);
  });

  test('deve respeitar a escolha salva de ver o corpo cru (formatJsonEnable = false)', async ({
    page,
  }) => {
    await seedStorage(page, { formatJsonEnable: 'false' });
    await page.goto(`/#/${tokenId}/${requestId}/1`);

    await expect(page.getByRole('switch', { name: 'Pretty', exact: true })).not.toBeChecked();
    await expectCorpo(page, '{"a":12345678901234567890,"b":[1,2]}');
  });

  test('deve apontar Permalink e Raw content para esta mensagem Quando o menu "More" abre', async ({
    page,
    request,
  }) => {
    const origin = new URL(page.url()).origin;

    await page.getByRole('button', { name: 'More', exact: true }).click();

    await expect(page.getByRole('menuitem', { name: 'Permalink' })).toHaveAttribute(
      'href',
      `${origin}/#/${tokenId}/${requestId}/1`,
    );
    const raw = await page.getByRole('menuitem', { name: 'Raw content' }).getAttribute('href');
    expect(await (await request.get(raw ?? '')).text()).toBe(
      '{"a":12345678901234567890,"b":[1,2]}',
    );
  });

  test('deve mostrar só o corpo na aba Body e só os headers na aba Headers, sem "Hide Details"', async ({
    page,
  }) => {
    // Cenário trocado (S13): "Hide Details" sai; as abas separam o corpo das tabelas.
    await expect(page.getByRole('switch', { name: 'Hide Details' })).toHaveCount(0);
    await expect(corpo(page)).toBeVisible();
    await expect(page.getByRole('table', { name: 'Headers' })).toHaveCount(0);
    await expect(acoes(page)).toBeVisible();

    await abrirAba(page, 'Headers');

    await expect(page.getByRole('table', { name: 'Headers' })).toBeVisible();
    await expect(corpo(page)).toHaveCount(0);
  });
});

test.describe('Dado mensagens XML, formulário e sem corpo (checklist 8)', () => {
  test('deve formatar XML, listar o formulário e avisar corpo vazio Quando cada uma é aberta', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const xml = await tokens.send(tokenId, {
      method: 'PUT',
      headers: { 'content-type': 'application/xml' },
      data: '<a><b>1</b><c/></a>',
    });
    const form = await tokens.send(tokenId, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: 'f1=v1&f2=',
    });
    const vazia = await tokens.send(tokenId, { method: 'GET' });
    await seedStorage(page, { formatJsonEnable: 'true' });

    await page.goto(`/#/${tokenId}/${xml}/1`);
    await expect(page.getByRole('switch', { name: 'Pretty', exact: true })).toBeChecked();
    await expectCorpo(page, '<a>\n  <b>1</b>\n  <c/>\n</a>');

    await page.goto(`/#/${tokenId}/${form}/1`);
    await expect(aba(page, 'Form')).toHaveAccessibleName('Form (2)');
    await abrirAba(page, 'Form');
    expect(await linhas(page, 'Form values')).toEqual(['f1 v1', 'f2 (empty)']);

    await page.goto(`/#/${tokenId}/${vazia}/1`);
    await expect(page.getByText('(no body content)')).toBeVisible();
  });
});
