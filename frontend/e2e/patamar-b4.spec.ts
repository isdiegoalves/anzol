import { Locator, Page, Request, Route } from '@playwright/test';
import {
  escutarAnuncios,
  expectSemAnuncio,
  expectUmAnuncio,
  limparAnuncios,
} from './support/anuncios';
import { TokenTracker, expect, test } from './support/fixtures';
import { abrirItem, abrirMensagem, acaoDaMensagem, acoes, detalhes } from './support/inbox';
import { id5 } from './support/patamar';
import { editor, gravarRegras, lerRegras, parte } from './support/regras';
import { compacto } from './support/shell';
import { readStorage, seedStorage } from './support/storage';

const NOTA =
  'A rule only chooses the answer to a request: status, headers, body, delay or a network fault. It does not send e-mail, write to a database or call another service.';

interface Resposta {
  status?: number;
  corpo: unknown;
  atrasoMs?: number;
  cabecalhos?: Record<string, string>;
}

/** Responde as rotas de IA na rota do navegador: o LLM falso da 18099 é um só, e o ia.spec o programa. */
async function ia(
  page: Page,
  tokenId: string,
  rota: 'suggest' | 'explain',
  ...respostas: Resposta[]
): Promise<Request[]> {
  const pedidos: Request[] = [];
  const padrao =
    rota === 'suggest'
      ? new RegExp(`/token/${tokenId}/rules/suggest$`)
      : new RegExp(`/token/${tokenId}/request/[^/]+/explain$`);
  await page.route(padrao, async (route: Route) => {
    pedidos.push(route.request());
    const resposta = respostas[Math.min(pedidos.length, respostas.length) - 1];
    if (resposta.atrasoMs) {
      await new Promise((fim) => setTimeout(fim, resposta.atrasoMs));
    }
    await route
      .fulfill({
        status: resposta.status ?? 200,
        headers: resposta.cabecalhos,
        json: resposta.corpo,
      })
      .catch(() => undefined);
  });
  return pedidos;
}

function sugestao(regra: object, check: object, explanation = 'Texto do modelo.'): Resposta {
  return { corpo: { rule: regra, explanation, attempts: 1, check } };
}

const REGRA_ERRADA = {
  name: 'Pedido sucedido',
  enabled: true,
  priority: 5,
  match: {
    method: ['POST'],
    path: { equals: '/pedidos' },
    body: [{ jsonPath: { path: '$.status', equals: 'sucedido' } }],
  },
  response: { status: 202, headers: {}, body: '' },
};
const REGRA_CERTA = {
  ...REGRA_ERRADA,
  name: 'Pedido pago',
  match: {
    method: ['POST'],
    path: { equals: '/pedidos' },
    body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
  },
};

async function editorComExemplo(page: Page, tokens: TokenTracker) {
  const tokenId = await tokens.create();
  const exemplo = await tokens.send(tokenId, {
    path: '/pedidos',
    headers: { 'Content-Type': 'application/json' },
    data: '{"id":"evt_1","status":"pago"}',
  });
  return { tokenId, exemplo };
}

async function abrirEditor(page: Page, tokenId: string, exemplo?: string): Promise<Locator> {
  await page.goto(`/#/${tokenId}/rules/new${exemplo ? `?from=${exemplo}` : ''}`);
  const regra = editor(page);
  await expect(regra).toBeVisible();
  return regra;
}

async function descrever(regra: Locator, pedido: string, comExemplo = false): Promise<Locator> {
  const campo = regra.getByRole('textbox', { name: 'Describe the rule' });
  if (!(await campo.isVisible())) {
    await regra.getByText('Describe the rule', { exact: true }).click();
  }
  if (comExemplo) {
    await regra.getByRole('checkbox', { name: /Use the open request as example/ }).check();
  }
  await campo.fill(pedido);
  return campo;
}

function proposta(regra: Locator): Locator {
  return regra
    .getByRole('region', { name: 'Suggestion' })
    .or(regra.getByRole('status', { name: 'Suggestion' }));
}

function conferencias(regra: Locator): Locator {
  return proposta(regra)
    .getByRole('list', { name: 'Checks on this suggestion' })
    .getByRole('listitem');
}

function andamento(page: Page): Locator {
  return page.getByRole('group', { name: 'AI progress' }).locator('[role="status"]');
}

test.describe('Dado uma sugestão de regra conferida pela tela', () => {
  test('deve dizer que a regra não casa com o exemplo nem com o histórico, antes de oferecer aplicar', async ({
    page,
    tokens,
  }) => {
    const { tokenId, exemplo } = await editorComExemplo(page, tokens);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const pedidos = await ia(
      page,
      tokenId,
      'suggest',
      sugestao(
        REGRA_ERRADA,
        {
          example: {
            matches: false,
            failed: ['body $.status: expected "sucedido", got "pago"'],
            conditions: ['match.body.0'],
          },
          recent: { evaluated: 1, matched: 0 },
          warnings: [
            {
              code: 'example_not_matched',
              message: 'The rule does not match the example request.',
            },
          ],
        },
        'Responde 202 quando o pedido foi sucedido.',
      ),
    );
    const regra = await abrirEditor(page, tokenId, exemplo);
    await descrever(regra, 'Responder 202 para mensagens como esta', true);
    await limparAnuncios(page);

    await regra.getByRole('button', { name: 'Suggest' }).click();

    const bloco = proposta(regra);
    const resumo = bloco.getByText('2 problems found. Review before applying.');
    await expect(resumo).toBeVisible();
    await expect(resumo).toBeFocused();
    expect(pedidos[0].postDataJSON()).toMatchObject({ request_id: exemplo });
    const itens = conferencias(regra);
    await expect(itens.nth(0)).toHaveText(
      /^\s*Problem\s*Does not match the example request: body \$\.status: expected "sucedido", got "pago"\s*$/,
    );
    await expect(itens.nth(1)).toHaveText(
      /^\s*Problem\s*Would match none of the last 1 requests?\.\s*$/,
    );
    await expect(itens.nth(2)).toHaveText(
      /^\s*OK\s*Every field in the conditions is in the example request\.\s*$/,
    );
    await expect(itens.nth(3)).toHaveText(/^\s*OK\s*Enters at position 1 of 1\b/);
    await expect(bloco).toContainText('What this rule does');
    await expect(bloco).toContainText(/When a POST to \/pedidos\b.*answer 202/);
    await expect(bloco).toContainText(NOTA);
    const doModelo = bloco.locator('details', {
      has: page.locator('summary', { hasText: 'What the model wrote' }),
    });
    await expect(doModelo).not.toHaveAttribute('open');
    await expect(doModelo).toContainText('Not checked. The rule above is what counts.');
    await expect(bloco.getByText('Responde 202 quando o pedido foi sucedido.')).toBeHidden();
    await expect(bloco).toContainText('Suggested in 1 attempt.');
    const botoes = bloco.getByRole('button', {
      name: /^(Apply conditions only|Apply all|Dismiss)$/,
    });
    await expect(botoes).toHaveText(['Apply conditions only', 'Apply all', 'Dismiss']);
    for (const nome of ['Apply conditions only', 'Apply all']) {
      await expect(bloco.getByRole('button', { name: nome })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    await expect(regra.getByRole('textbox', { name: 'Path', exact: true })).toHaveValue('/pedidos');
    expect(await lerRegras(page.request, tokenId)).toEqual([]);
    // O resumo não é anunciado: quem o lê é o foco.
    await expectUmAnuncio(
      page,
      /^Asking the local model\. It usually takes about \d+ s\.$/,
      /^AI progress$/,
    );
    await expect(andamento(page)).toHaveText('');
    await expectSemAnuncio(page, /problems found/);
  });

  test('deve dizer que confere com o exemplo e com o histórico e aplicar com "Apply all"', async ({
    page,
    tokens,
  }) => {
    const { tokenId, exemplo } = await editorComExemplo(page, tokens);
    await seedStorage(page, {});
    await ia(
      page,
      tokenId,
      'suggest',
      sugestao(REGRA_CERTA, {
        example: { matches: true, failed: [], conditions: [] },
        recent: { evaluated: 1, matched: 1 },
        warnings: [],
      }),
    );
    const regra = await abrirEditor(page, tokenId, exemplo);
    await descrever(regra, 'Responder 202 para pedidos pagos', true);

    await regra.getByRole('button', { name: 'Suggest' }).click();

    const bloco = proposta(regra);
    await expect(bloco).toContainText('Checked: matches the example and 1 of the last 1.');
    await expect(conferencias(regra).filter({ hasText: /^\s*Problem/ })).toHaveCount(0);
    const aplicar = bloco.getByRole('button', { name: 'Apply all' });
    await expect(aplicar).not.toHaveAttribute('aria-disabled', 'true');
    await aplicar.click();
    await expect(
      page.locator('.mat-mdc-snack-bar-container', { hasText: 'Suggestion applied' }),
    ).toBeVisible();
    await expect(regra.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Pedido pago',
    );
    await parte(regra, 'Response');
    await expect(regra.getByRole('spinbutton', { name: 'Status' })).toHaveValue('202');
    expect(await lerRegras(page.request, tokenId)).toEqual([]);
  });

  test('deve dizer que nenhuma requisição de exemplo foi usada Quando a caixa não foi marcada', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await editorComExemplo(page, tokens);
    await seedStorage(page, {});
    const pedidos = await ia(
      page,
      tokenId,
      'suggest',
      sugestao(REGRA_CERTA, {
        example: null,
        recent: { evaluated: 1, matched: 1 },
        warnings: [],
      }),
    );
    const regra = await abrirEditor(page, tokenId);
    await descrever(regra, 'Responder 202 para pedidos pagos');

    await regra.getByRole('button', { name: 'Suggest' }).click();

    await expect(proposta(regra)).toContainText(
      'Checked: matches 1 of the last 1. No example request was used.',
    );
    expect(pedidos[0].postDataJSON()).not.toHaveProperty('request_id');
    await expect(conferencias(regra).filter({ hasText: 'example request' })).toHaveCount(0);
  });

  test('deve desligar a caixa do exemplo, com a razão, Quando não há requisição aberta', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await editorComExemplo(page, tokens);
    await seedStorage(page, {});
    const regra = await abrirEditor(page, tokenId);
    await regra.getByText('Describe the rule', { exact: true }).click();

    const caixa = regra.getByRole('checkbox', { name: /Use the open request as example/ });
    await expect(caixa).toHaveAttribute('aria-disabled', 'true');
    await expect(caixa).not.toBeChecked();
    await expect(regra).toContainText('Open a request in the Inbox to use it as example.');
  });

  test('deve apontar o template desligado, a regra sem condição e o caminho que nunca chegou', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await editorComExemplo(page, tokens);
    await seedStorage(page, {});
    await ia(
      page,
      tokenId,
      'suggest',
      sugestao(
        {
          name: 'Eco',
          enabled: true,
          priority: 5,
          match: {},
          response: {
            status: 200,
            headers: {},
            body: '{"id": "{{request.body}}"}',
            template: false,
          },
        },
        {
          example: null,
          recent: { evaluated: 1, matched: 1 },
          warnings: [{ code: 'template_disabled', message: 'Template is off.' }],
        },
      ),
      sugestao(
        { ...REGRA_CERTA, match: { path: { equals: '/mensagens' } } },
        {
          example: null,
          recent: { evaluated: 1, matched: 0 },
          warnings: [{ code: 'path_never_seen', message: 'No recent request has this path.' }],
        },
      ),
    );
    const regra = await abrirEditor(page, tokenId);
    await descrever(regra, 'Ecoar o corpo');
    await regra.getByRole('button', { name: 'Suggest' }).click();

    const itens = conferencias(regra);
    await expect(
      itens.filter({
        hasText: 'The body has {{…}} but Template is off: it would be sent as text.',
      }),
    ).toHaveText(/^\s*Problem\b/);
    await expect(
      itens.filter({ hasText: 'No conditions: it would answer every request.' }),
    ).toHaveCount(1);

    await proposta(regra).getByRole('button', { name: 'Dismiss' }).click();
    await descrever(regra, 'Responder 202 em /mensagens');
    await regra.getByRole('button', { name: 'Suggest' }).click();
    await expect(
      conferencias(regra).filter({ hasText: 'Path /mensagens was never received.' }),
    ).toHaveText(/^\s*Problem\b/);
    await expect(
      conferencias(regra).filter({ hasText: /Would match none of the last 1 requests?\./ }),
    ).toHaveCount(1);
  });

  test('deve dizer que uma regra só não faz passos em sequência e abrir o assistente', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await editorComExemplo(page, tokens);
    await seedStorage(page, {});
    await ia(
      page,
      tokenId,
      'suggest',
      sugestao(
        { ...REGRA_CERTA, name: 'Falha', response: { status: 503, headers: {}, body: '' } },
        {
          example: null,
          recent: { evaluated: 1, matched: 1 },
          warnings: [
            { code: 'sequence_as_single_rule', message: 'The prompt asks for a sequence.' },
          ],
        },
      ),
    );
    const regra = await abrirEditor(page, tokenId);
    await descrever(regra, 'falhe 3 vezes com 503 e depois responda 200');

    await regra.getByRole('button', { name: 'Suggest' }).click();

    await expect(
      conferencias(regra).filter({
        hasText: 'You asked for steps in sequence. One rule cannot do that.',
      }),
    ).toHaveText(/^\s*Problem\b/);
    await proposta(regra).getByRole('button', { name: 'Open the sequence assistant' }).click();
    await expect(page.getByRole('dialog', { name: 'Sequence' })).toBeVisible();
  });

  test('não deve falar em sequência num pedido de uma resposta só', async ({ page, tokens }) => {
    const { tokenId } = await editorComExemplo(page, tokens);
    await seedStorage(page, {});
    await ia(
      page,
      tokenId,
      'suggest',
      sugestao(REGRA_CERTA, {
        example: null,
        recent: { evaluated: 1, matched: 1 },
        warnings: [],
      }),
    );
    const regra = await abrirEditor(page, tokenId);
    await descrever(regra, 'responda 429 com Retry-After 5 para POST em /pedidos');

    await regra.getByRole('button', { name: 'Suggest' }).click();

    await expect(proposta(regra)).toContainText('Checked: matches 1 of the last 1.');
    await expect(proposta(regra)).not.toContainText('steps in sequence');
    await expect(
      proposta(regra).getByRole('button', { name: 'Open the sequence assistant' }),
    ).toHaveCount(0);
  });

  test('deve dizer que não deu para conferir com o histórico, e manter as outras conferências', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await editorComExemplo(page, tokens);
    await seedStorage(page, {});
    // A conferência com o histórico vem do bloco `check` do servidor ou do `rules/test`: aqui faltam os dois.
    await ia(page, tokenId, 'suggest', {
      corpo: { rule: REGRA_CERTA, explanation: 'Texto do modelo.', attempts: 1 },
    });
    await page.route(new RegExp(`/token/${tokenId}/rules/test(\\?.*)?$`), (rota) =>
      rota.fulfill({ status: 500, json: { error: 'boom' } }),
    );
    const regra = await abrirEditor(page, tokenId);
    await descrever(regra, 'Responder 202 para pedidos pagos');

    await regra.getByRole('button', { name: 'Suggest' }).click();

    await expect(
      conferencias(regra).filter({ hasText: 'Could not check against the history.' }),
    ).toHaveText(/^\s*Attention\b/);
    await expect(conferencias(regra).filter({ hasText: /^\s*OK\b/ })).not.toHaveCount(0);
    await expect(proposta(regra)).toContainText(NOTA);
  });
});

test.describe('Dado a espera da IA', () => {
  test('deve dizer o tempo de costume uma vez, mostrar o contador fora da fala e cancelar sem mudar nada', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await editorComExemplo(page, tokens);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const pedidos = await ia(page, tokenId, 'suggest', {
      atrasoMs: 8_000,
      corpo: { rule: REGRA_CERTA, explanation: 'x', attempts: 1, check: null },
    });
    const regra = await abrirEditor(page, tokenId);
    await descrever(regra, 'Responder 202 para pedidos pagos');
    await expect(andamento(page)).toHaveText('');
    await limparAnuncios(page);

    await regra.getByRole('button', { name: 'Suggest' }).click();

    await expect(andamento(page)).toHaveText('Asking the local model. It usually takes about 5 s.');
    await expect(regra).not.toContainText('The first call can take up to ~30 s');
    const contador = regra.getByText(/^\d+ s$/);
    await expect(contador).toBeVisible();
    expect(
      await contador.evaluate((el) => !!el.closest('[aria-hidden="true"]')),
      'o contador fica fora da fala',
    ).toBe(true);
    // A espera não bloqueia o editor.
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Enquanto espero');
    await page.waitForTimeout(2_000);
    await expectUmAnuncio(page, /^Asking the local model\./, /^AI progress$/);
    await limparAnuncios(page);

    await regra.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expectUmAnuncio(page, /^Cancelled\. Nothing was changed\.$/, /^AI progress$/);
    await expect(proposta(regra)).toHaveCount(0);
    await expect(regra.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Enquanto espero',
    );
    await expect(regra.getByRole('button', { name: 'Suggest' })).toBeEnabled();
    expect(pedidos).toHaveLength(1);
    await expect.poll(() => pedidos[0].failure()?.errorText ?? '').toMatch(/abort/i);
  });

  test('deve avisar uma vez que ainda espera, passado o dobro do tempo de costume', async ({
    page,
    tokens,
  }) => {
    test.setTimeout(60_000);
    const { tokenId } = await editorComExemplo(page, tokens);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await ia(page, tokenId, 'suggest', {
      atrasoMs: 14_000,
      ...sugestao(REGRA_CERTA, {
        example: null,
        recent: { evaluated: 1, matched: 1 },
        warnings: [],
      }),
    });
    const regra = await abrirEditor(page, tokenId);
    await descrever(regra, 'Responder 202 para pedidos pagos');
    await limparAnuncios(page);

    await regra.getByRole('button', { name: 'Suggest' }).click();

    await expect(andamento(page)).toHaveText('Still waiting. It can take up to 90 s.', {
      timeout: 13_000,
    });
    await expect(proposta(regra)).toContainText('Checked: matches 1 of the last 1.', {
      timeout: 10_000,
    });
    await expectUmAnuncio(page, /^Still waiting\. It can take up to 90 s\.$/, /^AI progress$/);
    await expectUmAnuncio(page, /^Asking the local model\./, /^AI progress$/);
  });

  test('deve pedir a sugestão com Enter e cancelar com Esc', async ({ page, tokens }) => {
    test.skip(compacto(page), 'teclado: só no desktop');
    const { tokenId } = await editorComExemplo(page, tokens);
    await seedStorage(page, {});
    const pedidos = await ia(page, tokenId, 'suggest', {
      atrasoMs: 6_000,
      corpo: { rule: REGRA_CERTA, explanation: 'x', attempts: 1, check: null },
    });
    const regra = await abrirEditor(page, tokenId);
    const campo = await descrever(regra, 'Responder 202 para pedidos pagos');

    await campo.press('Shift+Enter');
    expect(pedidos).toHaveLength(0);
    await campo.press('Enter');
    await expect(andamento(page)).toContainText('Asking the local model.');
    expect(pedidos).toHaveLength(1);

    await page.keyboard.press('Escape');
    await expect(andamento(page)).toContainText('Cancelled. Nothing was changed.');
    await expect(regra).toBeVisible();
  });
});

test.describe('Dado a explicação de uma requisição', () => {
  const EXPLICACAO = { explanation: 'A requisição recebeu a **resposta padrão**.' };

  function explicacao(page: Page): Locator {
    return page.getByRole('region', { name: 'Explanation' });
  }

  async function esconder(page: Page): Promise<void> {
    const fechar = page
      .getByRole('region', { name: 'Action panel' })
      .getByRole('button', { name: 'Close panel' })
      .or(
        page
          .getByRole('dialog', { name: 'Actions on this request' })
          .getByRole('button', { name: 'Close', exact: true }),
      );
    if (await fechar.isVisible()) {
      await fechar.click();
      return;
    }
    await acaoDaMensagem(page, 'Hide explanation');
  }

  test('deve anunciar a espera e a chegada uma vez, e guardar a resposta para reabrir na hora', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, { data: '{"valor":10}' });
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const pedidos = await ia(page, tokenId, 'explain', { atrasoMs: 1_500, corpo: EXPLICACAO });
    await abrirMensagem(page, tokenId, id);
    await limparAnuncios(page);

    await acaoDaMensagem(page, 'Explain');

    await expect(andamento(page)).toHaveText('Asking the local model. It usually takes about 9 s.');
    await expect(explicacao(page).locator('strong')).toHaveText('resposta padrão');
    await expectUmAnuncio(page, /^Asking the local model\./, /^AI progress$/);
    await expectUmAnuncio(page, /^Explanation ready\.$/, /^AI progress$/);
    const guardadas = Object.keys(await readStorage(page)).length;
    expect(guardadas, 'a explicação não vai para o localStorage').toBe(
      Object.keys(await readStorage(page)).filter((k) => !k.startsWith('anzol.ai.')).length,
    );
    expect(
      await page.evaluate(
        (prefixo) => Object.keys(sessionStorage).filter((k) => k.startsWith(prefixo)),
        `anzol.ai.${tokenId}.${id}.`,
      ),
    ).toHaveLength(1);

    await esconder(page);
    await limparAnuncios(page);
    await acaoDaMensagem(page, 'Explain');

    await expect(explicacao(page).locator('strong')).toHaveText('resposta padrão');
    await expect(explicacao(page)).toContainText(/Answered at \d{1,2}:\d{2}, in \d+(\.\d)? s\./);
    expect(pedidos, 'reabrir não gasta outra chamada').toHaveLength(1);
    await expectSemAnuncio(page, /^Asking the local model\./);

    await explicacao(page).getByRole('button', { name: 'Ask again' }).click();
    await expect.poll(() => pedidos.length).toBe(2);
  });

  test('não deve cancelar ao trocar de requisição: avisa quando a explicação fica pronta', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'lista e detalhe lado a lado: só no desktop');
    const tokenId = await tokens.create();
    const outra = await tokens.send(tokenId, { path: '/outra' });
    const id = await tokens.send(tokenId, { path: '/pedida' });
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const pedidos = await ia(page, tokenId, 'explain', { atrasoMs: 3_000, corpo: EXPLICACAO });
    await abrirMensagem(page, tokenId, id);
    await acoes(page).getByRole('button', { name: 'Explain' }).click();
    await expect(andamento(page)).toContainText('Asking the local model.');
    await limparAnuncios(page);

    await abrirItem(page, outra).click();
    await expect(detalhes(page)).toContainText(outra);

    await expectUmAnuncio(page, new RegExp(`^Explanation for #${id5(id)} is ready\\.`));
    expect(pedidos[0].failure(), 'o pedido não foi cancelado').toBeNull();
    await page
      .locator('.mat-mdc-snack-bar-container')
      .getByRole('button', { name: 'Open', exact: true })
      .click();
    await expect(detalhes(page)).toContainText(id);
    await expect(explicacao(page).locator('strong')).toHaveText('resposta padrão');
    expect(pedidos).toHaveLength(1);
  });
});

test.describe('Dado o idioma da tela e o do navegador', () => {
  test.use({ locale: 'en-US' });

  test('deve pedir a explicação e a sugestão no idioma escolhido na tela', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, { data: 'x' });
    await seedStorage(page, { language: '"pt-BR"' });
    const explicacoes = await ia(page, tokenId, 'explain', { corpo: { explanation: 'ok' } });
    const sugestoes = await ia(
      page,
      tokenId,
      'suggest',
      sugestao(REGRA_CERTA, { example: null, recent: { evaluated: 1, matched: 0 }, warnings: [] }),
    );
    await page.goto(`/#/${tokenId}/${id}/1`);
    await expect(page.getByRole('group', { name: 'Metadados da requisição' })).toContainText(id);

    const explicar = page.getByRole('button', { name: 'Explicar', exact: true });
    if (await explicar.isVisible()) {
      await explicar.click();
    } else {
      await page.getByRole('button', { name: /^Mais(:|$)/ }).click();
      await page.getByRole('menuitem', { name: 'Explicar', exact: true }).click();
    }
    await expect.poll(() => explicacoes.length).toBe(1);
    expect(explicacoes[0].postDataJSON()).toMatchObject({ lang: 'pt-BR' });

    await page.goto(`/#/${tokenId}/rules/new`);
    const regra = page.getByRole('region', { name: 'Nova regra', exact: true });
    await regra.getByText('Descreva a regra', { exact: true }).click();
    await regra.getByRole('textbox', { name: 'Descreva a regra' }).fill('responder 202');
    await regra.getByRole('button', { name: 'Sugerir', exact: true }).click();
    await expect.poll(() => sugestoes.length).toBe(1);
    expect(sugestoes[0].postDataJSON()).toMatchObject({ lang: 'pt-BR' });
  });
});

test.describe('Dado a IA desligada ou no limite', () => {
  test('deve desligar "Explain" e "Suggest" com a razão, sem instrução de operador, e manter a explicação determinística', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_status: '429' });
    const id = await tokens.send(tokenId, { data: 'x' });
    await seedStorage(page, {});
    await ia(page, tokenId, 'explain', { status: 503, corpo: { error: 'AI is not configured' } });
    await ia(page, tokenId, 'suggest', { status: 503, corpo: { error: 'AI is not configured' } });
    await abrirMensagem(page, tokenId, id);

    await acaoDaMensagem(page, 'Explain');

    await expect(page.getByText('This server has no local AI.').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'How to turn it on' }).first()).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/ANZOL_AI|docker/);
    await expect(page.getByRole('heading', { name: 'What the checks say' })).toBeVisible();

    const regra = await abrirEditor(page, tokenId);
    await regra.getByText('Describe the rule', { exact: true }).click();
    const sugerir = regra.getByRole('button', { name: 'Suggest' });
    await expect(sugerir).toHaveAttribute('aria-disabled', 'true');
    await expect(sugerir).toHaveAccessibleDescription(/This server has no local AI\./);
    await expect(regra.getByRole('link', { name: 'How to turn it on' })).toBeVisible();
  });

  test('deve segurar o pedido seguinte com a contagem à vista até poder tentar de novo', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await editorComExemplo(page, tokens);
    await seedStorage(page, {});
    await ia(
      page,
      tokenId,
      'suggest',
      {
        status: 429,
        cabecalhos: { 'Retry-After': '4' },
        corpo: { error: 'Too many AI calls for this URL' },
      },
      sugestao(REGRA_CERTA, { example: null, recent: { evaluated: 1, matched: 1 }, warnings: [] }),
    );
    const regra = await abrirEditor(page, tokenId);
    await descrever(regra, 'Responder 202 para pedidos pagos');

    await regra.getByRole('button', { name: 'Suggest' }).click();

    await expect(regra.getByRole('alert', { name: 'Suggestion errors' })).toContainText(
      'Too many AI calls for this URL',
    );
    const denovo = regra.getByRole('button', { name: /^(Try again|Suggest)\b/ });
    await expect(denovo).toHaveAttribute('aria-disabled', 'true');
    await expect(regra.getByText(/\b[1-4] s\b/).first()).toBeVisible();
    await expect(denovo).not.toHaveAttribute('aria-disabled', 'true', { timeout: 8_000 });
    await denovo.click();
    await expect(proposta(regra)).toContainText('Checked: matches 1 of the last 1.');
  });
});

test.describe('Dado uma sugestão aplicada', () => {
  test('deve gravar a regra só no Save, e ela responder como a conferência disse', async ({
    page,
    request,
    tokens,
  }) => {
    const { tokenId, exemplo } = await editorComExemplo(page, tokens);
    // A sugestão (prioridade 5) entra entre as duas: na frente de todas, a conferência acusaria problema.
    await gravarRegras(request, tokenId, [
      {
        name: 'Primeiro',
        priority: 1,
        match: { path: { equals: '/outra' } },
        response: { status: 200 },
      },
      { name: 'Tudo o resto', priority: 9, response: { status: 404 } },
    ]);
    await seedStorage(page, {});
    await ia(
      page,
      tokenId,
      'suggest',
      sugestao(REGRA_CERTA, {
        example: { matches: true, failed: [], conditions: [] },
        recent: { evaluated: 1, matched: 1 },
        warnings: [],
      }),
    );
    const regra = await abrirEditor(page, tokenId, exemplo);
    await descrever(regra, 'Responder 202 para pedidos pagos', true);
    await regra.getByRole('button', { name: 'Suggest' }).click();
    await expect(
      conferencias(regra).filter({ hasText: /Enters at position 2 of 3, before "Tudo o resto"/ }),
    ).toHaveText(/^\s*OK\b/);

    const aplicar = proposta(regra).getByRole('button', { name: 'Apply all' });
    await expect(aplicar).not.toHaveAttribute('aria-disabled', 'true');
    await aplicar.click();
    expect((await lerRegras(request, tokenId)).map((r) => r.name)).toEqual([
      'Primeiro',
      'Tudo o resto',
    ]);
    await regra.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(regra).toBeHidden();

    expect((await lerRegras(request, tokenId)).map((r) => r.name)).toEqual([
      'Primeiro',
      'Pedido pago',
      'Tudo o resto',
    ]);
    const resposta = await request.post(`/${tokenId}/pedidos`, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"id":"evt_2","status":"pago"}',
    });
    expect(resposta.status()).toBe(202);
  });
});
