import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { anuncios } from './support/inbox';
import {
  abrirRegra,
  abrirRegras,
  acaoDoEditor,
  editor,
  gravarRegras,
  lerRegras,
  linhaDaRegra,
  novaRegra,
  parte,
  salvarRegra,
  voltarALista,
} from './support/regras';

// UX de Regras, fatia F2 — ordem e diagnóstico na lista (E-01, WM-08, WM-09, E-11, WM-30, WM-29, WM-20, WM-21,
// WM-03, WM-35, WM-02, WM-11; guia-ux §1 e §3.2; CA-1 e CA-2). Decisões da fatia (orquestrador, 2026-09-27): "Never
// matches" só com a configuração da URL conhecida e nula; "Likely shadowed" usa o último teste da regra salva; a ação
// do selo aparece em toda linha com diagnóstico; "No rules yet…" continua acima dos 3 cartões; "Duplicate" e
// "Delete" ficam no ⋮ da linha (MatMenu); o modelo "Fail N times, then accept" só entra com a F6. SUPOSIÇÕES:
// - SUPOSIÇÃO: os tooltips (prioridade, empate, "Would be shadowed…") são `title` ou MatTooltip; `dica()` lê os dois.
// - SUPOSIÇÃO: a linha 3 do diagnóstico ("Never answers: …", "This URL does not check signatures.", "Off · …") fica
//   dentro da linha da regra (`tr[data-rule-id]` ou a linha de ação logo abaixo dela); os testes procuram no `tbody`
//   junto do nome.
// - SUPOSIÇÃO: o anúncio de uma regra criada pelo editor é "1 rule created" (ICU de "{n} rules created").
// - SUPOSIÇÃO: o tooltip "Would be shadowed by {name} if turned on" fica no chip "OFF" da regra desligada (RULES-08).
// - SUPOSIÇÃO: o modelo entra como regra nova não salva (nada no servidor até o Save), com o nome sugerido do guia.

const FRASE =
  "Rules are checked in this order. The first one that matches answers. A catch-all rule answers whatever is left; the URL's default response answers when no rule does.";

const PIX = {
  name: 'Pix pago',
  priority: 2,
  match: { method: ['POST'], path: { equals: '/pagamentos' } },
  response: { status: 201 },
};
const TUDO = { name: 'Tudo o resto', priority: 9, response: { status: 404 } };

/** Lê o tooltip: `title` ou o MatTooltip que aparece no hover. */
async function dica(page: Page, alvo: Locator): Promise<string> {
  const titulo = await alvo.getAttribute('title');
  if (titulo) {
    return titulo;
  }
  await alvo.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  return (await tooltip.textContent())?.trim() ?? '';
}

/** O selo (`.flag`) da regra com o texto. */
function selo(page: Page, regra: string, texto: string | RegExp): Locator {
  return linhaDaRegra(page, regra).locator('.flag', { hasText: texto });
}

/** A lista inteira (onde fica também a linha de ação do diagnóstico). */
function lista(page: Page): Locator {
  return page.getByRole('table', { name: 'Rules' });
}

test.describe('Dado a lista de regras e a frase do modelo mental (§1, WM-08)', () => {
  test('deve explicar a ordem, mostrar a posição efetiva e tirar da ordem a desligada', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'A', priority: 1, response: { status: 201 } },
      { name: 'Desligada', priority: 2, enabled: false, response: { status: 503 } },
      { name: 'C', priority: 3, match: { path: { equals: '/c' } }, response: { status: 202 } },
    ]);
    await abrirRegras(page, tokenId);

    await expect(page.getByText(FRASE, { exact: true })).toBeVisible();
    const posicao = (nome: string) => linhaDaRegra(page, nome).locator('.position');
    await expect(posicao('A')).toHaveText('#1');
    await expect(posicao('A')).toHaveAttribute('aria-label', 'Position 1 of 2');
    await expect(posicao('C')).toHaveText('#2');
    await expect(posicao('C')).toHaveAttribute('aria-label', 'Position 2 of 2');
    await expect(posicao('Desligada')).toHaveText('—');
    await expect(posicao('Desligada')).toHaveAttribute('aria-label', 'Not in the order while off');
    expect(await dica(page, linhaDaRegra(page, 'A').locator('.priority'))).toBe(
      'Priority 1 · lower answers first; ties keep the list order',
    );
  });

  test('deve dizer no empate de prioridade que a ordem da lista decide', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Primeira', priority: 5, match: { path: { equals: '/a' } } },
      { name: 'Segunda', priority: 5, match: { path: { equals: '/b' } } },
    ]);
    await abrirRegras(page, tokenId);

    const segunda = linhaDaRegra(page, 'Segunda').locator('.position');
    await expect(segunda).toHaveText('#2');
    expect(await dica(page, segunda)).toBe('Same priority as Primeira; the list order decides.');
  });
});

test.describe('Dado uma regra pega-tudo ligada e uma regra nova (E-01, WM-30; CA-1)', () => {
  test('deve pôr a regra nova antes da pega-tudo, com a mesma prioridade, e responder já na primeira requisição', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX, TUDO]);
    await abrirRegras(page, tokenId);
    await expect(selo(page, 'Tudo o resto', 'Catch-all')).toBeVisible();

    const nova = await novaRegra(page);
    await expect(nova).toContainText(
      'Placed before "Tudo o resto" so it can answer (same priority, earlier in the list).',
    );
    await nova.getByRole('textbox', { name: 'Name', exact: true }).fill('Nova');
    await parte(nova, 'Match');
    await nova.getByRole('textbox', { name: 'Path', exact: true }).fill('/nova');
    await parte(nova, 'Response');
    await nova.getByRole('spinbutton', { name: 'Status' }).fill('201');
    await salvarRegra(page, nova, tokenId);

    expect((await lerRegras(request, tokenId)).map((r) => [r.name, r['priority']])).toEqual([
      ['Pix pago', 2],
      ['Nova', 9],
      ['Tudo o resto', 9],
    ]);
    expect((await request.post(`/${tokenId}/nova`)).status()).toBe(201);
  });

  test('deve entrar no fim com P5 Quando não há pega-tudo', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);

    const nova = await novaRegra(page);
    await expect(nova).not.toContainText('Placed before');
    await nova.getByRole('textbox', { name: 'Name', exact: true }).fill('Nova');
    await salvarRegra(page, nova, tokenId);

    expect((await lerRegras(request, tokenId)).map((r) => [r.name, r['priority']])).toEqual([
      ['Pix pago', 2],
      ['Nova', 5],
    ]);
  });

  test('deve avisar acima da lista que a pega-tudo responde o que sobra, e tirar o aviso ao desligá-la', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX, TUDO]);
    await abrirRegras(page, tokenId);

    const aviso = page
      .getByRole('note')
      .filter({ hasText: '"Tudo o resto" answers whatever is left.' });
    await expect(aviso).toContainText(
      `"Tudo o resto" answers whatever is left. While it is on, messages don't keep why the other rules didn't match — use "Why not rule…?" on a message.`,
    );
    await page.getByRole('switch', { name: 'Enable rule Tudo o resto' }).click();
    await expect(aviso).toHaveCount(0);
    await expect(lista(page)).toContainText(
      'Off · what it answered now goes to the next matching rule, or the default response.',
    );
  });
});

test.describe('Dado uma regra que outra anterior sempre responde (E-01, WM-09; CA-2)', () => {
  const A = {
    name: 'Pagamentos',
    priority: 1,
    match: { method: ['POST'], path: { prefix: '/pag' } },
    response: { status: 200 },
  };
  const B = {
    name: 'Acme',
    priority: 2,
    match: {
      method: ['POST'],
      path: { equals: '/pagamentos' },
      headers: { 'X-Tenant': { equals: 'acme' } },
    },
    response: { status: 201 },
  };

  test('deve marcar "Shadowed by", explicar e resolver com "Move before"', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [A, B]);
    await abrirRegras(page, tokenId);

    await expect(selo(page, 'Acme', 'Shadowed by Pagamentos')).toBeVisible();
    await expect(lista(page)).toContainText(
      'Never answers: "Pagamentos" comes first and matches everything this rule matches.',
    );
    await lista(page).getByRole('button', { name: 'Move before Pagamentos' }).click();

    await expect(page.getByText('Moved before Pagamentos · priorities updated')).toBeVisible();
    await expect(selo(page, 'Acme', /Shadowed/)).toHaveCount(0);
    await expect
      .poll(async () => (await lerRegras(request, tokenId)).map((r) => r.name))
      .toEqual(['Acme', 'Pagamentos']);
    const resposta = await request.post(`/${tokenId}/pagamentos`, {
      headers: { 'X-Tenant': 'acme' },
    });
    expect(resposta.status()).toBe(201);
  });

  const negativos: [string, object][] = [
    [
      'A com regex (só texto idêntico prova)',
      { ...A, match: { method: ['POST'], path: { regex: '/pag.*' } } },
    ],
    ['A desligada', { ...A, enabled: false }],
    ['A só com GET', { ...A, match: { method: ['GET'], path: { prefix: '/pag' } } }],
    ['A com cenário noutro estado', { ...A, scenario: { name: 'fluxo', requiredState: 'pago' } }],
    [
      'A exige outro valor do cabeçalho',
      { ...A, match: { ...A.match, headers: { 'X-Tenant': { equals: 'outra' } } } },
    ],
  ];
  for (const [caso, a] of negativos) {
    test(`não deve marcar sombra Quando ${caso}`, async ({ page, request, tokens }) => {
      const tokenId = await tokens.create();
      await gravarRegras(request, tokenId, [a, B]);
      await abrirRegras(page, tokenId);

      await expect(linhaDaRegra(page, 'Acme').locator('.name')).toBeVisible();
      await expect(selo(page, 'Acme', /Shadowed/)).toHaveCount(0);
    });
  }

  test('deve dizer só no tooltip que a regra desligada ficaria sombreada', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [A, { ...B, enabled: false }]);
    await abrirRegras(page, tokenId);

    await expect(selo(page, 'Acme', /Shadowed/)).toHaveCount(0);
    const desligada = linhaDaRegra(page, 'Acme').getByText('OFF', { exact: true });
    expect(await dica(page, desligada)).toBe('Would be shadowed by Pagamentos if turned on');
  });

  test('deve marcar "Likely shadowed by" depois do teste, quando tudo o que casaria já é respondido pela anterior', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { ...A, match: { method: ['POST'], path: { regex: '/pag.*' } } },
      { ...B, match: { method: ['POST'], path: { equals: '/pagamentos' } } },
    ]);
    await tokens.send(tokenId, { path: '/pagamentos' });
    await tokens.send(tokenId, { path: '/pagamentos' });
    await abrirRegras(page, tokenId);
    await expect(selo(page, 'Acme', /Shadowed/)).toHaveCount(0);

    const regra = await abrirRegra(page, 'Acme');
    await regra.getByRole('button', { name: 'Test against history' }).click();
    await expect(regra.getByRole('status', { name: 'History test' })).toBeVisible();
    await voltarALista(page, regra);

    await expect(selo(page, 'Acme', 'Likely shadowed by Pagamentos')).toBeVisible();
  });
});

test.describe('Dado uma regra que nunca pode casar (E-11)', () => {
  test('deve marcar "Never matches" quando exige assinatura ou schema que a URL não verifica', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Assinada', priority: 1, match: { signature: 'invalid' }, response: { status: 401 } },
      { name: 'Com schema', priority: 2, match: { schema: 'valid' }, response: { status: 200 } },
    ]);
    await abrirRegras(page, tokenId);

    await expect(selo(page, 'Assinada', 'Never matches')).toBeVisible();
    await expect(selo(page, 'Com schema', 'Never matches')).toBeVisible();
    await expect(lista(page)).toContainText('This URL does not check signatures.');
    await expect(lista(page)).toContainText('This URL has no schema.');
    await expect(
      lista(page).getByRole('link', { name: 'Set up in Checks' }).first(),
    ).toHaveAttribute('href', new RegExp(`#/${tokenId}/checks`));
  });

  test('não deve marcar "Never matches" Quando a URL verifica a assinatura', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: 's' } });
    await gravarRegras(request, tokenId, [
      { name: 'Assinada', priority: 1, match: { signature: 'invalid' }, response: { status: 401 } },
    ]);
    await abrirRegras(page, tokenId);

    await expect(linhaDaRegra(page, 'Assinada').locator('.name')).toBeVisible();
    await expect(selo(page, 'Assinada', 'Never matches')).toHaveCount(0);
  });

  test('deve apontar o estado de cenário que nenhuma regra ligada produz', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      {
        name: 'Início',
        priority: 1,
        scenario: { name: 'entrega', requiredState: 'Started', newState: 'enviada' },
      },
      { name: 'Errada', priority: 2, scenario: { name: 'entrega', requiredState: 'entregue' } },
    ]);
    await abrirRegras(page, tokenId);

    await expect(selo(page, 'Errada', 'Never matches')).toBeVisible();
    await expect(lista(page)).toContainText(
      'No enabled rule leads to state "entregue" — probably a typo.',
    );
    await expect(selo(page, 'Início', 'Never matches')).toHaveCount(0);
  });
});

test.describe('Dado duplicar e apagar uma regra (WM-21)', () => {
  test('deve duplicar pelo editor como regra nova "(copy)" que entra logo após a original', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX, TUDO]);
    await abrirRegras(page, tokenId);
    const pix = await abrirRegra(page, 'Pix pago');

    await acaoDoEditor(page, pix, 'Duplicate rule');
    const copia = editor(page);
    await expect(copia).toBeVisible();
    await expect(copia.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Pix pago (copy)',
    );
    await expect(copia.getByRole('spinbutton', { name: 'Priority' })).toHaveValue('2');
    await expect(copia.getByRole('switch', { name: 'Enabled' })).toBeChecked();
    await salvarRegra(page, copia, tokenId);

    const regras = await lerRegras(request, tokenId);
    expect(regras.map((r) => r.name)).toEqual(['Pix pago', 'Pix pago (copy)', 'Tudo o resto']);
    expect(new Set(regras.map((r) => r.id)).size).toBe(3);
    await expect(selo(page, 'Pix pago (copy)', 'Shadowed by Pix pago')).toBeVisible();
  });

  test('deve duplicar e apagar pelo ⋮ da linha, com Desfazer', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX, TUDO]);
    await abrirRegras(page, tokenId);

    const mais = page.getByRole('button', { name: 'More actions for Tudo o resto' });
    await mais.click();
    await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Rule deleted')).toBeVisible();
    await expect
      .poll(async () => (await lerRegras(request, tokenId)).map((r) => r.name))
      .toEqual(['Pix pago']);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => (await lerRegras(request, tokenId)).map((r) => r.name))
      .toEqual(['Pix pago', 'Tudo o resto']);

    await page.getByRole('button', { name: 'More actions for Pix pago' }).click();
    await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
    await expect(editor(page).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Pix pago (copy)',
    );
  });
});

test.describe('Dado o filtro da lista (WM-03)', () => {
  test('deve filtrar por nome, caminho e desligadas, com o contador e a frase de vazio', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      PIX,
      { name: 'Boleto', priority: 3, match: { path: { equals: '/boletos' } } },
      { ...TUDO, enabled: false },
    ]);
    await abrirRegras(page, tokenId);
    const filtro = page.getByRole('searchbox', { name: 'Filter rules' });
    const nomes = () =>
      lista(page)
        .locator('tbody tr[data-rule-id] .name')
        .evaluateAll((els) => els.map((el) => el.textContent?.trim()));

    await filtro.fill('boletos');
    await expect.poll(nomes).toEqual(['Boleto']);
    await expect(page.getByText('1 of 3 rules', { exact: true })).toBeVisible();

    await filtro.fill('zzz');
    await expect(page.getByText('No rule matches "zzz".')).toBeVisible();

    await filtro.fill('');
    const desligadas = page.getByRole('button', { name: 'Off', exact: true });
    await desligadas.click();
    await expect(desligadas).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(nomes).toEqual(['Tudo o resto']);
  });

  test('deve desabilitar "No hits" Quando os acertos não carregaram, e dizer "Hits unavailable"', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await page.route(/\/token\/[^/]+\/stats(\?.*)?$/, (rota) => rota.fulfill({ status: 500 }));
    await abrirRegras(page, tokenId);

    const semAcertos = page.getByRole('button', { name: 'No hits', exact: true });
    await expect(semAcertos).toBeDisabled();
    await expect(linhaDaRegra(page, 'Pix pago').locator('.hits')).toHaveText('Hits unavailable');
  });
});

test.describe('Dado os acertos de cada regra (WM-29)', () => {
  test('deve dizer "No requests yet" em vez de "0 de 0"', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);

    await expect(linhaDaRegra(page, 'Pix pago').locator('.hits')).toHaveText('No requests yet');
  });
});

test.describe('Dado uma regra recém-criada (WM-35)', () => {
  test('deve destacá-la por uns segundos e anunciar a criação', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const nova = await novaRegra(page);
    await nova.getByRole('textbox', { name: 'Name', exact: true }).fill('Recém');
    await salvarRegra(page, nova, tokenId);

    const linha = linhaDaRegra(page, 'Recém');
    await expect(linha).toHaveClass(/\bjust-created\b/);
    await expect(anuncios(page).filter({ hasText: /^1 rules? created$/ })).toHaveCount(1);
    await expect(linha).not.toHaveClass(/\bjust-created\b/, { timeout: 8_000 });
  });
});

test.describe('Dado a lista vazia (WM-02)', () => {
  test('deve oferecer três caminhos abaixo de "No rules yet"', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pagamentos' });
    await abrirRegras(page, tokenId);

    await expect(page.getByText('No rules yet')).toBeVisible();
    for (const nome of [
      'Describe it in words',
      'Start from a template',
      'Create from the latest request',
    ]) {
      await expect(page.getByRole('button', { name: nome })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Start from a template' }).click();
    await expect(page.getByRole('menu', { name: 'Rule templates' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Describe it in words' }).click();
    await expect(editor(page).getByRole('textbox', { name: 'Describe the rule' })).toBeVisible();
  });

  test('não deve oferecer "Create from the latest request" Quando a URL não recebeu nada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);

    await expect(page.getByRole('button', { name: 'Describe it in words' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create from the latest request' })).toHaveCount(
      0,
    );
  });
});

test.describe('Dado os modelos de regra (WM-11)', () => {
  test('deve listar os modelos e abrir o 429 com Retry-After como rascunho pronto para salvar', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);

    await page.getByRole('button', { name: 'New rule from template' }).click();
    const menu = page.getByRole('menu', { name: 'Rule templates' });
    for (const item of [
      'Accept everything (200)',
      'Unavailable (503)',
      'Reject invalid signature (401)',
      '429 with Retry-After',
      'Echo the body (template)',
      'Delay 30 s',
      'Drop the connection',
    ]) {
      await expect(menu.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
    }
    await menu.getByRole('menuitem', { name: '429 with Retry-After', exact: true }).click();

    const regra = editor(page);
    await expect(regra.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Rate limited',
    );
    await parte(regra, 'Response');
    await expect(regra.getByRole('spinbutton', { name: 'Status' })).toHaveValue('429');
    await expect(regra.getByRole('textbox', { name: 'Response header 1 name' })).toHaveValue(
      'Retry-After',
    );
    await expect(regra.getByRole('textbox', { name: 'Response header 1 value' })).toHaveValue('5');
    expect(await lerRegras(request, tokenId)).toEqual([]);

    await salvarRegra(page, regra, tokenId);
    const resposta = await request.post(`/${tokenId}`);
    expect(resposta.status()).toBe(429);
    expect(resposta.headers()['retry-after']).toBe('5');
  });

  test('deve abrir "Reject invalid signature (401)" já avisando que a URL não verifica assinatura', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);

    await page.getByRole('button', { name: 'New rule from template' }).click();
    await page
      .getByRole('menuitem', { name: 'Reject invalid signature (401)', exact: true })
      .click();

    const regra = editor(page);
    await expect(regra.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Invalid signature',
    );
    await expect(regra).toContainText(/Never matches|does not check signatures/);
    await expect(regra.getByRole('link', { name: 'Set up in Checks' }).first()).toBeVisible();
  });
});
