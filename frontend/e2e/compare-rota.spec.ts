import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import { Webhook, expect, test } from './support/fixtures';

// Item 14, E8: o Compare por rota (`#/{token}/compare/{a}/{b}`), com link compartilhável, os checks de A e B lado
// a lado e o que explica o desfecho contra o ruído por provedor (S9, só com sinais do servidor). SUPOSIÇÕES
// (contrato da E8, além das de diff.spec.ts):
// - a `region "Compare requests"` abre direto pela rota, também depois de recarregar;
// - `table "Checks"` com as linhas "Signature", "Schema" e "Answer" (`rowheader`; patamar, B2: era "Rule", e a
//   linha nova é conferida no patamar-b2.spec) e as colunas "A" e "B", com o
//   título de cada verificação ("Signature invalid", "Schema valid"…);
// - o que explica o desfecho fica numa seção com o heading "{N} change(s) explain(s) the outcome", um item por
//   causa, com o sinal do servidor (o `signature.reason`, o caminho de `schema.errors[].path`, a frase do
//   `near_miss.failed`);
// - header de ruído conhecido do provedor (`x-github-delivery`, `stripe-signature`, `x-slack-request-timestamp`,
//   `content-length`) fica marcado na linha da `table "Headers"` com "changes every event".

const SECRET = 'segredo-do-compare';

function github(secret: string, body: string, delivery: string): Webhook {
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Delivery': delivery,
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    data: body,
  };
}

function compare(page: Page): Locator {
  return page.getByRole('region', { name: 'Compare requests' });
}

/** A linha de uma verificação na `table "Checks"`: [A, B]. */
async function linhaDoCheck(view: Locator, nome: string): Promise<string[]> {
  const tabela = view.getByRole('table', { name: 'Checks' });
  await expect(tabela.getByRole('rowheader', { name: nome, exact: true })).toBeVisible();
  const linha = tabela
    .getByRole('row')
    .filter({ has: view.page().getByRole('rowheader', { name: nome, exact: true }) });
  return linha
    .getByRole('cell')
    .evaluateAll((celulas) => celulas.map((celula) => (celula as HTMLElement).innerText.trim()));
}

function explica(view: Locator): Locator {
  return view.locator('section, [role=region], [role=group]', {
    has: view.page().getByRole('heading', { name: /^\d+ changes? explains? the outcome$/ }),
  });
}

test.describe('Dado o link direto de uma comparação', () => {
  test('deve abrir A e B lado a lado pela rota, também depois de recarregar', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const a = await tokens.send(tokenId, { headers: { 'X-Lado': 'a' }, data: 'um' });
    const b = await tokens.send(tokenId, { headers: { 'X-Lado': 'b' }, data: 'dois' });

    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);

    const view = compare(page);
    await expect(view).toBeVisible();
    const headers = view.getByRole('table', { name: 'Headers' });
    await expect(headers.getByRole('columnheader', { name: 'A', exact: true })).toBeVisible();
    await expect(headers.getByRole('columnheader', { name: 'B', exact: true })).toBeVisible();
    await expect(headers.getByRole('columnheader', { name: 'Status', exact: true })).toBeVisible();
    await expect(headers.getByRole('row', { name: /^x-lado\b/i })).toContainText(/changed/i);

    await page.reload();
    await expect(compare(page)).toBeVisible();
    expect(page.url()).toContain(`/compare/${a}/${b}`);
  });
});

test.describe('Dado duas entregas com verificações diferentes (S9)', () => {
  test('deve mostrar os checks de A e B e explicar o desfecho pela assinatura, com o delivery como ruído', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const body = '{"action":"opened"}';
    const a = await tokens.send(tokenId, github('outro-segredo', body, 'entrega-a'));
    const b = await tokens.send(tokenId, github(SECRET, body, 'entrega-b'));

    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);

    const view = compare(page);
    const [assinaturaA, assinaturaB] = await linhaDoCheck(view, 'Signature');
    expect(assinaturaA).toMatch(/Signature invalid/);
    expect(assinaturaB).toMatch(/Signature valid/);
    await expect(explica(view)).toContainText('signature mismatch');
    await expect(
      view
        .getByRole('table', { name: 'Headers' })
        .getByRole('row', { name: /^x-github-delivery\b/i }),
    ).toContainText(/changes every event/i);
  });

  test('deve explicar o desfecho pelo caminho do erro de schema', async ({ page, tokens }) => {
    const tokenId = await tokens.create({
      schema: { type: 'object', properties: { valor: { type: 'integer' } } },
    });
    const json = { 'Content-Type': 'application/json' };
    const a = await tokens.send(tokenId, { headers: json, data: '{"valor":"10"}' });
    const b = await tokens.send(tokenId, { headers: json, data: '{"valor":10}' });

    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);

    const view = compare(page);
    const [schemaA, schemaB] = await linhaDoCheck(view, 'Schema');
    expect(schemaA).toMatch(/Schema invalid/);
    expect(schemaB).toMatch(/Schema valid/);
    await expect(explica(view)).toContainText('/valor');
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`Dado o Compare no tema ${colorScheme} a ${viewport.width}×${viewport.height} (axe, CA-2)`, () => {
      test.use({ colorScheme, viewport });

      test('deve passar no axe sem violação grave', async ({ page, tokens }) => {
        const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
        const a = await tokens.send(tokenId, github('outro-segredo', '{"n":1}', 'x-1'));
        const b = await tokens.send(tokenId, github(SECRET, '{"n":2}', 'x-2'));

        await page.goto(`/#/${tokenId}/compare/${a}/${b}`);
        await expect(compare(page)).toBeVisible();

        await expectSemViolacoesGraves(page, `Compare, ${colorScheme}, ${viewport.width} px`);
      });
    });
  }
}
