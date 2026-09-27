import { APIRequestContext, Locator, Page } from '@playwright/test';
import { TokenTracker, expect, test } from './support/fixtures';
import {
  abrirRegra,
  abrirRegras,
  celular,
  editor,
  linhaDaRegra,
  novaRegra,
  parte,
} from './support/regras';

// Item 14.1, fatia F3 (fidelidade ao protótipo C): Rules. Cada teste cobre um item de
// `.docs-arquivo/fidelidade-prototipo/desvios.json` (decisão "corrigir") e respeita as Travas do 00-STATUS (trava 8:
// a alça, o switch e "Move up"/"Move down" ficam). Nomes combinados com a fatia (front-rules); os da lista e do
// editor estão em `support/regras.ts`. SUPOSIÇÕES a mais:
// - RULES-02: `.match` junta todas as condições com " · " (método e caminho, header, corpo, "signature valid",
//   "schema invalid"); sem condição, "any request";
// - RULES-07: regras seguidas do mesmo cenário ganham antes delas a linha `tr.scenario-group` com
//   `th[scope=rowgroup]` 'Scenario "{nome}"' e o chip "state: {estado atual}"; o `.hits` da regra começa pela
//   transição ("Started → falhou-1 · Answered …");
// - RULES-09: a resposta padrão no `tfoot` é um `link` "Default response" para `#/{token}/checks?section=response`,
//   com "When no rule matches · {content type} · no delay";
// - RULES-10/11: com uma regra aberta, `separator "Resize rule list and editor"` (lista de 440 px, chave
//   `rulesListWidth` no localStorage); a lista continua mostrando `.match` e `.hits`;
// - RULES-13: "Delete rule" apaga a regra salva, fecha o editor e mostra "Rule deleted" com "Undo";
// - RULES-17: ao lado do segmentado de assinatura, "Recorded on arrival · {Provedor}" e o `link` "Set up in Checks";
//   sem verificação na URL, "not set up";
// - RULES-18: `.feedback[data-condition]` com `.passes` "Passes N/M", `.fails` "Fails on N/M" e `.none` "No
//   condition" (seção vazia);
// - RULES-19: `complementary "Against history"` na aba Match: "Not tested yet" antes do teste; depois, o número
//   grande + "of the M most recent would match", "Closest misses" (#id e "1 condition"), "Test again" e "All
//   results" (vai à aba Test);
// - RULES-20: na aba Test, `heading "Would match (N)"` com `link "Open request {uuid}"`; `heading "Would not match
//   (N)"` com `button "Closest first"` (aria-pressed, ligado por padrão) e uma linha `.misses > li` por mensagem, com
//   "N condition(s)", a classe `.near` quando só uma condição falha e as frases no `ul.failed`;
// - RULES-24: a aba Scenario tem a seção com o heading "Scenarios on this URL", "Refresh", "Reset all" (o texto pode
//   ser "Reset all to Started"), o diagrama `img` "{cenário}: Started, then falhou-1 (current)…", "then {status}
//   while in {estado}" para a regra que não muda o estado, e, na linha do cenário da `table "Scenarios"`, o
//   `combobox "New state of {cenário}"` e o `button "Set state"` (fase 2, RULES-12: os nomes do regras-fase-b; antes
//   `combobox "Set state of {cenário}"` + `button "Set"`);
// - RULES-27 (390 px): a lista cabe na largura sem rolagem horizontal interna.

async function putRules(api: APIRequestContext, tokenId: string, rules: object[]): Promise<void> {
  const response = await api.put(`/token/${tokenId}/rules`, { data: rules });
  expect(response.status(), await response.text()).toBe(200);
}

async function getRules(api: APIRequestContext, tokenId: string) {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as { name: string }[];
}

const REGRAS = [
  {
    name: 'Pix pago',
    priority: 1,
    match: { method: ['POST'], path: { equals: '/pagamentos' }, signature: 'valid' },
    response: { status: 201 },
  },
  {
    name: 'Rejeita',
    priority: 2,
    match: { signature: 'invalid', schema: 'invalid' },
    response: { status: 401 },
  },
  {
    name: 'Falha 1',
    priority: 3,
    scenario: { name: 'entrega', requiredState: 'Started', newState: 'falhou-1' },
    response: { status: 503 },
  },
  {
    name: 'Sucesso',
    priority: 4,
    scenario: { name: 'entrega', requiredState: 'falhou-1' },
    response: { status: 200 },
  },
];

/** URL com as quatro regras e uma mensagem, que a "Falha 1" respondeu (o cenário fica em "falhou-1"). */
async function urlComRegras(request: APIRequestContext, tokens: TokenTracker): Promise<string> {
  const tokenId = await tokens.create();
  await putRules(request, tokenId, REGRAS);
  expect((await request.post(`/${tokenId}/entrega`)).status()).toBe(503);
  return tokenId;
}

/** Botão que ocupa a linha e abre o editor (RULES-01/04). */
function botaoDaRegra(page: Page, nome: string): Locator {
  return linhaDaRegra(page, nome).locator('td.item').getByRole('button');
}

test.describe('Dado a lista de regras (RULES-01/02/03/04)', () => {
  test('deve mostrar cada regra como item de três linhas, sem Edit/Delete na linha, e abrir o editor pelo item', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await urlComRegras(request, tokens);
    await abrirRegras(page, tokenId);

    const pix = linhaDaRegra(page, 'Pix pago');
    await expect(pix.locator('.priority')).toHaveText('P1');
    await expect(pix.locator('.name')).toHaveText('Pix pago');
    await expect(pix.locator('app-status-code.status')).toContainText('201');
    await expect(pix.locator('.match')).toHaveText('POST /pagamentos · signature valid');
    // UX de Regras, E-11 (guia §3.2): a regra exige assinatura numa URL que não verifica; a linha 3 diz por que ela
    // nunca casa, no lugar dos acertos. Os acertos seguem cobertos na "Sucesso" abaixo e no RULES-07.
    await expect(pix.locator('.flag', { hasText: 'Never matches' })).toBeVisible();
    await expect(
      page
        .getByRole('table', { name: 'Rules' })
        .getByText('This URL does not check signatures.')
        .first(),
    ).toBeVisible();
    await expect(linhaDaRegra(page, 'Sucesso').locator('.hits')).toContainText(
      /Answered 0 of the last \d+/,
    );
    await expect(linhaDaRegra(page, 'Rejeita').locator('.match')).toHaveText(
      'signature invalid · schema invalid',
    );
    await expect(linhaDaRegra(page, 'Rejeita').locator('app-status-code.status')).toContainText(
      '401',
    );

    // Trava 8: a alça, o switch e as setas continuam; Edit e Delete saem da linha.
    await expect(pix.getByRole('button', { name: 'Reorder Pix pago' })).toBeVisible();
    await expect(pix.getByRole('switch', { name: 'Enable rule Pix pago' })).toBeVisible();
    await expect(pix.getByRole('button', { name: 'Move down' })).toBeVisible();
    await expect(pix.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(pix.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);

    await botaoDaRegra(page, 'Pix pago').click();
    await expect(editor(page, 'Edit rule Pix pago')).toBeVisible();
    // UX de Regras, F8: no celular o editor é folha de tela cheia e a lista (com o aria-current) fica por baixo.
    if (celular(page)) {
      return;
    }
    await expect(botaoDaRegra(page, 'Pix pago')).toHaveAttribute('aria-current', 'true');
    await expect(botaoDaRegra(page, 'Rejeita')).not.toHaveAttribute('aria-current', 'true');
  });
});

test.describe('Dado regras de um mesmo cenário (RULES-07)', () => {
  test('deve agrupá-las sob o cabeçalho do cenário com o estado atual e mostrar a transição de cada uma', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await urlComRegras(request, tokens);
    await abrirRegras(page, tokenId);

    const grupo = page.getByRole('table', { name: 'Rules' }).locator('tbody tr.scenario-group');
    await expect(grupo).toHaveCount(1);
    await expect(grupo.locator('th[scope="rowgroup"]')).toContainText('Scenario "entrega"');
    await expect(grupo).toContainText('state: falhou-1');

    const linhas = page.getByRole('table', { name: 'Rules' }).locator('tbody tr');
    const ordem = await linhas.evaluateAll((trs) =>
      trs.map((tr) =>
        tr.classList.contains('scenario-group')
          ? 'grupo'
          : (tr.querySelector('.name')?.textContent?.trim() ?? ''),
      ),
    );
    expect(ordem.indexOf('grupo')).toBe(ordem.indexOf('Falha 1') - 1);
    expect(ordem.indexOf('Sucesso')).toBe(ordem.indexOf('Falha 1') + 1);

    await expect(linhaDaRegra(page, 'Falha 1').locator('.hits')).toHaveText(
      /^Started → falhou-1 · Answered 1 of the last \d+/,
    );
  });
});

test.describe('Dado a resposta padrão no fim da lista (RULES-09)', () => {
  test('deve ser um link para Checks › Response com o content type e o atraso', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await urlComRegras(request, tokens);
    await abrirRegras(page, tokenId);

    const padrao = page
      .getByRole('table', { name: 'Rules' })
      .locator('tfoot')
      .getByRole('link', { name: /Default response/ });
    await expect(padrao).toHaveAttribute('href', `#/${tokenId}/checks?section=response`);
    await expect(padrao).toContainText(/When no rule matches · [\w.+-]+\/[\w.+-]+ · no delay/);
    await padrao.click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/checks\\?section=response$`));
  });
});

test.describe('Dado uma regra aberta ao lado da lista (RULES-10/11)', () => {
  test('deve ter a lista de 440 px com separador ajustável e lembrado, sem esconder match e hits', async ({
    page,
    request,
    tokens,
  }) => {
    test.skip(celular(page), 'desktop: lista e editor lado a lado (F8)');
    const tokenId = await urlComRegras(request, tokens);
    await abrirRegras(page, tokenId);
    await abrirRegra(page, 'Pix pago');

    const separador = page.getByRole('separator', { name: 'Resize rule list and editor' });
    await expect(separador).toBeVisible();
    const tabela = await page.getByRole('table', { name: 'Rules' }).boundingBox();
    const caixa = await separador.boundingBox();
    expect(caixa!.x - tabela!.x).toBeGreaterThan(400);
    expect(caixa!.x - tabela!.x).toBeLessThan(480);

    const pix = linhaDaRegra(page, 'Pix pago');
    await expect(pix.locator('.match')).toBeVisible();
    await expect(pix.locator('.hits')).toBeVisible();

    const antes = Number(await separador.getAttribute('aria-valuenow'));
    await separador.focus();
    await page.keyboard.press('ArrowRight');
    await expect(separador).not.toHaveAttribute('aria-valuenow', String(antes));
    const depois = await separador.getAttribute('aria-valuenow');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('rulesListWidth')))
      .not.toBeNull();

    await page.reload();
    await abrirRegra(page, 'Pix pago');
    await expect(
      page.getByRole('separator', { name: 'Resize rule list and editor' }),
    ).toHaveAttribute('aria-valuenow', depois!);
  });
});

test.describe('Dado o editor de uma regra salva (RULES-13)', () => {
  test('deve ter nome, prioridade, Enabled, Delete rule, Discard e Save no topo, com o aviso de rascunho', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await urlComRegras(request, tokens);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, 'Rejeita');

    await expect(regra.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Rejeita');
    await expect(regra.getByRole('spinbutton', { name: 'Priority' })).toHaveValue('2');
    await expect(regra.getByRole('switch', { name: 'Enabled' })).toBeChecked();
    await expect(regra.getByRole('button', { name: 'Discard' })).toBeVisible();
    await expect(regra.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    const salvar = regra.getByRole('button', { name: 'Save', exact: true });
    await expect(salvar).toHaveCount(1);
    await expect(salvar).toBeInViewport({ ratio: 1 });
    await expect(regra.getByRole('button', { name: 'Test against history' })).toBeInViewport();
    await expect(regra.getByText('Unsaved changes')).toHaveCount(0);

    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Rejeita assinatura');
    await expect(regra.getByText('Unsaved changes')).toBeVisible();
    await regra.getByRole('button', { name: 'Discard' }).click();
    // UX de Regras, E-04/WM-12: com alteração não salva, "Discard" pergunta antes ("Discard changes?").
    await page
      .getByRole('dialog', { name: 'Discard changes?' })
      .getByRole('button', { name: 'Discard' })
      .click();
    await expect(regra).toBeHidden();
    expect((await getRules(request, tokenId)).map((r) => r.name)).toContain('Rejeita');

    const aberta = await abrirRegra(page, 'Rejeita');
    await aberta.getByRole('button', { name: 'Delete rule' }).click();
    await expect(aberta).toBeHidden();
    await expect(page.getByText('Rule deleted')).toBeVisible();
    await expect(linhaDaRegra(page, 'Rejeita')).toHaveCount(0);
    await expect
      .poll(async () => (await getRules(request, tokenId)).map((r) => r.name))
      .not.toContain('Rejeita');

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(linhaDaRegra(page, 'Rejeita')).toBeVisible();
    await expect
      .poll(async () => (await getRules(request, tokenId)).map((r) => r.name))
      .toContain('Rejeita');
  });
});

test.describe('Dado os controles da aba Match (RULES-17)', () => {
  test('deve ter métodos como chips e assinatura e schema como segmentados, com o provedor da URL', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: 'segredo' } });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);

    const metodos = regra.getByRole('group', { name: 'Methods' });
    for (const nome of ['POST', 'GET', 'PUT', 'PATCH', 'DELETE']) {
      await expect(metodos.getByRole('button', { name: nome, exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
    await expect(regra.getByRole('combobox', { name: 'Methods' })).toHaveCount(0);

    const assinatura = regra.getByRole('radiogroup', { name: 'Signature' });
    await expect(assinatura.getByRole('radio')).toHaveText(['Any', 'Valid', 'Invalid', 'Absent']);
    await expect(assinatura.getByRole('radio', { name: 'Any' })).toBeChecked();
    const schema = regra.getByRole('radiogroup', { name: 'Schema' });
    await expect(schema.getByRole('radio')).toHaveText(['Any', 'Valid', 'Invalid']);
    await expect(schema.getByRole('radio', { name: 'Any' })).toBeChecked();

    await expect(regra.getByText('Recorded on arrival · GitHub')).toBeVisible();
    await expect(regra.getByRole('link', { name: 'Set up in Checks' }).first()).toHaveAttribute(
      'href',
      new RegExp(`#/${tokenId}/checks`),
    );

    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Só POST inválido');
    await metodos.getByRole('button', { name: 'POST', exact: true }).click();
    await assinatura.getByRole('radio', { name: 'Invalid' }).click();
    const [put] = await Promise.all([
      page.waitForRequest(
        (r) => r.method() === 'PUT' && r.url().endsWith(`/token/${tokenId}/rules`),
      ),
      regra.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);
    expect((put.postDataJSON() as { match: object }[])[0].match).toMatchObject({
      method: ['POST'],
      signature: 'invalid',
    });
  });

  test('deve dizer "not set up" ao lado da assinatura Quando a URL não verifica', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await expect(regra.getByText(/not set up/)).toBeVisible();
  });
});

/**
 * Pix (POST /pagamentos) contra quatro mensagens: uma casa, duas falham em uma condição (GET /pagamentos e POST
 * /outro) e uma falha em duas (GET /outro).
 */
async function pixContraHistorico(page: Page, request: APIRequestContext, tokens: TokenTracker) {
  const tokenId = await tokens.create();
  await putRules(request, tokenId, [
    {
      name: 'Pix',
      priority: 1,
      match: { method: ['POST'], path: { equals: '/pagamentos' } },
      response: { status: 201 },
    },
  ]);
  const casa = await tokens.send(tokenId, { method: 'POST', path: '/pagamentos' });
  const perto1 = await tokens.send(tokenId, { method: 'GET', path: '/pagamentos' });
  const perto2 = await tokens.send(tokenId, { method: 'POST', path: '/outro' });
  const longe = await tokens.send(tokenId, { method: 'GET', path: '/outro' });
  await abrirRegras(page, tokenId);
  const regra = await abrirRegra(page, 'Pix');
  return { tokenId, regra, casa, perto1, perto2, longe };
}

test.describe('Dado o teste contra o histórico na aba Match (RULES-18/19)', () => {
  test('deve mostrar um chip por condição e o resumo "Against history" ao lado', async ({
    page,
    request,
    tokens,
  }) => {
    const { regra, perto1, perto2 } = await pixContraHistorico(page, request, tokens);

    const historico = regra.getByRole('complementary', { name: 'Against history' });
    await expect(historico).toContainText('Not tested yet');

    await regra.getByRole('button', { name: 'Test against history' }).click();
    await parte(regra, 'Match');

    const metodo = regra.locator('.feedback[data-condition="match.method"]');
    await expect(metodo).toHaveText('Fails on 2/4');
    await expect(metodo).toHaveClass(/\bfails\b/);
    await expect(regra.locator('.feedback[data-condition="match.path"]')).toHaveText(
      'Fails on 2/4',
    );
    await expect(regra.locator('.feedback.none').first()).toHaveText('No condition');

    await expect(historico).toContainText('of the 4 most recent would match');
    await expect(historico).toContainText('Closest misses');
    for (const id of [perto1, perto2]) {
      await expect(historico).toContainText(`#${id.substring(0, 5)}`);
    }
    await expect(historico).toContainText(/1 condition\b/);
    await expect(historico.getByRole('button', { name: 'Test again' })).toBeVisible();

    await historico.getByRole('button', { name: 'All results' }).click();
    await expect(regra.getByRole('tab', { name: 'Test', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('deve dizer "Passes N/M" na condição que todas cumprem', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { method: 'POST', path: '/a' });
    await tokens.send(tokenId, { method: 'POST', path: '/b' });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Todo POST');
    await regra
      .getByRole('group', { name: 'Methods' })
      .getByRole('button', { name: 'POST', exact: true })
      .click();
    await regra.getByRole('button', { name: 'Test against history' }).click();
    await parte(regra, 'Match');

    const metodo = regra.locator('.feedback[data-condition="match.method"]');
    await expect(metodo).toHaveText('Passes 2/2');
    await expect(metodo).toHaveClass(/\bpasses\b/);
  });
});

test.describe('Dado a aba Test (RULES-20)', () => {
  test('deve listar as que casam e as que não casam, as mais perto primeiro, com a contagem de condições', async ({
    page,
    request,
    tokens,
  }) => {
    const { regra } = await pixContraHistorico(page, request, tokens);
    await regra.getByRole('button', { name: 'Test against history' }).click();

    const resultado = regra.getByRole('status', { name: 'History test' });
    await expect(resultado.locator('.summary')).toHaveText(
      /^1 of the 4 most recent requests would match\.?$/,
    );
    await expect(resultado.getByRole('heading', { name: 'Would match (1)' })).toBeVisible();
    // UX de Regras, WM-22 (guia §3.4): cada mensagem é `link "{method} {path} · {time}"`, sem o "#id".
    await expect(resultado.getByRole('link', { name: /^POST \/pagamentos · .+/ })).toBeVisible();
    await expect(resultado.getByRole('heading', { name: 'Would not match (3)' })).toBeVisible();

    const maisPerto = resultado.getByRole('button', { name: 'Closest first' });
    await expect(maisPerto).toHaveAttribute('aria-pressed', 'true');
    // Uma linha por mensagem que não casa (`.misses > li`); as frases que falharam ficam no `ul.failed` dela.
    const naoCasam = resultado.locator('.misses > li');
    await expect(naoCasam).toHaveCount(3);
    await expect(naoCasam.last()).toContainText('GET /outro');
    await expect(naoCasam.last()).toContainText('2 conditions');
    await expect(naoCasam.last()).not.toHaveClass(/\bnear\b/);
    for (const rota of ['GET /pagamentos', 'POST /outro']) {
      const linha = naoCasam.filter({ hasText: rota });
      await expect(linha).toContainText(/1 condition\b/);
      await expect(linha).toHaveClass(/\bnear\b/);
    }
  });
});

test.describe('Dado a aba Scenario de uma regra de cenário (RULES-24)', () => {
  test('deve mostrar o cenário com o estado atual, a transição de cada regra, e trocar o estado ali', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await urlComRegras(request, tokens);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, 'Falha 1');
    await parte(regra, 'Scenario');

    const secao = regra.locator('section', {
      has: page.getByRole('heading', { name: 'Scenarios on this URL' }),
    });
    await expect(secao.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(secao.getByRole('button', { name: /^Reset all\b/ })).toBeVisible();
    await expect(
      secao.getByRole('img', { name: /^entrega: Started, then falhou-1 \(current\)/ }),
    ).toBeVisible();
    await expect(secao).toContainText('then 200 while in falhou-1');

    const linha = secao
      .getByRole('table', { name: 'Scenarios' })
      .locator('tr[data-scenario="entrega"]');
    await secao.getByRole('combobox', { name: 'New state of entrega' }).click();
    await page.getByRole('option', { name: 'Started', exact: true }).click();
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PUT' && r.url().endsWith(`/token/${tokenId}/scenarios/entrega`),
      ),
      linha.getByRole('button', { name: 'Set state' }).click(),
    ]);
    await expect(secao.getByRole('img', { name: /^entrega: Started \(current\)/ })).toBeVisible();
    expect((await request.post(`/${tokenId}/entrega`)).status()).toBe(503);
  });
});

test.describe('Dado o celular a 390×844 (RULES-27)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('deve mostrar a lista inteira na largura, sem rolagem horizontal', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await urlComRegras(request, tokens);
    await abrirRegras(page, tokenId);

    const tabela = page.getByRole('table', { name: 'Rules' });
    const larguras = await tabela.evaluate((el) => {
      let rolagem = 0;
      for (let no: Element | null = el; no; no = no.parentElement) {
        const rola = ['auto', 'scroll'].includes(getComputedStyle(no).overflowX);
        if (rola || no === document.documentElement) {
          rolagem = Math.max(rolagem, no.scrollWidth - no.clientWidth);
        }
      }
      return { rolagem, direita: el.getBoundingClientRect().right };
    });
    expect(larguras.rolagem).toBeLessThanOrEqual(1);
    expect(larguras.direita).toBeLessThanOrEqual(390);
    const pix = linhaDaRegra(page, 'Pix pago');
    for (const parteDaLinha of ['.name', '.match', '.hits', 'app-status-code.status']) {
      await expect(pix.locator(parteDaLinha)).toBeInViewport({ ratio: 1 });
    }
  });
});
