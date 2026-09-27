import { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirRegra, novaRegra, parte } from './support/regras';

// Regras de resposta, fase B (CA-5, CA-6, CA-7 e CA-10 no que é da tela): template, atraso e
// falha pelo editor, cenário "falha 3×, depois 200" criado pela tela e o painel de cenários.
// Precisa do backend com os campos da fase B e `GET|PUT|DELETE /token/{id}/scenarios`.
// Item 14, E6: o editor vira a `region "New rule"` com as abas (resposta, atraso e falha em "Response"; cenário em
// "Scenario"); o painel de cenários ganha o diagrama de cada cenário. SUPOSIÇÕES em `support/regras.ts` e mais: o
// diagrama é um `img` com o nome "{cenário}: Started, then {estado}, then …" (o atual marcado "(current)").
// Fidelidade ao C, fase 2: o painel de cenários sai de baixo da lista e vai para a aba Scenario do editor, na seção
// "Scenarios on this URL", com os mesmos nomes (RULES-12); o atraso vira `radiogroup "Delay"` (RULES-23); os
// "Template helpers" podem vir abertos na largura grande.

async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function openRules(page: Page, tokenId: string) {
  await page.goto(`/#/${tokenId}/rules`);
  await expect(page.getByRole('table', { name: 'Rules' })).toBeVisible();
}

async function getRules(api: APIRequestContext, tokenId: string) {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as Record<string, unknown>[];
}

/** Abre o editor de regra nova, preenche o nome e vai à aba Response; devolve o editor. */
async function newRule(page: Page, name: string): Promise<Locator> {
  const dialog = await novaRegra(page);
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await parte(dialog, 'Response');
  return dialog;
}

/** Salva e espera a regra na lista (o snackbar de uma regra salva antes pode ainda estar saindo). */
async function saveRule(page: Page, dialog: Locator, name: string) {
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('table', { name: 'Rules' }).locator('.name', { hasText: name }),
  ).toBeVisible();
}

/** Abre a regra salva `nome` na aba Scenario e devolve a seção "Scenarios on this URL" (RULES-12). */
async function abrirCenarios(page: Page, nome: string): Promise<Locator> {
  const regra = await abrirRegra(page, nome);
  await parte(regra, 'Scenario');
  const secao = regra.locator('section', {
    has: page.getByRole('heading', { name: 'Scenarios on this URL' }),
  });
  await expect(secao).toBeVisible();
  return secao;
}

/** Passo do cenário: exige `required`, vai para `next` e responde `status`. */
async function scenarioStep(
  page: Page,
  step: { name: string; required: string; next?: string; status: string; retryAfter?: string },
) {
  const dialog = await newRule(page, step.name);
  await dialog.getByRole('spinbutton', { name: 'Status' }).fill(step.status);
  if (step.retryAfter) {
    await dialog.getByRole('button', { name: 'Add response header' }).click();
    await dialog.getByRole('textbox', { name: 'Response header 1 name' }).fill('Retry-After');
    await dialog.getByRole('textbox', { name: 'Response header 1 value' }).fill(step.retryAfter);
  }
  await parte(dialog, 'Scenario');
  await dialog.getByRole('combobox', { name: 'Scenario name', exact: true }).fill('Retry');
  await dialog.getByRole('combobox', { name: 'Required state', exact: true }).fill(step.required);
  if (step.next) {
    // Exato: o painel de cenários, agora na aba Scenario (RULES-12), tem o "New state of {cenário}".
    await dialog.getByRole('combobox', { name: 'New state', exact: true }).fill(step.next);
  }
  await saveRule(page, dialog, step.name);
}

test.describe('Dado o editor de regras com template, atraso e falha', () => {
  test('deve responder o corpo renderizado com dados da requisição Quando o template está ligado', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await openRules(page, tokenId);

    const dialog = await newRule(page, 'Eco do pedido');
    await dialog.getByRole('button', { name: 'Add response header' }).click();
    await dialog.getByRole('textbox', { name: 'Response header 1 name' }).fill('X-Method');
    await dialog
      .getByRole('textbox', { name: 'Response header 1 value' })
      .fill('{{request.method}}');
    await dialog
      .getByRole('textbox', { name: 'Response body' })
      .fill(`{"id": {{jsonPath request.body '$.id'}}, "tipo": "{{request.query.tipo}}"}`);
    await dialog.getByRole('switch', { name: 'Template' }).click();
    const ajuda = dialog.getByText("{{jsonPath request.body '$.id'}}");
    if (!(await ajuda.isVisible())) {
      await dialog.getByText('Template helpers').click();
    }
    await expect(ajuda).toBeVisible();
    await saveRule(page, dialog, 'Eco do pedido');

    await expect(
      page.locator('tr', { hasText: 'Eco do pedido' }).locator('.flag', { hasText: 'template' }),
    ).toHaveAttribute('title', 'Body and header values are templates');
    const webhook = await request.post(`/${tokenId}/pedidos?tipo=pix`, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"id": 42}',
    });
    expect(webhook.status()).toBe(200);
    expect(webhook.headers()['x-method']).toBe('POST');
    expect(await webhook.text()).toBe('{"id": 42, "tipo": "pix"}');
  });

  test('deve atrasar a resposta pelo tempo configurado Quando a regra tem atraso fixo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await openRules(page, tokenId);

    const dialog = await newRule(page, 'Lenta');
    await dialog
      .getByRole('radiogroup', { name: 'Delay' })
      .getByRole('radio', { name: 'Fixed' })
      .click();
    const delay = dialog.getByRole('spinbutton', { name: 'Delay (ms)' });
    await delay.fill('60001');
    await delay.blur();
    await expect(dialog.getByText('An integer between 0 and 60000 (ms).')).toBeVisible();
    // UX de Regras, WM-12/WM-04: Save nunca fica desabilitado; o clique leva ao campo e diz o que corrigir.
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(delay).toBeFocused();
    await expect(
      dialog.getByRole('alert').filter({ hasText: /To save, fix: .*Delay/ }),
    ).toBeVisible();
    expect(await getRules(request, tokenId)).toEqual([]);
    await delay.fill('1500');
    await saveRule(page, dialog, 'Lenta');

    await expect(
      page.locator('tr', { hasText: 'Lenta' }).locator('.flag', { hasText: 'delay' }),
    ).toHaveAttribute('title', 'Delay: 1500 ms');
    const started = Date.now();
    const webhook = await request.post(`/${tokenId}`);
    const elapsed = Date.now() - started;
    expect(webhook.status()).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(1500);
    expect(elapsed).toBeLessThan(10_000);
  });

  test('deve derrubar a conexão e gravar a mensagem Quando a regra tem a falha "Connection reset"', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await openRules(page, tokenId);

    const dialog = await newRule(page, 'Cai');
    await choose(
      page,
      dialog.getByRole('combobox', { name: 'Fault' }),
      'Connection reset (TCP RST)',
    );
    await expect(dialog.getByRole('note')).toContainText(
      'the status, headers, body, delay and dribble are ignored',
    );
    await expect(dialog.getByRole('spinbutton', { name: 'Status' })).toBeDisabled();
    await expect(
      dialog.getByRole('radiogroup', { name: 'Delay' }).getByRole('radio', { name: 'Fixed' }),
    ).toBeDisabled();
    await saveRule(page, dialog, 'Cai');

    expect(await getRules(request, tokenId)).toEqual([
      expect.objectContaining({
        response: expect.objectContaining({ fault: 'connection_reset', delay: null }),
      }),
    ]);
    // Direto no backend a conexão cai (erro no cliente); atrás do proxy do `ng serve`, o proxy
    // responde 502 no lugar dela. Em nenhum dos dois casos há resposta da regra.
    const outcome = await request.post(`/${tokenId}`).then(
      (response) => response.status(),
      () => 'connection failed',
    );
    expect([502, 'connection failed']).toContain(outcome);
    await expect.poll(async () => (await tokens.listed(tokenId)).length).toBe(1);
  });
});

test.describe('Dado o cenário "falha 3×, depois 200" criado pela tela', () => {
  test('deve responder 503 três vezes e depois 200, mostrar os estados no painel e voltar ao início com "Reset all"', async ({
    page,
    request,
    tokens,
  }) => {
    test.setTimeout(90_000);
    const tokenId = await tokens.create();
    await openRules(page, tokenId);

    await scenarioStep(page, {
      name: 'Falha 1',
      required: 'Started',
      next: 'falhou-1',
      status: '503',
      retryAfter: '1',
    });
    // Nada abaixo da lista: o painel fica na aba Scenario do editor (RULES-12).
    await expect(page.getByRole('table', { name: 'Scenarios' })).toHaveCount(0);
    let cenarios = await abrirCenarios(page, 'Falha 1');
    await expect(
      cenarios.getByRole('table', { name: 'Scenarios' }).locator('tr[data-scenario="Retry"]'),
    ).toContainText('Started');
    await scenarioStep(page, {
      name: 'Falha 2',
      required: 'falhou-1',
      next: 'falhou-2',
      status: '503',
      retryAfter: '1',
    });
    await scenarioStep(page, {
      name: 'Falha 3',
      required: 'falhou-2',
      next: 'falhou-3',
      status: '503',
      retryAfter: '1',
    });
    await scenarioStep(page, { name: 'Sucesso', required: 'falhou-3', status: '200' });
    await expect(
      page.locator('tr', { hasText: 'Falha 2' }).locator('.flag', { hasText: 'scenario' }),
    ).toHaveAttribute('title', 'Scenario Retry: falhou-1 → falhou-2');
    cenarios = await abrirCenarios(page, 'Falha 2');
    await expect(
      cenarios.getByRole('img', {
        name: /^Retry: Started( \(current\))?, then falhou-1, then falhou-2, then falhou-3\b/,
      }),
    ).toBeVisible();

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const webhook = await request.post(`/${tokenId}`);
      statuses.push(webhook.status());
      if (webhook.status() === 503) {
        expect(webhook.headers()['retry-after']).toBe('1');
      }
    }
    expect(statuses).toEqual([503, 503, 503, 200, 200]);

    const row = cenarios
      .getByRole('table', { name: 'Scenarios' })
      .locator('tr[data-scenario="Retry"]');
    const panelButton = (name: string) => cenarios.getByRole('button', { name });
    await panelButton('Refresh').click();
    await expect(row.locator('td.data').nth(1)).toHaveText('falhou-3');

    await choose(page, page.getByRole('combobox', { name: 'New state of Retry' }), 'falhou-2');
    await row.getByRole('button', { name: 'Set state' }).click();
    await expect(row.locator('td.data').nth(1)).toHaveText('falhou-2');
    expect((await request.post(`/${tokenId}`)).status()).toBe(503);

    await panelButton('Reset all').click();
    // UX de Regras, WM-37: voltar todos os cenários a Started pede confirmação nomeando os cenários.
    const confirmar = page.getByRole('dialog', { name: 'Reset all scenarios?' });
    await expect(confirmar).toContainText('Retry');
    await confirmar.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByText('Scenarios reset to Started')).toBeVisible();
    await expect(row.locator('td.data').nth(1)).toHaveText('Started');
    expect((await request.post(`/${tokenId}`)).status()).toBe(503);
    await panelButton('Refresh').click();
    await expect(row.locator('td.data').nth(1)).toHaveText('falhou-1');
  });
});
