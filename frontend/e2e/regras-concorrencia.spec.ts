import { APIRequestContext, Locator, Page, Response } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { editor, linhaDaRegra } from './support/regras';
import { seedStorage } from './support/storage';

// Item 14, E6 — refutação independente (CA-12), transformada em spec. `PUT /token/{id}/rules` troca a lista
// inteira (§3 item 6), então toda gravação da página confere antes se a lista do servidor mudou desde a leitura:
// o Save do editor (regra nova e regra existente) e o Undo do delete se comportam como o toggle e a reordenação,
// com o `alert` "The rules changed elsewhere…" e o "Reload", sem apagar a regra que outra aba (ou o CLI `webhook
// rules push`) acrescentou.
// SUPOSIÇÕES (seguem a implementação da E6): apagar mostra o snackbar "Rule deleted" com "Undo"; o Undo que
// encontra a lista mudada avisa com o mesmo `alert` ou devolve a regra sem perder a outra.

type Regra = Record<string, unknown>;

const regra = (name: string, extra: Regra = {}): Regra => ({
  name,
  enabled: true,
  priority: 5,
  match: { method: ['POST'] },
  response: { status: 201, headers: {}, body: '' },
  ...extra,
});

async function putRules(api: APIRequestContext, tokenId: string, rules: Regra[]): Promise<Regra[]> {
  const response = await api.put(`/token/${tokenId}/rules`, { data: rules });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Regra[];
}

async function nomes(api: APIRequestContext, tokenId: string): Promise<unknown[]> {
  return ((await (await api.get(`/token/${tokenId}/rules`)).json()) as Regra[]).map(
    (r) => r['name'],
  );
}

function conflito(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: 'The rules changed elsewhere' });
}

/**
 * Abre a rota e espera a página terminar de ler (lista, hits e editor): só depois disso a mudança "em outra aba"
 * acontece, como no uso real, sem espera fixa.
 */
async function abrir(
  page: Page,
  tokenId: string,
  rota: string,
  nomeDoEditor: string,
): Promise<Locator> {
  await seedStorage(page, {});
  await page.goto(`/#/${tokenId}/rules${rota}`);
  await expect(page.getByRole('table', { name: 'Rules' })).toContainText('A');
  const regiao = editor(page, nomeDoEditor as 'New rule');
  await expect(regiao).toBeVisible();
  await page.waitForLoadState('networkidle');
  return regiao;
}

/**
 * Fidelidade ao C (item 14.1, RULES-04): o "Delete" sai da linha e vai para o editor ("Delete rule"); a linha inteira
 * abre o editor.
 */
async function apagarPeloEditor(page: Page, nome: string): Promise<void> {
  await linhaDaRegra(page, nome).locator('td.item').getByRole('button').click();
  await editor(page, `Edit rule ${nome}`).getByRole('button', { name: 'Delete rule' }).click();
}

/** Clica e espera o `PUT /rules` responder ou o aviso de conflito aparecer. */
async function gravarEsperando(page: Page, tokenId: string, clicar: () => Promise<void>) {
  const put = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith(`/token/${tokenId}/rules`),
  );
  await clicar();
  return Promise.race<Response | null>([
    put,
    conflito(page)
      .waitFor()
      .then(() => null),
  ]);
}

test.describe('Dado outra aba que acrescenta a regra B com o editor aberto', () => {
  test('deve avisar "changed elsewhere" e não apagar B Quando o editor de regra nova salva', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await putRules(request, tokenId, [regra('A')]);
    const nova = await abrir(page, tokenId, '/new', 'New rule');
    await nova.getByRole('textbox', { name: 'Name', exact: true }).fill('C');

    await putRules(request, tokenId, [regra('A'), regra('B')]);
    await gravarEsperando(page, tokenId, () =>
      nova.getByRole('button', { name: 'Save', exact: true }).click(),
    );

    expect(await nomes(request, tokenId), 'a regra B da outra aba continua').toEqual(['A', 'B']);
    await expect(conflito(page)).toBeVisible();
    await conflito(page).getByRole('button', { name: 'Reload' }).click();
    await expect(
      page.getByRole('table', { name: 'Rules' }).locator('.name', { hasText: 'B' }),
    ).toBeVisible();
  });

  test('deve avisar "changed elsewhere" e não apagar B Quando o editor de regra existente salva', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const [a] = await putRules(request, tokenId, [regra('A')]);
    const edicao = await abrir(page, tokenId, `/${String(a['id'])}`, 'Edit rule A');
    await edicao.getByRole('textbox', { name: 'Name', exact: true }).fill('A2');

    await putRules(request, tokenId, [a, regra('B')]);
    await gravarEsperando(page, tokenId, () =>
      edicao.getByRole('button', { name: 'Save', exact: true }).click(),
    );

    expect(await nomes(request, tokenId), 'a regra B da outra aba continua').toEqual(['A', 'B']);
    await expect(conflito(page)).toBeVisible();
  });
});

test.describe('Dado uma regra apagada e outra aba que acrescenta B antes do Undo', () => {
  test('não deve apagar B Quando "Undo" devolve a regra apagada', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await putRules(request, tokenId, [regra('A'), regra('X')]);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/rules`);
    const linhaX = linhaDaRegra(page, 'X');
    await expect(linhaX).toBeVisible();
    await page.waitForLoadState('networkidle');

    const apagou = await gravarEsperando(page, tokenId, () => apagarPeloEditor(page, 'X'));
    expect(apagou?.status()).toBe(200);
    await expect(page.getByText('Rule deleted')).toBeVisible();
    expect(await nomes(request, tokenId)).toEqual(['A']);

    await putRules(request, tokenId, [
      ...((await (await request.get(`/token/${tokenId}/rules`)).json()) as Regra[]),
      regra('B'),
    ]);
    const desfez = await gravarEsperando(page, tokenId, () =>
      page.getByRole('button', { name: 'Undo', exact: true }).click(),
    );

    const depois = await nomes(request, tokenId);
    expect(depois, 'a regra B da outra aba continua').toContain('B');
    if (desfez) {
      expect(desfez.status()).toBe(200);
      expect(depois).toEqual(expect.arrayContaining(['A', 'B', 'X']));
    } else {
      await expect(conflito(page)).toBeVisible();
    }
  });
});

// Reauditoria CA-12 sobre 35ba5f2: o que acontece depois do "Reload" do aviso de conflito.
// SUPOSIÇÃO (segue a implementação da E6): a regra aberta no editor que sumiu do servidor (a lista foi reimportada
// com ids novos) é avisada pelo `alert` "This rule no longer exists"; salvar então a insere como nova, uma vez só.

/** Clica em Save e espera o desfecho: o editor fechar (gravou) ou um `alert` aparecer. */
async function salvarEditor(page: Page, regiao: Locator): Promise<void> {
  await regiao.getByRole('button', { name: 'Save', exact: true }).click();
  await Promise.race([
    regiao.waitFor({ state: 'hidden' }),
    page
      .getByRole('alert')
      .filter({ hasText: /changed elsewhere|no longer exists/ })
      .waitFor(),
  ]);
}

test.describe('Dado o aviso "changed elsewhere" no editor, o Reload e um novo Save', () => {
  test('não deve duplicar a regra editada Quando outra aba reimportou a lista com ids novos', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const [a, b] = await putRules(request, tokenId, [regra('A'), regra('B')]);
    const edicao = await abrir(page, tokenId, `/${String(b['id'])}`, 'Edit rule B');
    await edicao.getByRole('textbox', { name: 'Name', exact: true }).fill('B2');
    // Import em outra aba: as mesmas regras sem id; o servidor dá ids novos.
    const semId = (r: Regra): Regra =>
      Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id'));
    await putRules(request, tokenId, [semId(a), semId(b)]);
    await salvarEditor(page, edicao);
    await expect(conflito(page)).toBeVisible();
    await conflito(page).getByRole('button', { name: 'Reload' }).click();
    await expect(conflito(page)).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    // O aviso de que a regra aberta sumiu da lista, se houver, já está na tela antes do segundo Save.
    const avisou = await page
      .getByRole('alert')
      .filter({ hasText: 'no longer exists' })
      .isVisible();

    const gravou = await gravarEsperando(page, tokenId, () =>
      edicao.getByRole('button', { name: 'Save', exact: true }).click(),
    );

    expect(gravou?.status(), 'o segundo Save grava').toBe(200);
    await expect(edicao).toBeHidden();
    const depois = await nomes(request, tokenId);
    expect(
      depois.filter((nome) => nome === 'B2'),
      'B2 uma vez só',
    ).toHaveLength(1);
    // Com o aviso, B2 entra como nova e B (reimportada) fica intacta; sem ele, B vira B2.
    expect(depois).toEqual(avisou ? ['A', 'B', 'B2'] : ['A', 'B2']);
  });

  test('deve manter a prioridade 1 que outra aba deu à regra em edição', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const [a, b] = await putRules(request, tokenId, [regra('A'), regra('B')]);
    const edicao = await abrir(page, tokenId, `/${String(b['id'])}`, 'Edit rule B');
    await edicao.getByRole('textbox', { name: 'Name', exact: true }).fill('B2');
    await putRules(request, tokenId, [{ ...b, priority: 1 }, a]);
    await salvarEditor(page, edicao);
    await expect(conflito(page)).toBeVisible();
    await conflito(page).getByRole('button', { name: 'Reload' }).click();

    await salvarEditor(page, edicao);

    const depois = ((await (await request.get(`/token/${tokenId}/rules`)).json()) as Regra[]).map(
      (r) => [r['name'], r['priority']],
    );
    expect(depois).toEqual([
      ['B2', 1],
      ['A', 5],
    ]);
  });
});

test.describe('Dado uma regra apagada, outra aba que acrescenta B, o aviso e o Reload antes do Undo', () => {
  test('deve devolver a regra apagada e manter B Quando "Undo" é clicado depois do Reload', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await putRules(request, tokenId, [regra('A'), regra('X')]);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/rules`);
    const tabela = page.getByRole('table', { name: 'Rules' });
    const linhaX = linhaDaRegra(page, 'X');
    await expect(linhaX).toBeVisible();
    await page.waitForLoadState('networkidle');

    const apagou = await gravarEsperando(page, tokenId, () => apagarPeloEditor(page, 'X'));
    expect(apagou?.status()).toBe(200);
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeVisible();
    await putRules(request, tokenId, [
      ...((await (await request.get(`/token/${tokenId}/rules`)).json()) as Regra[]),
      regra('B'),
    ]);
    await page.getByRole('switch', { name: 'Enable rule A' }).click();
    await expect(conflito(page)).toBeVisible();
    await conflito(page).getByRole('button', { name: 'Reload' }).click();
    await expect(tabela.locator('.name', { hasText: 'B' })).toBeVisible();

    const desfez = await gravarEsperando(page, tokenId, () => undo.click());

    expect(desfez?.status(), 'o Undo grava').toBe(200);
    const depois = await nomes(request, tokenId);
    expect(depois, 'B continua e X volta').toEqual(expect.arrayContaining(['A', 'B', 'X']));
    expect(depois).toHaveLength(3);
  });
});
