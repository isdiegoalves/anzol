import { APIRequestContext } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import { expect, test } from './support/fixtures';
import { anuncios } from './support/inbox';
import { abrirRegras, editor, novaRegra, parte } from './support/regras';

// Item 14, E6: o que a página de regras acrescenta e as specs de hoje não cobrem — a prévia que respeita a
// prioridade (S8), o retorno por condição (`near_miss.conditions` e o teste contra o histórico), os hits por
// `stats.rules` com a resposta padrão fixa no fim, a reordenação por teclado com anúncio (WCAG 2.5.7), o aviso de
// conflito e o axe no editor (CA-2). SUPOSIÇÕES em `support/regras.ts` e mais (combinadas com a fatia):
// - Test: `section` com o heading "With the rules before it", o texto "Based on the rule that answered at the
//   time; ignores scenario state." e itens "N would now get {status} from this rule" / "N still answered by
//   earlier rule {nome}";
// - Match: `.feedback[data-condition="match.method"|"match.path"|…]` com "Fails on N of M tested" / "Passes on all
//   M tested" depois de um teste; `.recorded[data-condition=…]` com "Missed here by N recorded requests" a partir
//   das mensagens gravadas com `near_miss` desta regra;
// - `#/{token}/rules/{id}` abre a `region "Edit rule {nome}"`.

async function putRules(api: APIRequestContext, tokenId: string, rules: object[]) {
  const response = await api.put(`/token/${tokenId}/rules`, { data: rules });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { id: string; name: string }[];
}

async function getRules(api: APIRequestContext, tokenId: string) {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as Record<string, unknown>[];
}

const PIX = {
  name: 'Pix',
  priority: 5,
  match: { method: ['POST'], path: { equals: '/pagamentos' } },
  response: { status: 201 },
};

test.describe('Dado o teste contra o histórico de uma regra nova (S8)', () => {
  test('deve dizer quem responderia agora, respeitando a regra de prioridade maior que respondeu na época', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await putRules(request, tokenId, [
      {
        name: 'Primeira',
        priority: 1,
        match: { path: { equals: '/x' } },
        response: { status: 201 },
      },
    ]);
    expect((await request.post(`/${tokenId}/x`)).status()).toBe(201);
    expect((await request.post(`/${tokenId}/y`)).status()).toBe(200);
    await abrirRegras(page, tokenId);

    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Nova');
    await parte(regra, 'Response');
    await regra.getByRole('spinbutton', { name: 'Status' }).fill('202');
    await regra.getByRole('button', { name: 'Test against history' }).click();

    await expect(regra.getByRole('tab', { name: 'Test', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const previa = regra.getByRole('region', { name: 'With the rules before it' }).or(
      regra.locator('section', {
        has: page.getByRole('heading', { name: 'With the rules before it' }),
      }),
    );
    await expect(previa).toContainText(
      'Based on the rule that answered at the time; ignores scenario state.',
    );
    await expect(previa.getByRole('listitem')).toHaveText([
      /^1 would now get 202 from this rule$/,
      /^1 still answered by earlier rule Primeira$/,
    ]);
    expect(await getRules(request, tokenId)).toHaveLength(1);
  });
});

test.describe('Dado uma regra salva com mensagens que chegaram perto (near miss)', () => {
  test('deve abrir pelo link direto e mostrar o retorno de cada condição, gravado e do teste', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const [{ id }] = await putRules(request, tokenId, [PIX]);
    await tokens.send(tokenId, { method: 'GET', path: '/pagamentos' });
    await tokens.send(tokenId, { method: 'GET', path: '/pagamentos' });
    await tokens.send(tokenId, { method: 'POST', path: '/pagamentos' });

    await page.goto(`/#/${tokenId}/rules/${id}`);
    const regra = editor(page, 'Edit rule Pix');
    await expect(regra).toBeVisible();
    await parte(regra, 'Match');
    await expect(regra.locator('.recorded[data-condition="match.method"]')).toContainText(
      'Missed here by 2 recorded requests',
    );

    await regra.getByRole('button', { name: 'Test against history' }).click();
    await expect(regra.getByRole('status', { name: 'History test' })).toBeVisible();
    await parte(regra, 'Match');

    await expect(regra.locator('.feedback[data-condition="match.method"]')).toHaveText(
      'Fails on 2 of 3 tested',
    );
    await expect(regra.locator('.feedback[data-condition="match.path"]')).toHaveText(
      'Passes on all 3 tested',
    );
  });

  test('deve mostrar os hits de cada regra e da resposta padrão, fixa no fim da lista', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await putRules(request, tokenId, [PIX]);
    await tokens.send(tokenId, { method: 'GET', path: '/pagamentos' });
    await tokens.send(tokenId, { method: 'GET', path: '/pagamentos' });
    await tokens.send(tokenId, { method: 'POST', path: '/pagamentos' });

    await abrirRegras(page, tokenId);

    const tabela = page.getByRole('table', { name: 'Rules' });
    const linha = tabela.locator('tbody tr[data-rule-id]', { hasText: 'Pix' });
    await expect(linha.locator('td.hits')).toContainText('Answered 1');
    await expect(linha.locator('td.hits')).toContainText(/2 near miss(es)?/);
    const padrao = tabela.locator('tfoot tr');
    await expect(padrao).toContainText('Default response');
    await expect(padrao.locator('td.hits')).toContainText('Answered 2');
    await expect(page.getByText(/^Hits over the last 3 requests kept\.$/)).toBeVisible();
  });
});

test.describe('Dado duas regras na lista', () => {
  test('deve subir a regra pela alça com a seta, anunciar a posição e responder por ela', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await putRules(request, tokenId, [
      { name: 'Primeira', priority: 1, response: { status: 201 } },
      { name: 'Segunda', priority: 5, response: { status: 202 } },
    ]);
    await abrirRegras(page, tokenId);

    await page.getByRole('button', { name: 'Reorder Segunda' }).focus();
    await page.keyboard.press('ArrowUp');

    await expect(
      anuncios(page).filter({ hasText: 'Segunda moved to position 1 of 2' }),
    ).toHaveCount(1);
    await expect
      .poll(async () => (await getRules(request, tokenId)).map((rule) => rule['name']))
      .toEqual(['Segunda', 'Primeira']);
    await expect.poll(async () => (await request.post(`/${tokenId}`)).status()).toBe(202);
  });

  test('deve avisar e não salvar Quando a lista mudou no servidor depois da leitura', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await putRules(request, tokenId, [{ name: 'Tudo', response: { status: 418 } }]);
    await abrirRegras(page, tokenId);
    await putRules(request, tokenId, [{ name: 'Outra', response: { status: 409 } }]);

    await page.getByRole('switch', { name: 'Enable rule Tudo' }).click();

    const aviso = page.getByRole('alert').filter({ hasText: 'The rules changed elsewhere' });
    await expect(aviso).toBeVisible();
    expect(await getRules(request, tokenId)).toEqual([
      expect.objectContaining({ name: 'Outra', enabled: true }),
    ]);
    await aviso.getByRole('button', { name: 'Reload' }).click();
    await expect(
      page.getByRole('table', { name: 'Rules' }).locator('td.name', { hasText: 'Outra' }),
    ).toBeVisible();
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`Dado o editor de regras no tema ${colorScheme} a ${viewport.width}×${viewport.height} (axe, CA-2)`, () => {
      test.use({ colorScheme, viewport });

      test('deve passar no axe sem violação grave nas abas Match e Response', async ({
        page,
        request,
        tokens,
      }) => {
        const tokenId = await tokens.create();
        await putRules(request, tokenId, [PIX]);
        await abrirRegras(page, tokenId);
        await expectSemViolacoesGraves(page, `Rules, ${colorScheme}, ${viewport.width} px`);

        const regra = await novaRegra(page);
        await parte(regra, 'Match');
        await expectSemViolacoesGraves(page, `editor Match, ${colorScheme}, ${viewport.width} px`);
        await parte(regra, 'Response');
        await expectSemViolacoesGraves(
          page,
          `editor Response, ${colorScheme}, ${viewport.width} px`,
        );
      });
    });
  }
}
