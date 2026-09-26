import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { seedStorage } from './support/storage';

// Checklist 8.

/** Linhas de uma tabela do detalhe, com as células separadas por espaço. */
const rows = (page: Page, table: string) =>
  page
    .getByRole('table', { name: table })
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) =>
        [...tr.querySelectorAll('td')]
          .map((td) => td.textContent?.replace(/\s+/g, ' ').trim())
          .join(' '),
      ),
    );

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
    const details = page.getByRole('table', { name: 'Request Details' });

    await expect(details).toContainText(requestId);
    const origin = new URL(page.url()).origin;
    expect(await rows(page, 'Request Details')).toEqual([
      `URL POST ${origin}/${tokenId}/extra/path?x=1&y=`,
      expect.stringMatching(/^Host \S+ whois$/),
      expect.stringMatching(
        /^Date [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM) \(a few seconds ago\)$/,
      ),
      `ID ${requestId}`,
    ]);
    expect(await rows(page, 'Headers')).toEqual(
      expect.arrayContaining([
        'x-custom abc',
        'user-agent e2e-agent',
        'content-type application/json',
      ]),
    );
    expect(await rows(page, 'Query strings')).toEqual(['x 1', 'y (empty)']);
    expect(await rows(page, 'Form values')).toEqual(['(empty)']);
  });

  test('deve mostrar o corpo cru e o formatado com destaque Quando "Format JSON/XML" alterna', async ({
    page,
  }) => {
    await expect(page.locator('pre')).toHaveText('{"a":12345678901234567890,"b":[1,2]}');

    await page.getByRole('switch', { name: 'Format JSON/XML' }).click();

    await expect(page.locator('pre')).toHaveText(
      '{\n  "a": 12345678901234567890,\n  "b": [\n    1,\n    2\n  ]\n}',
    );
    await expect(page.locator('pre .hljs-attr').first()).toHaveText('"a"');
  });

  test('deve apontar Permalink e Raw content para esta mensagem Quando o detalhe abre', async ({
    page,
    request,
  }) => {
    const origin = new URL(page.url()).origin;

    await expect(page.getByRole('link', { name: 'Permalink' })).toHaveAttribute(
      'href',
      `${origin}/#/${tokenId}/${requestId}/1`,
    );
    const raw = await page.getByRole('link', { name: 'Raw content' }).getAttribute('href');
    expect(await (await request.get(raw ?? '')).text()).toBe(
      '{"a":12345678901234567890,"b":[1,2]}',
    );
  });

  test('deve esconder as tabelas e manter o corpo Quando "Hide Details" é ligado', async ({
    page,
  }) => {
    await page.getByRole('switch', { name: 'Hide Details' }).click();

    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.locator('pre')).toBeVisible();
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
    await expect(page.locator('pre')).toHaveText('<a>\n  <b>1</b>\n  <c/>\n</a>');

    await page.goto(`/#/${tokenId}/${form}/1`);
    await expect(page.getByRole('table', { name: 'Form values' })).toContainText('f2');
    expect(await rows(page, 'Form values')).toEqual(['f1 v1', 'f2 (empty)']);

    await page.goto(`/#/${tokenId}/${vazia}/1`);
    await expect(page.getByText('(no body content)')).toBeVisible();
  });
});
