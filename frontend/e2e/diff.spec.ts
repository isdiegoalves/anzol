import { Locator, Page } from '@playwright/test';
import { Webhook, expect, test } from './support/fixtures';

// Diff entre duas mensagens (CA-6): "Compare with…" na mensagem aberta, escolha na lista, headers
// por nome sem diferenciar maiúsculas, corpo JSON canônico por linha, "Only differences", trocar
// A e B, fechar e o aviso de corpo acima de 1 MB. Não precisa do `requests/search`.

const SCREENS = process.env['SCREENS_DIR'];

async function screenshot(page: Page, name: string) {
  if (SCREENS) {
    await page.screenshot({ path: `${SCREENS}/${name}.png`, animations: 'disabled' });
  }
}

function json(body: string, headers: Record<string, string> = {}): Webhook {
  return { headers: { 'Content-Type': 'application/json', ...headers }, data: body };
}

async function openRequest(page: Page, tokenId: string, requestId: string) {
  await page.goto(`/#/${tokenId}/${requestId}/1`);
  await expect(page.locator('.req-id')).toHaveText(requestId);
}

/** "Compare with…" na aberta e clique na B da lista; devolve a vista da comparação. */
async function compareWith(page: Page, a: string, b: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Compare with…' }).click();
  // Escopado: o chip "Live" do cabeçalho da URL (E3) também é `status`.
  await expect(page.getByRole('status').filter({ hasText: 'Choose a request' })).toContainText(
    `Choose a request to compare with #${a.substring(0, 5)}`,
  );
  await page
    .locator('.item')
    .filter({ hasText: `#${b.substring(0, 5)}` })
    .click();
  const view = page.getByRole('region', { name: 'Compare requests' });
  await expect(view).toBeVisible();
  return view;
}

/** Linhas da tabela `label` como [nome, A, B, situação]. */
async function fieldRows(view: Locator, label: string): Promise<string[][]> {
  return view
    .getByRole('table', { name: label })
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.innerText.trim())),
    );
}

function bodyRows(view: Locator, kind: 'added' | 'removed' | 'equal' | 'skipped'): Locator {
  return view.getByRole('table', { name: 'Body' }).locator(`tr.${kind}`);
}

test.describe('Dado duas entregas do mesmo evento', () => {
  test('deve mostrar headers diferentes e ausentes e só a linha do JSON que mudou, ignorando a ordem das chaves', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const a = await tokens.send(
      tokenId,
      json('{"id":42,"status":"pending","itens":[{"sku":"A1","qtd":1}]}', {
        'X-Retry': '1',
        'X-Only-A': 'a',
      }),
    );
    const b = await tokens.send(
      tokenId,
      json('{"itens":[{"qtd":1,"sku":"A1"}],"status":"paid","id":42}', {
        'x-retry': '2',
        'X-Only-B': 'b',
      }),
    );
    await openRequest(page, tokenId, a);

    const view = await compareWith(page, a, b);

    await expect(view.locator('.id-a')).toHaveText(`#${a.substring(0, 5)}`);
    await expect(view.locator('.id-b')).toHaveText(`#${b.substring(0, 5)}`);
    const headers = await fieldRows(view, 'Headers');
    expect(headers.find(([name]) => /^x-retry$/i.test(name))?.slice(1)).toEqual([
      '1',
      '2',
      'changed',
    ]);
    expect(headers.find(([name]) => /^x-only-a$/i.test(name))?.slice(1)).toEqual([
      'a',
      '',
      'only in A',
    ]);
    expect(headers.find(([name]) => /^x-only-b$/i.test(name))?.slice(1)).toEqual([
      '',
      'b',
      'only in B',
    ]);
    expect(headers.find(([name]) => /^content-type$/i.test(name))?.[3]).toBe('same');
    expect(headers.filter(([name]) => /^x-retry$/i.test(name))).toHaveLength(1);

    await expect(view.getByText('JSON bodies, formatted with sorted keys.')).toBeVisible();
    await expect(bodyRows(view, 'removed')).toHaveText([/-\s*"status": "pending"$/]);
    await expect(bodyRows(view, 'added')).toHaveText([/\+\s*"status": "paid"$/]);
    await screenshot(page, '01-diff-completo');

    await view.getByRole('switch', { name: 'Only differences' }).click();

    await expect(bodyRows(view, 'equal')).toHaveCount(0);
    await expect(bodyRows(view, 'skipped')).not.toHaveCount(0);
    await expect(bodyRows(view, 'removed')).toHaveCount(1);
    expect(
      (await fieldRows(view, 'Headers')).every(([, , , situation]) => situation !== 'same'),
    ).toBe(true);
    await expect(view.getByRole('table', { name: 'Request' })).toContainText('No differences');
    await screenshot(page, '02-diff-so-diferencas');

    await view.getByRole('button', { name: 'Swap A and B' }).click();

    await expect(view.locator('.id-a')).toHaveText(`#${b.substring(0, 5)}`);
    await expect(bodyRows(view, 'removed')).toHaveText([/-\s*"status": "paid"$/]);
    await expect(bodyRows(view, 'added')).toHaveText([/\+\s*"status": "pending"$/]);

    await view.getByRole('button', { name: 'Close' }).click();
    await expect(view).toBeHidden();
    await expect(page.locator('.req-id')).toHaveText(a);
  });

  test('deve avisar e comparar só o primeiro 1 MB Quando um corpo passa do limite', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const grande = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'text/plain' },
      // Abaixo do teto de 1 MiB do servidor e acima do 1.000.000 de caracteres do diff.
      data: `${'x'.repeat(1_040_000)}\nfim`,
    });
    const pequena = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'text/plain' },
      data: 'x',
    });
    await openRequest(page, tokenId, pequena);

    const view = await compareWith(page, pequena, grande);

    await expect(view.getByRole('alert')).toHaveText(
      'Body larger than 1 MB: comparing only the first 1 MB of each request.',
    );
    await expect(view.getByRole('table', { name: 'Body' })).not.toContainText('fim');
  });

  test('deve sair do modo de escolha sem comparar Quando "Cancel" é clicado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const a = await tokens.send(tokenId, { data: 'a' });
    await tokens.send(tokenId, { data: 'b' });
    await openRequest(page, tokenId, a);

    await page.getByRole('button', { name: 'Compare with…' }).click();
    await page.getByRole('status').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText(/Choose a request to compare with/)).toBeHidden();
    await expect(page.getByRole('region', { name: 'Compare requests' })).toHaveCount(0);
    await expect(page.locator('.req-id')).toHaveText(a);
  });
});
