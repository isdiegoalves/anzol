import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { gravarRegras } from './support/regras';
import { seedStorage } from './support/storage';

// UX de Regras, fatia F9 — frases do servidor em pt-BR (WM-05; guia-ux §3.9; CA-12). Tabela no cliente: cada frase
// reconhecida do near miss, do trace, do teste e dos 422 vira pt-BR, com o original no `title` ("Original: …") e no
// `button "Show original"` (pt-BR "Ver original"); frase desconhecida fica em inglês, sem erro. A tela roda em pt-BR
// pela escolha guardada (`localStorage.language`), como no i18n.spec. SUPOSIÇÕES:
// - SUPOSIÇÃO: "Ver original" mostra as frases originais no mesmo bloco (as traduzidas podem ficar ou sair).
// - SUPOSIÇÃO: o 422 da visão JSON aparece no editor traduzido ("A regex é inválida."), com o original no `title`.

const PT = { language: '"pt-BR"' };

/** Abre a mensagem em pt-BR e o "Por quê? (n)" do near miss; devolve as frases. */
async function porQue(page: Page, tokenId: string, id: string, semear = true) {
  if (semear) {
    await seedStorage(page, PT);
  }
  await page.goto(`/#/${tokenId}/${id}/1`);
  await expect(page.getByRole('group', { name: 'Metadados da requisição' })).toContainText(id);
  await page.getByRole('button', { name: /^Por quê\? \(\d+\)$/ }).click();
  return page.getByRole('list', { name: /^Condições de .* que falharam$/ }).getByRole('listitem');
}

test.describe('Dado um near miss com a tela em pt-BR (WM-05; CA-12)', () => {
  test('deve traduzir método, cabeçalho e corpo, com o original no title e em "Ver original"', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      {
        name: 'Pix pago',
        match: {
          method: ['POST'],
          path: { equals: '/pagamentos' },
          headers: { 'X-Tenant': { equals: 'acme' } },
          body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
        },
        response: { status: 201 },
      },
    ]);
    const id = await tokens.send(tokenId, {
      method: 'GET',
      path: '/pagamentos',
      headers: { 'Content-Type': 'application/json', 'X-Tenant': 'outra' },
      data: '{"status":"pendente"}',
    });

    const frases = await porQue(page, tokenId, id);

    await expect(frases.filter({ hasText: 'método: esperava POST, veio GET' })).toHaveCount(1);
    await expect(
      frases.filter({ hasText: 'cabeçalho x-tenant: esperava "acme", veio "outra"' }),
    ).toHaveCount(1);
    const corpo = frases.filter({ hasText: 'corpo $.status: esperava "pago", veio "pendente"' });
    await expect(corpo).toHaveCount(1);
    await expect(
      corpo.locator('xpath=descendant-or-self::*[starts-with(@title, "Original: ")]').first(),
    ).toHaveAttribute('title', /^Original: body \$\.status: /);

    await page.getByRole('button', { name: 'Ver original' }).first().click();
    await expect(page.getByText(/header x-tenant: expected "acme", got "outra"/)).toBeVisible();
  });

  test('deve traduzir assinatura não configurada e o estado do cenário', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      {
        name: 'Entrega',
        match: { method: ['POST'], signature: 'valid' },
        scenario: { name: 'entrega', requiredState: 'falhou 1' },
        response: { status: 200 },
      },
    ]);
    const id = await tokens.send(tokenId, { method: 'GET' });

    const frases = await porQue(page, tokenId, id);

    await expect(frases.filter({ hasText: 'assinatura: não configurada nesta URL' })).toHaveCount(
      1,
    );
    await expect(
      frases.filter({
        hasText: 'cenário entrega: esperava o estado "falhou 1", estava em "Started"',
      }),
    ).toHaveCount(1);
  });

  test('deve deixar em inglês, sem erro, a frase que a tabela não conhece', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Pix', match: { method: ['POST'] }, response: { status: 201 } },
    ]);
    const id = await tokens.send(tokenId, { method: 'GET' });
    const desconhecida = 'frobnicate: a phrase no table knows';
    // Com uma rota ativa, a ida ao favicon.ico da semente é abortada: semeia antes.
    await seedStorage(page, PT);
    await page.route(new RegExp(`/token/${tokenId}/requests?(/|\\?|$)`), async (rota) => {
      const resposta = await rota.fetch();
      const texto = await resposta.text();
      const acrescentar = (no: unknown): void => {
        if (Array.isArray(no)) {
          no.forEach(acrescentar);
        } else if (no && typeof no === 'object') {
          const objeto = no as Record<string, unknown>;
          const quase = objeto['near_miss'] as { failed?: string[] } | null | undefined;
          if (quase?.failed) {
            quase.failed.push(desconhecida);
          }
          Object.values(objeto).forEach(acrescentar);
        }
      };
      let corpo: unknown;
      try {
        corpo = JSON.parse(texto);
      } catch {
        await rota.fulfill({ response: resposta });
        return;
      }
      acrescentar(corpo);
      await rota.fulfill({ response: resposta, json: corpo });
    });
    const erros: string[] = [];
    page.on('pageerror', (erro) => erros.push(erro.message));

    const frases = await porQue(page, tokenId, id, false);

    await expect(frases.filter({ hasText: desconhecida })).toHaveCount(1);
    await expect(frases.filter({ hasText: 'método: esperava POST, veio GET' })).toHaveCount(1);
    expect(erros).toEqual([]);
  });
});

test.describe('Dado o teste contra o histórico com a tela em pt-BR (WM-05)', () => {
  test('deve traduzir as frases de falha de cada mensagem', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    const [pix] = await gravarRegras(request, tokenId, [
      {
        name: 'Pix',
        match: { method: ['POST'], path: { equals: '/pagamentos' } },
        response: { status: 201 },
      },
    ]);
    await tokens.send(tokenId, { method: 'GET', path: '/outra' });
    await seedStorage(page, PT);
    await page.goto(`/#/${tokenId}/rules/${pix.id}`);

    await page.getByRole('button', { name: 'Testar contra o histórico' }).click();

    const resultado = page.getByRole('status', { name: 'Teste contra o histórico' });
    await expect(resultado).toContainText('método: esperava POST, veio GET');
    await expect(resultado).toContainText('caminho: esperava "/pagamentos", veio "/outra"');
  });
});

test.describe('Dado um 422 do servidor no editor em pt-BR (WM-05)', () => {
  test('deve traduzir "The regex is invalid." e manter o original à mão', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, PT);
    await page.goto(`/#/${tokenId}/rules/new`);
    const json = page.getByRole('textbox', { name: 'JSON da regra' });
    await page.getByRole('radio', { name: 'JSON', exact: true }).click();
    await json.fill(
      JSON.stringify({ name: 'Regex quebrada', match: { path: { regex: '([a-z' } } }),
    );

    await page.getByRole('button', { name: 'Salvar', exact: true }).click();

    const traduzida = page.getByText('A regex é inválida.');
    await expect(traduzida).toBeVisible();
    await expect(
      page.locator('[title*="Original: "]').filter({ hasText: 'A regex é inválida.' }),
    ).toHaveAttribute('title', /The regex is invalid\./);
  });
});
