import { APIRequestContext, Locator, Page, Response } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { editor } from './support/regras';
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
      page.getByRole('table', { name: 'Rules' }).locator('td.name', { hasText: 'B' }),
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
    const linhaX = page
      .getByRole('table', { name: 'Rules' })
      .locator('tbody tr[data-rule-id]', { hasText: 'X' });
    await expect(linhaX).toBeVisible();
    await page.waitForLoadState('networkidle');

    const apagou = await gravarEsperando(page, tokenId, () =>
      linhaX.getByRole('button', { name: 'Delete', exact: true }).click(),
    );
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
