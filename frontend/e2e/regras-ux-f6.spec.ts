import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { anuncios } from './support/inbox';
import {
  abrirRegra,
  abrirRegras,
  dialogo,
  editor,
  gravarRegras,
  lerRegras,
  linhaDaRegra,
  metodo,
  parte,
  snackbar,
  voltarALista,
} from './support/regras';

// UX de Regras, fatia F6 — cenários: assistente de sequência (WM-32, E-09, WM-33; guia-ux §3.6; CA-8). O modelo "Fail
// N times, then accept" e o `button "Sequence…"` da aba Scenario abrem o `dialog "Sequence"`, que monta as regras
// encadeadas numa tela; o grupo do cenário na lista ganha "Reset scenario" e o aviso de estado terminal; o estado
// atualiza sozinho. SUPOSIÇÕES:
// - SUPOSIÇÃO: o assistente usa os controles de F3 com os mesmos nomes (`group "Methods"`, `textbox "Path"`) e já vem
//   com 503 e 200; os testes não mexem nos status.
// - SUPOSIÇÃO: a prévia lista uma linha por regra com o nome gerado ("entrega 1/3"), o status e "(stays)" na última;
//   os estados gerados seguem o guia ("Started", "entrega 2", "entrega 3").
// - SUPOSIÇÃO: o teto de 100 desabilita "Create {n} rules".
// - SUPOSIÇÃO: a seta do diagrama é um `button` ou `link` com o nome "{method} {path} → {status}".

const CATCH_ALL = { name: 'Tudo o resto', priority: 9, response: { status: 404 } };

/**
 * Abre o `dialog "Sequence"` pelo "Sequence…" da aba Scenario de uma regra nova: o modelo "Fail N times, then
 * accept" abre o roteiro "Test a retry", não este diálogo.
 */
async function abrirSequencia(page: Page, tokenId: string): Promise<Locator> {
  await abrirRegras(page, tokenId);
  await page.getByRole('button', { name: 'New rule', exact: true }).click();
  const regra = editor(page);
  await parte(regra, 'Scenario');
  await regra.getByRole('button', { name: 'Sequence…' }).click();
  const assistente = dialogo(page, 'Sequence');
  await expect(assistente).toBeVisible();
  return assistente;
}

async function statusDe(page: Page, tokenId: string, n: number): Promise<number[]> {
  const lista: number[] = [];
  for (let i = 0; i < n; i++) {
    lista.push((await page.request.post(`/${tokenId}/entrega`)).status());
  }
  return lista;
}

test.describe('Dado o assistente "Fail N times, then accept" (WM-32, E-09; CA-8)', () => {
  test('deve montar "falhar 2× e depois 200" numa tela e criar as 3 regras encadeadas', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const assistente = await abrirSequencia(page, tokenId);

    await metodo(assistente, 'POST');
    await assistente.getByRole('textbox', { name: 'Path', exact: true }).fill('/entrega');
    await expect(assistente.getByRole('spinbutton', { name: 'Times' })).toHaveValue('2');
    await expect(assistente.getByRole('textbox', { name: 'Scenario name' })).toHaveValue('entrega');
    await expect(assistente).toContainText('3 rules will be created');
    for (const passo of ['entrega 1/3', 'entrega 2/3', 'entrega 3/3']) {
      await expect(assistente).toContainText(passo);
    }
    await expect(assistente).toContainText('(stays)');
    // CA-8: cabe numa tela, sem rolar.
    const caixa = await assistente.boundingBox();
    expect(caixa!.y + caixa!.height).toBeLessThanOrEqual(page.viewportSize()!.height);

    await assistente.getByRole('button', { name: 'Create 3 rules' }).click();

    await expect(assistente).toBeHidden();
    // No celular a folha da regra nova (por onde o diálogo foi aberto) cobre a lista: volta a ela.
    await voltarALista(page, editor(page));
    await expect(anuncios(page).filter({ hasText: /^3 rules created$/ })).toHaveCount(1);
    for (const nome of ['entrega 1/3', 'entrega 2/3', 'entrega 3/3']) {
      await expect(linhaDaRegra(page, nome)).toHaveClass(/\bjust-created\b/);
    }
    const regras = await lerRegras(request, tokenId);
    expect(regras.map((r) => [r.name, r['priority'], r['scenario']])).toEqual([
      [
        'entrega 1/3',
        5,
        expect.objectContaining({
          name: 'entrega',
          requiredState: 'Started',
          newState: 'entrega 2',
        }),
      ],
      [
        'entrega 2/3',
        5,
        expect.objectContaining({
          name: 'entrega',
          requiredState: 'entrega 2',
          newState: 'entrega 3',
        }),
      ],
      ['entrega 3/3', 5, expect.objectContaining({ name: 'entrega', requiredState: 'entrega 3' })],
    ]);
    expect((regras[2]['scenario'] as { newState?: string | null }).newState ?? null).toBeNull();
    expect(await statusDe(page, tokenId, 4)).toEqual([503, 503, 200, 200]);
  });

  test('deve pôr o Retry-After nas respostas que recusam Quando o campo é preenchido', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const assistente = await abrirSequencia(page, tokenId);
    await assistente.getByRole('textbox', { name: 'Path', exact: true }).fill('/entrega');
    const espera = assistente.getByRole('spinbutton', { name: 'Retry-After (s)' });
    await expect(espera).toHaveValue('');
    await expect(assistente).toContainText('Empty: no header.');

    await espera.fill('5');
    await assistente.getByRole('button', { name: 'Create 3 rules' }).click();

    await expect
      .poll(async () =>
        (await lerRegras(request, tokenId)).map(
          (r) => (r['response'] as { headers?: Record<string, string> }).headers?.['Retry-After'],
        ),
      )
      .toEqual(['5', '5', undefined]);
    const recusa = await request.post(`/${tokenId}/entrega`);
    expect(recusa.status()).toBe(503);
    expect(recusa.headers()['retry-after']).toBe('5');
  });

  test('deve pôr as regras antes da pega-tudo, com a prioridade dela', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [CATCH_ALL]);
    const assistente = await abrirSequencia(page, tokenId);
    await assistente.getByRole('textbox', { name: 'Path', exact: true }).fill('/entrega');

    await assistente.getByRole('button', { name: 'Create 3 rules' }).click();

    await expect
      .poll(async () => (await lerRegras(request, tokenId)).map((r) => [r.name, r['priority']]))
      .toEqual([
        ['entrega 1/3', 9],
        ['entrega 2/3', 9],
        ['entrega 3/3', 9],
        ['Tudo o resto', 9],
      ]);
    expect(await statusDe(page, tokenId, 3)).toEqual([503, 503, 200]);
  });

  test('deve avisar que entra num cenário existente e que passaria do teto de 100', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Já existe', priority: 1, scenario: { name: 'entrega', requiredState: 'Started' } },
      ...Array.from({ length: 97 }, (_, i) => ({ name: `R${i}`, priority: i + 2 })),
    ]);
    const assistente = await abrirSequencia(page, tokenId);

    await assistente.getByRole('textbox', { name: 'Path', exact: true }).fill('/entrega');

    await expect(assistente).toContainText('Joins the existing scenario "entrega"');
    await expect(assistente).toContainText('Would exceed 100 rules');
    await expect(assistente.getByRole('button', { name: 'Create 3 rules' })).toBeDisabled();
  });

  test('deve abrir o assistente também pelo "Sequence…" da aba Scenario', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    const regra = editor(page);
    await parte(regra, 'Scenario');

    await regra.getByRole('button', { name: 'Sequence…' }).click();

    await expect(dialogo(page, 'Sequence')).toBeVisible();
  });
});

test.describe('Dado um cenário na lista e no editor (WM-33, E-09)', () => {
  const FALHA = {
    name: 'Falha 1',
    priority: 1,
    match: { method: ['POST'], path: { equals: '/entrega' } },
    scenario: { name: 'entrega', requiredState: 'Started', newState: 'falhou-1' },
    response: { status: 503 },
  };

  test('deve avisar o estado terminal e voltar a Started pelo "Reset scenario" do grupo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [FALHA]);
    expect((await request.post(`/${tokenId}/entrega`)).status()).toBe(503);
    await abrirRegras(page, tokenId);

    const grupo = page.getByRole('table', { name: 'Rules' }).locator('tbody tr.scenario-group');
    await expect(grupo).toContainText('state: falhou-1');
    await expect(page.getByRole('table', { name: 'Rules' })).toContainText(
      'No enabled rule answers in state "falhou-1"; the next request falls to the default response.',
    );

    await grupo.getByRole('button', { name: 'Reset scenario' }).click();

    await expect(snackbar(page, 'Scenario entrega set to Started')).toBeVisible();
    await expect(grupo).toContainText('state: Started');
    expect((await request.post(`/${tokenId}/entrega`)).status()).toBe(503);
  });

  test('deve atualizar o estado do grupo sozinho quando chega uma requisição', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [FALHA]);
    await abrirRegras(page, tokenId);
    const grupo = page.getByRole('table', { name: 'Rules' }).locator('tbody tr.scenario-group');
    await expect(grupo).toContainText('state: Started');

    expect((await request.post(`/${tokenId}/entrega`)).status()).toBe(503);

    await expect(grupo).toContainText('state: falhou-1', { timeout: 8_000 });
  });

  test('deve apontar no editor o estado exigido que nenhuma regra produz', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      FALHA,
      { name: 'Errada', priority: 2, scenario: { name: 'entrega', requiredState: 'entregue' } },
    ]);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, 'Errada');
    await parte(regra, 'Scenario');

    await expect(
      regra
        .getByRole('note')
        .filter({ hasText: 'No rule leads to state "entregue" — probably a typo.' }),
    ).toBeVisible();
  });

  test('deve mostrar no diagrama "{method} {path} → {status}" e abrir a regra pela seta', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      FALHA,
      {
        name: 'Sucesso',
        priority: 2,
        match: { method: ['POST'], path: { equals: '/entrega' } },
        scenario: { name: 'entrega', requiredState: 'falhou-1' },
        response: { status: 200 },
      },
    ]);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, 'Sucesso');
    await parte(regra, 'Scenario');

    const seta = (nome: string) =>
      regra.getByRole('button', { name: nome }).or(regra.getByRole('link', { name: nome }));
    await expect(seta('POST /entrega → 200')).toBeVisible();
    await seta('POST /entrega → 503').click();

    await expect(editor(page, 'Edit rule Falha 1')).toBeVisible();
  });
});
