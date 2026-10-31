import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { TokenTracker, expect, test } from './support/fixtures';
import { abrirMensagem, itens } from './support/inbox';
import { folhaDeCriarRegra } from './support/regras';
import { seedStorage } from './support/storage';

// Feature "Circuito", F1: o circuito da URL abaixo do cabeçalho da Entrada (demo combinada). O caminho da mensagem
// aberta, o "quase casou" em âmbar, a configuração sem mensagem, o filtro pelo nó, o teclado, as cores e o reflow.

const SEGREDO = 'segredo-circuito';

function assinado(corpo: string, segredo = SEGREDO) {
  return {
    path: '/webhooks/pagamentos',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`,
    },
    data: corpo,
  };
}

/** A URL da demo: assinatura, schema e P1–P3; uma válida (pela padrão, P1 a mais próxima) e uma que não confere. */
/** O teto de `GET /requests` e de `GET /stream` em 3 s sem laço (a abertura e uma volta do tempo real). */
const PEDIDOS_SEM_LACO = 6;

async function urlDaDemo(page: Page, tokens: TokenTracker) {
  const tokenId = await tokens.create({
    signature: { provider: 'github', secret: SEGREDO },
    schema: { type: 'object', required: ['event_id'] },
  });
  const regras = await page.request.put(`/token/${tokenId}/rules`, {
    data: [
      {
        name: 'Assinatura inválida',
        priority: 1,
        match: { signature: 'invalid' },
        response: { status: 401 },
      },
      {
        name: 'Estoque instável',
        priority: 2,
        match: { method: ['PUT'], path: { prefix: '/webhooks/estoque' } },
        response: { fault: 'connection_reset' },
      },
      {
        name: 'Pedido inexistente',
        priority: 3,
        match: { method: ['DELETE'], path: { prefix: '/webhooks/pedidos' } },
        response: { status: 404 },
      },
    ],
  });
  expect(regras.status()).toBe(200);
  const valida = await tokens.send(tokenId, assinado('{"event_id":"evt_1"}'));
  const naoConfere = await tokens.send(tokenId, assinado('{"event_id":"evt_7"}', 'outro'));
  await seedStorage(page, { hideTutorial: 'true' });
  return { tokenId, valida, naoConfere };
}

const circuito = (page: Page) => page.getByRole('region', { name: 'URL circuit' });
const desenho = (page: Page) => circuito(page).getByRole('img');
const nos = (page: Page) => page.getByRole('group', { name: 'Circuit nodes' });
const no = (page: Page, nome: RegExp) => nos(page).getByRole('button', { name: nome });
const rotulo = (page: Page, texto: string) =>
  circuito(page).locator('.lab').filter({ hasText: texto });

async function cor(alvo: Locator, propriedade: string): Promise<string> {
  return alvo.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), propriedade);
}

/** A cor de um token do tema na página, para comparar com a computada. */
async function token(page: Page, nome: string): Promise<string> {
  return page.evaluate((variavel) => {
    const prova = document.createElement('span');
    prova.style.color = `var(${variavel})`;
    document.body.append(prova);
    const valor = getComputedStyle(prova).color;
    prova.remove();
    return valor;
  }, nome);
}

test.describe('Dado o circuito da URL na Entrada', () => {
  test('deve desenhar o caminho da mensagem aberta, com ✓/✗ por nó e o status em tinta neutra (CA-1)', async ({
    page,
    tokens,
  }) => {
    const { tokenId, naoConfere } = await urlDaDemo(page, tokens);
    await abrirMensagem(page, tokenId, naoConfere);

    await expect(desenho(page)).toHaveAccessibleName(
      /path: signature ✗ → schema ✓ → P1 ✓ → 401\.$/,
    );
    const resposta = rotulo(page, '401 · P1');
    await expect(resposta).toBeVisible();
    // O nome comprido de quem respondeu termina em reticências, sem passar por cima do Reenvio (F1-R09).
    expect(await cor(resposta, 'max-width')).toBe('146px');
    expect(await cor(resposta, 'text-overflow')).toBe('ellipsis');
    // 401 de regra: tinta neutra, sem vermelho (VS-02/03).
    expect(await cor(resposta, 'color')).toBe(await token(page, '--mat-sys-on-surface'));
    const falha = rotulo(page, 'invalid · GitHub');
    await expect(falha).toBeVisible();
    expect(await cor(falha, 'border-left-width')).toBe('2px');
    expect(await cor(falha.locator('.glyph'), 'color')).toBe(await token(page, '--mat-sys-error'));
    // Como na demo, só ✗ e ◔ em negrito; o ✓ no peso do texto (F1-R10).
    expect(await cor(falha.locator('.glyph'), 'font-weight')).toBe('700');
    expect(await cor(rotulo(page, 'valid · 2020-12').locator('.glyph'), 'font-weight')).toBe('400');
    // O caminho em tinta, parando em P1.
    await expect(circuito(page).locator('.route path')).toHaveCount(8);
  });

  test('deve pôr "◔ near · missing: signature invalid" em âmbar na mais próxima e tirar com outra aberta (CA-2)', async ({
    page,
    tokens,
  }) => {
    const { tokenId, valida, naoConfere } = await urlDaDemo(page, tokens);
    await abrirMensagem(page, tokenId, valida);

    const quase = rotulo(page, 'near · missing: signature invalid');
    await expect(quase).toHaveText('◔ near · missing: signature invalid');
    expect(await cor(quase, 'color')).toBe(await token(page, '--app-warning'));
    expect(await cor(quase, 'border-left-width')).toBe('2px');
    await expect(desenho(page)).toHaveAccessibleName(/; near match: P1 Assinatura inválida\.$/);

    await page.goto(`/#/${tokenId}/${naoConfere}/1`);
    await expect(desenho(page)).toHaveAccessibleName(/P1 ✓ → 401\.$/);
    await expect(rotulo(page, 'near ·')).toHaveCount(0);
  });

  test('deve mostrar a configuração da URL sem mensagem aberta, e "no rules" na URL sem regras (CA-3)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, { hideTutorial: 'true' });
    await page.goto(`/#/${tokenId}`);

    await expect(desenho(page)).toHaveAccessibleName(/with 4 nodes\. No request open\.$/);
    await expect(rotulo(page, 'no rules')).toBeVisible();
    expect(await cor(rotulo(page, 'no rules'), 'color')).toBe(await token(page, '--app-ink-2'));
    await expect(no(page, /^Signature: off\./)).toBeVisible();
    await expect(no(page, /^Response: default · 200\./)).toBeVisible();
    // Os chips "GitHub · Schema" do cabeçalho viraram nós.
    await expect(page.getByRole('link', { name: /Signature verification/ })).toHaveCount(0);
  });

  test('deve filtrar a lista pelo nó com clique e tirar com outro, sem motion (CA-4)', async ({
    page,
    tokens,
  }) => {
    const { tokenId, valida } = await urlDaDemo(page, tokens);
    await abrirMensagem(page, tokenId, valida);
    await expect(itens(page)).toHaveCount(2);
    const p1 = no(page, /^Rule P1 Assinatura inválida/);
    await expect(p1).toHaveAttribute('aria-pressed', 'false');

    await p1.click();
    await expect(p1).toHaveAttribute('aria-pressed', 'true');
    // Filtrar é ação frequente: nada no circuito anima, nem o contorno que acabou de entrar.
    expect(await circuito(page).evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(
      0,
    );
    await expect(itens(page)).toHaveCount(1);
    expect(await cor(p1, 'border-top-style')).toBe('dashed');
    await expect(page).toHaveURL(/outcome=rule/);

    await p1.click();
    await expect(p1).toHaveAttribute('aria-pressed', 'false');
    await expect(itens(page)).toHaveCount(2);
    await expect(page).not.toHaveURL(/outcome=/);
  });

  test('deve levar o Tab aos nós, com foco visível e as setas andando entre eles (CA-5)', async ({
    page,
    tokens,
  }) => {
    const { tokenId, valida } = await urlDaDemo(page, tokens);
    await abrirMensagem(page, tokenId, valida);

    const barra = nos(page);
    await page.getByRole('textbox', { name: 'Webhook URL' }).focus();
    for (
      let i = 0;
      i < 30 && !(await barra.evaluate((el) => el.contains(document.activeElement)));
      i++
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(no(page, /^Sender/)).toBeFocused();
    expect(await cor(no(page, /^Sender/), 'outline-width')).toBe('3px');
    // Como na demo, cada nó é uma parada do Tab (F1-R05); as setas são atalho a mais.
    await page.keyboard.press('Tab');
    await expect(no(page, /^Signature/)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(no(page, /^Schema/)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(no(page, /^Signature/)).toBeFocused();
  });

  test('deve pôr na escada a regra criada pela folha "Create rule from this request", sem trocar de URL (F1-R01)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, assinado('{"event_id":"evt_1"}'));
    await seedStorage(page, { hideTutorial: 'true' });
    await abrirMensagem(page, tokenId, id);
    await expect(rotulo(page, 'no rules')).toBeVisible();

    await page.getByRole('button', { name: 'Create rule from this request' }).click();
    await folhaDeCriarRegra(page).getByRole('button', { name: 'Create rule' }).click();
    await expect(page.getByRole('group', { name: 'Action result' })).toContainText('Rule created');

    await expect(no(page, /^Rule P\d+ POST \/webhooks\/pagamentos/)).toBeVisible();
    await expect(rotulo(page, 'no rules')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${id}/`));
  });

  test('deve dizer "rules unavailable" quando a leitura das regras falha e tentar de novo sozinho (F1-R02)', async ({
    page,
    tokens,
  }) => {
    const { tokenId, naoConfere } = await urlDaDemo(page, tokens);
    let falhar = true;
    await page.route(/\/token\/[^/]+\/rules$/, (rota) =>
      falhar && rota.request().method() === 'GET' ? rota.fulfill({ status: 503 }) : rota.continue(),
    );
    await page.clock.install();
    await abrirMensagem(page, tokenId, naoConfere);

    await expect(rotulo(page, 'rules unavailable')).toBeVisible();
    expect(await cor(rotulo(page, 'rules unavailable'), 'color')).toBe(
      await token(page, '--app-ink-2'),
    );
    await expect(rotulo(page, 'no rules')).toHaveCount(0);
    // Sem as regras, não se diz onde a anomalia parou: nada de "✗ 1" no nó Assinatura.
    await expect(circuito(page).locator('.lab.note')).toHaveCount(0);

    falhar = false;
    await page.clock.fastForward(16_000);
    await expect(no(page, /^Rule P1 Assinatura inválida/)).toBeVisible();
    await expect(rotulo(page, 'rules unavailable')).toHaveCount(0);
  });

  test('não deve entrar em laço Quando a leitura das regras falha sem resposta (status 0) (F1-R12)', async ({
    page,
    tokens,
  }) => {
    const { tokenId, naoConfere } = await urlDaDemo(page, tokens);
    // Sem resposta nenhuma: o `connectionInterceptor` derruba o tempo real, que volta logo em seguida.
    await page.route(/\/token\/[^/]+\/rules$/, (rota) =>
      rota.request().method() === 'GET' ? rota.abort('failed') : rota.continue(),
    );
    const pedidos = { rules: 0, requests: 0, stream: 0 };
    page.on('request', (pedido) => {
      const caminho = new URL(pedido.url()).pathname;
      if (caminho.endsWith('/rules')) {
        pedidos.rules++;
      } else if (caminho.endsWith('/requests')) {
        pedidos.requests++;
      } else if (caminho.endsWith('/stream')) {
        pedidos.stream++;
      }
    });
    await abrirMensagem(page, tokenId, naoConfere);
    await expect(rotulo(page, 'rules unavailable')).toBeVisible();

    await page.waitForTimeout(3_000);
    expect(pedidos.rules).toBeLessThanOrEqual(2);
    expect(pedidos.requests).toBeLessThanOrEqual(PEDIDOS_SEM_LACO);
    expect(pedidos.stream).toBeLessThanOrEqual(PEDIDOS_SEM_LACO);
    await expect(rotulo(page, 'rules unavailable')).toBeVisible();
  });

  test('deve manter a escada Quando o roteiro "Test a retry" lê as regras e a leitura falha (F1-R13)', async ({
    page,
    tokens,
  }) => {
    const { tokenId, valida } = await urlDaDemo(page, tokens);
    await abrirMensagem(page, tokenId, valida);
    await expect(no(page, /^Rule P1 Assinatura inválida/)).toBeVisible();
    let lidas = 0;
    await page.route(/\/token\/[^/]+\/rules$/, (rota) => {
      if (rota.request().method() !== 'GET') {
        return rota.continue();
      }
      lidas++;
      return rota.fulfill({ status: 503 });
    });

    await page.getByRole('button', { name: 'Guides', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Test a retry', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Guide: Test a retry' })).toBeVisible();
    await expect.poll(() => lidas).toBeGreaterThan(0);

    // A leitura do roteiro falhou, e a lista de antes segue: nada some do circuito.
    await expect(no(page, /^Rule P1 Assinatura inválida/)).toBeVisible();
    await expect(rotulo(page, 'rules unavailable')).toHaveCount(0);
  });

  for (const [largura, altura] of [
    [1366, 768],
    [1280, 800],
  ] as const) {
    test(`deve caber inteiro, sem rolar, a ${largura} × ${altura} (F1-R04)`, async ({
      page,
      tokens,
    }) => {
      await page.setViewportSize({ width: largura, height: altura });
      const { tokenId, valida } = await urlDaDemo(page, tokens);
      await abrirMensagem(page, tokenId, valida);
      await expect(no(page, /^Resend/)).toBeVisible();

      const faixa = circuito(page);
      expect(await faixa.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const [caixa, reenvio] = [await faixa.boundingBox(), await no(page, /^Resend/).boundingBox()];
      expect(reenvio!.x + reenvio!.width).toBeLessThanOrEqual(caixa!.x + caixa!.width);
      // O menor texto do palco (11 px) não fica abaixo de 10 px.
      const zoom = Number(
        await faixa.locator('.stage').evaluate((el) => getComputedStyle(el).zoom),
      );
      expect(11 * zoom).toBeGreaterThanOrEqual(10);
    });
  }

  test('deve rolar por dentro só abaixo do piso legível, com a barra embaixo do palco (F1-R04)', async ({
    page,
    tokens,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    const { tokenId, valida } = await urlDaDemo(page, tokens);
    await abrirMensagem(page, tokenId, valida);
    await expect(no(page, /^Sender/)).toBeVisible();

    const faixa = circuito(page);
    expect(await faixa.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    // A faixa não tem altura fixa: a barra clássica (Windows, Linux) entra embaixo do palco e não cobre a linha de
    // y = 108. O Chromium sem janela esconde a barra, então o teste confere a altura livre (só o mínimo do palco).
    expect(await faixa.evaluate((el) => (el as HTMLElement).style.height)).toBe('');
    expect(await faixa.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
    // A barra de rolagem não cobre a última linha do palco (y = 108).
    expect(
      await faixa.evaluate((el) => {
        const palco = el.querySelector('.stage')?.getBoundingClientRect().height ?? 0;
        return el.clientHeight + 0.5 >= palco;
      }),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1100,
    );
  });

  test('deve dar a todo nó um alvo de 24 × 24 px ou mais (WCAG 2.5.8, F1-R11)', async ({
    page,
    tokens,
  }) => {
    const { tokenId, valida } = await urlDaDemo(page, tokens);
    await abrirMensagem(page, tokenId, valida);
    await expect(no(page, /^Resend/)).toBeVisible();

    const caixas = await nos(page)
      .getByRole('button')
      .evaluateAll((botoes) => botoes.map((b) => b.getBoundingClientRect()));
    expect(caixas.length).toBeGreaterThan(0);
    for (const caixa of caixas) {
      expect(Math.min(caixa.width, caixa.height)).toBeGreaterThanOrEqual(24);
    }
  });

  test.describe('no tema escuro', () => {
    test.use({ colorScheme: 'dark' });

    test('deve manter o caminho, o "quase" e o axe limpo (CA-5)', async ({ page, tokens }) => {
      const { tokenId, valida } = await urlDaDemo(page, tokens);
      await abrirMensagem(page, tokenId, valida);

      const quase = rotulo(page, 'near · missing: signature invalid');
      await expect(quase).toBeVisible();
      expect(await cor(quase, 'color')).toBe(await token(page, '--app-warning'));
    });
  });

  test.describe('com as cores forçadas do sistema', () => {
    test.use({ forcedColors: 'active' });

    test('deve desenhar o caminho em tinta do sistema e o filtro em destaque (CA-5)', async ({
      page,
      tokens,
    }) => {
      const { tokenId, valida } = await urlDaDemo(page, tokens);
      await abrirMensagem(page, tokenId, valida);
      await no(page, /^Rule P1/).click();
      await expect(no(page, /^Rule P1/)).toHaveAttribute('aria-pressed', 'true');

      const caminho = circuito(page).locator('.route path').first();
      expect(await cor(caminho, 'stroke')).toBe(await token(page, '--app-forced-ink'));
      expect(await cor(no(page, /^Rule P1/), 'border-top-color')).toBe(
        await token(page, '--app-forced-selected'),
      );
      // O nó sem filtro continua sem borda: o navegador não desenha uma caixa por nó por cima do desenho.
      expect(await cor(no(page, /^Sender/), 'border-top-color')).toBe('rgba(0, 0, 0, 0)');
    });
  });

  test.describe('no celular de 320 px', () => {
    test.use({ viewport: { width: 320, height: 720 } });

    test('deve mostrar só o caminho da mensagem aberta numa linha que rola, sem rolar a página (CA-5)', async ({
      page,
      tokens,
    }) => {
      const { tokenId, naoConfere } = await urlDaDemo(page, tokens);
      await abrirMensagem(page, tokenId, naoConfere);

      const linha = page.getByRole('region', { name: 'Request path' });
      await expect(linha).toHaveText('path: signature ✗ → schema ✓ → P1 ✓ → 401');
      await expect(circuito(page)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
      // A frase que não cabe rola dentro da linha.
      expect(await cor(linha, 'overflow-x')).toBe('auto');
    });
  });
});
