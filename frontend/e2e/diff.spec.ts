import { Locator, Page } from '@playwright/test';
import { Webhook, expect, test } from './support/fixtures';
import { abrirMensagem, detalhes, item } from './support/inbox';

// Diff entre duas mensagens (CA-6): "Compare with…" na mensagem aberta, escolha na lista, headers
// por nome sem diferenciar maiúsculas, corpo JSON canônico por linha, "Only differences", trocar
// A e B, fechar e o aviso de corpo acima de 1 MB. Não precisa do `requests/search`.
//
// Item 14, E8: o Compare vira rota (`#/{token}/compare/{a}/{b}`, com link compartilhável) e o corpo fica lado a
// lado (C §2.4). SUPOSIÇÕES (contrato da E8; o resto em compare-rota.spec.ts):
// - escolher a B na lista leva à rota; "Swap A and B" troca a ordem na rota; "Close" volta à Inbox com a A aberta;
// - a `table "Headers"` tem as colunas "Name", "A", "B" e "Status" e a situação por linha ("Same", "Changed", "Only
//   in A", "Only in B"; conferida sem caixa);
// - a `table "Body"` fica lado a lado (colunas A e B); com "Only differences", os trechos iguais recolhem numa linha
//   "⋯ N unchanged lines".

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
  // Item 14, E4: o item da lista e o detalhe mudam de forma (`support/inbox.ts`).
  await abrirMensagem(page, tokenId, requestId);
}

/** "Compare with…" na aberta e clique na B da lista; devolve a vista da comparação. */
async function compareWith(page: Page, a: string, b: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Compare with…' }).click();
  // Escopado: o chip "Live" do cabeçalho da URL (E3) também é `status`.
  await expect(page.getByRole('status').filter({ hasText: 'Choose a request' })).toContainText(
    `Choose a request to compare with #${a.substring(0, 5)}`,
  );
  await item(page, b).getByRole('button').first().click();
  await expect(page).toHaveURL(new RegExp(`#/[^/]+/compare/${a}/${b}$`));
  const view = page.getByRole('region', { name: 'Compare requests' });
  await expect(view).toBeVisible();
  return view;
}

/** A situação de um header na comparação ("same", "changed", "only in a", "only in b"). */
function situation(row: string[] | undefined): string | undefined {
  return row?.[3]?.toLowerCase();
}

/** Linhas da tabela `label` como [nome, A, B, situação] (o nome pode vir em `th`). */
async function fieldRows(view: Locator, label: string): Promise<string[][]> {
  return view
    .getByRole('table', { name: label })
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) =>
        [...row.querySelectorAll('th, td')].map((cell) => (cell as HTMLElement).innerText.trim()),
      ),
    );
}

function body(view: Locator): Locator {
  return view.getByRole('table', { name: 'Body' });
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

    const tabela = view.getByRole('table', { name: 'Headers' });
    for (const coluna of ['Name', 'A', 'B', 'Status']) {
      await expect(tabela.getByRole('columnheader', { name: coluna, exact: true })).toBeVisible();
    }
    const soDiferencas = view.getByRole('switch', { name: 'Only differences' });
    await soDiferencas.setChecked(false);
    const headers = await fieldRows(view, 'Headers');
    const x = (name: RegExp) => headers.find(([nome]) => name.test(nome));
    expect(x(/^x-retry$/i)?.slice(1, 3)).toEqual(['1', '2']);
    expect(situation(x(/^x-retry$/i))).toBe('changed');
    expect(x(/^x-only-a$/i)?.slice(1, 3)).toEqual(['a', '']);
    expect(situation(x(/^x-only-a$/i))).toBe('only in a');
    expect(x(/^x-only-b$/i)?.slice(1, 3)).toEqual(['', 'b']);
    expect(situation(x(/^x-only-b$/i))).toBe('only in b');
    expect(situation(x(/^content-type$/i))).toBe('same');
    expect(headers.filter(([name]) => /^x-retry$/i.test(name))).toHaveLength(1);

    await expect(view.getByText('JSON bodies, formatted with sorted keys.')).toBeVisible();
    await expect(body(view)).toContainText('"status": "pending"');
    await expect(body(view)).toContainText('"status": "paid"');
    await expect(body(view)).toContainText('"sku": "A1"');
    await screenshot(page, '01-diff-completo');

    await soDiferencas.setChecked(true);

    await expect(body(view)).not.toContainText('"sku": "A1"');
    await expect(body(view)).toContainText(/\d+ unchanged lines?/);
    await expect(body(view)).toContainText('"status": "pending"');
    expect((await fieldRows(view, 'Headers')).every((row) => situation(row) !== 'same')).toBe(true);
    // Fidelidade ao C, fase 2 (RULES-32): a tabela "Request" vira a seção "Request line" com a nota de iguais.
    await expect(
      view.locator('section', { has: page.getByRole('heading', { name: 'Request line' }) }),
    ).toContainText('method, path and query are the same');
    await screenshot(page, '02-diff-so-diferencas');

    await view.getByRole('button', { name: 'Swap A and B' }).click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/compare/${b}/${a}$`));
    const trocados = await fieldRows(view, 'Headers');
    expect(trocados.find(([nome]) => /^x-retry$/i.test(nome))?.slice(1, 3)).toEqual(['2', '1']);

    await view.getByRole('button', { name: 'Close' }).click();
    await expect(view).toBeHidden();
    await expect(detalhes(page)).toContainText(a);
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
    await expect(body(view)).not.toContainText('fim');
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
    await expect(detalhes(page)).toContainText(a);
  });
});
