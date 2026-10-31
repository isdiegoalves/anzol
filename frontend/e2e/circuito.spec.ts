import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { TokenTracker, expect, test } from './support/fixtures';
import { abrirMensagem, itens } from './support/inbox';
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
const no = (page: Page, nome: RegExp) =>
  page.getByRole('toolbar', { name: 'Circuit nodes' }).getByRole('button', { name: nome });
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
    // 401 de regra: tinta neutra, sem vermelho (VS-02/03).
    expect(await cor(resposta, 'color')).toBe(await token(page, '--mat-sys-on-surface'));
    const falha = rotulo(page, 'invalid · GitHub');
    await expect(falha).toBeVisible();
    expect(await cor(falha, 'border-left-width')).toBe('2px');
    expect(await cor(falha.locator('.glyph'), 'color')).toBe(await token(page, '--mat-sys-error'));
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
    expect(await circuito(page).evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(
      0,
    );
    await expect(p1).toHaveAttribute('aria-pressed', 'true');
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

    const barra = page.getByRole('toolbar', { name: 'Circuit nodes' });
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
    await page.keyboard.press('ArrowRight');
    await expect(no(page, /^Signature/)).toBeFocused();
    // Uma parada só: o Tab seguinte sai da barra.
    await page.keyboard.press('Tab');
    expect(await barra.evaluate((el) => el.contains(document.activeElement))).toBe(false);
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
