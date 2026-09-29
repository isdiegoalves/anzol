import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import {
  abrirRegra,
  abrirRegras,
  alertaParaCorrigir,
  gravarRegras,
  lerRegras,
  linhaDaRegra,
  novaRegra,
  parte,
  salvarRegra,
} from './support/regras';
import { seedStorage } from './support/storage';

const FALHAS_DE_HOJE = [
  'Connection reset (TCP RST)',
  'Empty response (close without writing)',
  'Malformed chunk (valid status and headers)',
  'Random data, then close',
];
const HANG = 'Hang (no response until the client gives up)';
const STALL = 'Stall after headers (status and headers, then nothing)';
const TRUNCATED = 'Truncated body (half the body, then close)';

async function escolher(page: Page, campo: Locator, opcao: string): Promise<void> {
  await campo.click();
  await page.getByRole('option', { name: opcao, exact: true }).click();
}

async function regraNova(page: Page, nome: string): Promise<Locator> {
  const regiao = await novaRegra(page);
  await regiao.getByRole('textbox', { name: 'Name', exact: true }).fill(nome);
  return regiao;
}

test.describe('Dado o editor de regra na aba Response', () => {
  test('deve oferecer "Hang", "Stall after headers" e "Truncated body" junto das falhas de hoje', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regiao = await regraNova(page, 'Falhas');
    await parte(regiao, 'Response');

    await regiao.getByRole('combobox', { name: 'Fault' }).click();
    for (const nome of [...FALHAS_DE_HOJE, HANG, STALL, TRUNCATED]) {
      await expect(page.getByRole('option', { name: nome, exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');
  });

  test('deve gravar "hang", dizer que nada é enviado até o cliente desistir e ignorar status e corpo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regiao = await regraNova(page, 'Trava');
    await parte(regiao, 'Response');

    await escolher(page, regiao.getByRole('combobox', { name: 'Fault' }), HANG);

    await expect(regiao.getByRole('note')).toContainText(
      'The request is recorded, then nothing is sent until the client gives up (at most 5 minutes).',
    );
    await expect(regiao.getByRole('spinbutton', { name: 'Status' })).toBeDisabled();
    await salvarRegra(page, regiao, tokenId);
    expect(await lerRegras(request, tokenId)).toEqual([
      expect.objectContaining({ response: expect.objectContaining({ fault: 'hang' }) }),
    ]);
    await expect(linhaDaRegra(page, 'Trava').locator('.status')).toContainText('Hang');
  });

  test('deve manter status e corpo com "Truncated body" e exigir corpo para salvar', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regiao = await regraNova(page, 'Corta');
    await parte(regiao, 'Response');

    await escolher(page, regiao.getByRole('combobox', { name: 'Fault' }), TRUNCATED);

    await expect(regiao.getByRole('note')).toContainText(
      'the status, headers and half the body are sent, then the connection closes',
    );
    await expect(regiao.getByRole('spinbutton', { name: 'Status' })).toBeEnabled();
    const corpo = regiao.getByRole('textbox', { name: 'Response body' });
    await expect(corpo).toBeEnabled();
    await regiao.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(alertaParaCorrigir(regiao)).toContainText('Response body');
    await expect(regiao.getByText('A body is required for this fault.')).toBeVisible();
    expect(await lerRegras(request, tokenId)).toEqual([]);

    await corpo.fill('{"ok":true}');
    await salvarRegra(page, regiao, tokenId);
    expect(await lerRegras(request, tokenId)).toEqual([
      expect.objectContaining({
        response: expect.objectContaining({ fault: 'truncated_body', body: '{"ok":true}' }),
      }),
    ]);
  });

  test('deve explicar "Stall after headers" com o Content-Length do corpo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regiao = await regraNova(page, 'Parada');
    await parte(regiao, 'Response');

    await escolher(page, regiao.getByRole('combobox', { name: 'Fault' }), STALL);

    await expect(regiao.getByRole('note')).toContainText(
      "the status and headers are sent (with the body's Content-Length), then nothing until the client gives up",
    );
    await expect(regiao.getByRole('textbox', { name: 'Response body' })).toBeEnabled();
  });
});

test.describe('Dado o editor de regra na aba Match: chance e janela de tempo', () => {
  test('deve gravar a chance e mostrá-la na lista', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regiao = await regraNova(page, 'Instável');
    await parte(regiao, 'Match');

    await expect(regiao.getByRole('heading', { name: 'Chance and time window' })).toBeVisible();
    await regiao.getByRole('spinbutton', { name: 'Chance (%)' }).fill('30');
    await salvarRegra(page, regiao, tokenId);

    expect(await lerRegras(request, tokenId)).toEqual([expect.objectContaining({ chance: 30 })]);
    await expect(
      linhaDaRegra(page, 'Instável').locator('.flag', { hasText: 'Chance' }),
    ).toHaveAttribute('title', 'Chance: 30% of the matching requests');
  });

  test('deve recusar chance fora de 1 a 100 sem salvar', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regiao = await regraNova(page, 'Chance ruim');
    await parte(regiao, 'Match');

    const chance = regiao.getByRole('spinbutton', { name: 'Chance (%)' });
    await chance.fill('0');
    await chance.blur();
    await expect(regiao.getByText('An integer between 1 and 100.')).toBeVisible();
    await regiao.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(chance).toBeFocused();
    expect(await lerRegras(request, tokenId)).toEqual([]);
  });

  test('deve gravar "For the next minutes" como a janela de agora até agora mais N minutos', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regiao = await regraNova(page, 'Manutenção');
    await parte(regiao, 'Match');

    const janela = regiao.getByRole('radiogroup', { name: 'Time window' });
    await expect(janela.getByRole('radio', { name: 'Always' })).toBeChecked();
    await janela.getByRole('radio', { name: 'For the next minutes' }).check();
    await regiao.getByRole('spinbutton', { name: 'Minutes', exact: true }).fill('15');
    const antes = Date.now();
    await salvarRegra(page, regiao, tokenId);
    const depois = Date.now();

    const [regra] = await lerRegras(request, tokenId);
    const de = Date.parse(String(regra['active_from']));
    const ate = Date.parse(String(regra['active_until']));
    expect(de).toBeGreaterThanOrEqual(Math.floor(antes / 1000) * 1000 - 2000);
    expect(de).toBeLessThanOrEqual(depois + 2000);
    expect(ate - de).toBe(15 * 60 * 1000);
    await expect(
      linhaDaRegra(page, 'Manutenção').locator('.flag', { hasText: 'Window' }),
    ).toHaveAttribute(
      'title',
      `Active from ${String(regra['active_from'])} until ${String(regra['active_until'])} (UTC)`,
    );
  });

  test('deve abrir uma regra com janela em "Between dates" com as datas guardadas', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      {
        name: 'Com janela',
        active_from: '2026-09-29T12:00:00Z',
        active_until: '2099-01-01T00:00:00Z',
        response: { status: 503 },
      },
    ]);
    await abrirRegras(page, tokenId);
    const regiao = await abrirRegra(page, 'Com janela');
    await parte(regiao, 'Match');

    await expect(
      regiao
        .getByRole('radiogroup', { name: 'Time window' })
        .getByRole('radio', { name: 'Between dates' }),
    ).toBeChecked();
    await expect(regiao.getByRole('textbox', { name: 'Active from (UTC)' })).toHaveValue(
      '2026-09-29T12:00:00Z',
    );
    await expect(regiao.getByRole('textbox', { name: 'Active until (UTC)' })).toHaveValue(
      '2099-01-01T00:00:00Z',
    );
  });

  test('deve mostrar as falhas novas e a seção de chance em pt-BR', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, { language: '"pt-BR"' });
    await page.goto(`/#/${tokenId}/rules`);
    await page.getByRole('button', { name: 'Nova regra', exact: true }).click();
    const regiao = page.getByRole('region', { name: 'Nova regra', exact: true });
    const abas = regiao.getByRole('tablist', { name: 'Partes da regra' });

    await abas.getByRole('tab', { name: 'Condições', exact: true }).click();
    await expect(regiao.getByRole('heading', { name: 'Chance e janela de tempo' })).toBeVisible();
    await expect(
      regiao
        .getByRole('radiogroup', { name: 'Janela de tempo' })
        .getByRole('radio', { name: 'Pelos próximos minutos' }),
    ).toBeVisible();
    await abas.getByRole('tab', { name: 'Resposta', exact: true }).click();
    await regiao.getByRole('combobox', { name: 'Falha' }).click();
    for (const nome of [
      'Travar (sem resposta até o cliente desistir)',
      'Parar depois dos cabeçalhos (status e cabeçalhos, depois nada)',
      'Corpo cortado (metade do corpo, depois fecha)',
    ]) {
      await expect(page.getByRole('option', { name: nome, exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');
  });
});

test.describe('Dado uma mensagem que o sorteio da regra pulou', () => {
  test('deve mostrar o número sorteado no trace da regra, traduzido em pt-BR', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Moeda', priority: 1, chance: 1, response: { status: 201 } },
      { name: 'Resto', priority: 2, response: { status: 202 } },
    ]);
    let pulada: string | undefined;
    for (let i = 0; i < 20 && !pulada; i++) {
      const resposta = await request.post(`/${tokenId}`, { data: 'x' });
      if (resposta.status() === 202) {
        pulada = resposta.headers()['x-request-id'];
      }
    }
    expect(pulada, 'com chance 1, alguma de 20 requisições é pulada').toBeDefined();
    await seedStorage(page, { language: '"pt-BR"' });
    await page.goto(`/#/${tokenId}/${pulada}/1`);

    await page
      .getByRole('group', { name: 'Verificações desta requisição' })
      .getByRole('button', { name: 'Por que não a regra…?' })
      .click();
    await page
      .getByRole('menu', { name: 'Regras' })
      .getByRole('menuitem', { name: 'Moeda', exact: true })
      .click();
    const trace = page.getByRole('region', { name: 'Avaliação das regras' });
    await expect(trace.getByRole('listitem').filter({ hasText: /^\s*#1 Moeda/ })).toContainText(
      /não casou: chance de 1%: sorteou \d+, não aplicou/,
    );
  });
});
