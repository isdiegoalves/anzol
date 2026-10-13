import { APIRequestContext, Locator, Page } from '@playwright/test';
import { TokenTracker, expect, test } from './support/fixtures';
import {
  abrirRegra,
  abrirRegras,
  arquivoDeRegras,
  celular,
  dialogo,
  editor,
  gravarRegras,
  importar,
  linhaDaRegra,
} from './support/regras';

// UX de Regras, fatia F8 — celular (WM-41; guia-ux §3.8; CA-11). Abaixo de 1200 px o editor é folha de tela cheia
// com cabeçalho fixo ("Back to list", nome, "Save", ⋮ "More actions"), abas numa faixa de uma linha, "Details"
// recolhido; a lista mantém as 3 linhas, a alça, o interruptor e ↑/↓ por item, alvos ≥ 44 px e nada de rolagem
// lateral a 320 px; diálogos na largura toda com 16 px de margem e o botão primário por último. Roda no projeto
// `mobile` (390 px, toque); o caso de 1024 px roda no `ui`. SUPOSIÇÕES:
// - SUPOSIÇÃO: "Details" é um `<details>` cujo `summary` começa por "Details" (o guia mostra "Details (Priority 2 ·
//   Enabled)").
// - SUPOSIÇÃO: "botões empilhados, o primário por último" = cada botão numa linha, o primário abaixo dos outros.

const PIX = {
  name: 'Pix pago com um nome comprido para quebrar a linha no celular',
  priority: 2,
  match: {
    method: ['POST'],
    path: { equals: '/pagamentos/confirmacoes/instantaneas/com/um/caminho/longo' },
    headers: { 'X-Tenant': { equals: 'acme-empresa-de-teste-com-nome-longo' } },
    body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
  },
  response: { status: 201 },
};
const OUTRA = { name: 'Outra', priority: 3, response: { status: 202 } };

/** Maior rolagem lateral da página ou de um contêiner que rola. */
function rolagemLateral(page: Page): Promise<number> {
  return page.evaluate(() => {
    let maior = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    for (const no of document.querySelectorAll('body *')) {
      const estilo = getComputedStyle(no);
      if (['auto', 'scroll'].includes(estilo.overflowX) && no.getAttribute('role') !== 'tablist') {
        maior = Math.max(maior, no.scrollWidth - no.clientWidth);
      }
    }
    return maior;
  });
}

async function alvo(locator: Locator): Promise<{ width: number; height: number }> {
  const caixa = await locator.boundingBox();
  return { width: caixa?.width ?? 0, height: caixa?.height ?? 0 };
}

/**
 * Anda com a tecla e devolve os elementos do shell (o rail, o cabeçalho da URL) que receberam o foco escondidos
 * atrás de outra coisa. O que está dentro do editor não conta: é a própria folha.
 */
async function focosEscondidos(
  page: Page,
  tecla: 'Tab' | 'Shift+Tab',
  passos: number,
): Promise<string[]> {
  const escondidos = new Set<string>();
  for (let passo = 0; passo < passos; passo++) {
    await page.keyboard.press(tecla);
    const escondido = await page.evaluate(() => {
      const foco = document.activeElement;
      if (!foco || foco === document.body || foco.closest('app-rule-editor')) {
        return null;
      }
      const caixa = foco.getBoundingClientRect();
      const noTopo = document.elementFromPoint(
        caixa.left + caixa.width / 2,
        caixa.top + caixa.height / 2,
      );
      const aVista = !!noTopo && (foco.contains(noTopo) || noTopo.contains(foco));
      return aVista ? null : (foco.getAttribute('aria-label') ?? foco.textContent ?? '').trim();
    });
    if (escondido !== null) {
      escondidos.add(escondido.slice(0, 40));
    }
  }
  return [...escondidos];
}

/** A folha aberta pelo teclado: o Tab não sai para trás dela, e o Esc devolve o foco à regra da lista. */
async function conferirAFolhaNoTeclado(
  page: Page,
  request: APIRequestContext,
  tokens: TokenTracker,
): Promise<void> {
  const tokenId = await tokens.create();
  await gravarRegras(request, tokenId, [PIX, OUTRA]);
  await abrirRegras(page, tokenId);
  const naLista = linhaDaRegra(page, PIX.name).locator('td.item').getByRole('button');
  await naLista.focus();
  await page.keyboard.press('Enter');
  const regra = editor(page, `Edit rule ${PIX.name}`);
  await expect(regra).toBeVisible();

  expect(await focosEscondidos(page, 'Tab', 100), 'com o Tab').toEqual([]);
  expect(await focosEscondidos(page, 'Shift+Tab', 100), 'com o Shift+Tab').toEqual([]);

  await regra.getByRole('textbox', { name: 'Name', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(regra).toBeHidden();
  await expect(naLista).toBeFocused();
}

test.describe('Dado o editor abaixo de 1200 px (WM-41)', () => {
  test.beforeEach(({ page }) => {
    test.skip(!celular(page), 'só abaixo de 1200 px: o projeto mobile');
  });

  test('não deve deixar o Tab pousar no que a folha cobre, e deve devolver o foco à regra no Esc', async ({
    page,
    request,
    tokens,
  }) => {
    await conferirAFolhaNoTeclado(page, request, tokens);
  });

  test('deve abrir como folha de tela cheia com "Back to list", nome, Save e ⋮ fixos no topo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX, OUTRA]);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, PIX.name);

    const largura = page.viewportSize()!.width;
    const caixa = await regra.boundingBox();
    expect(caixa!.x).toBeLessThanOrEqual(1);
    expect(caixa!.width).toBeGreaterThanOrEqual(largura - 2);
    await expect(page.getByRole('table', { name: 'Rules' })).not.toBeInViewport();

    const voltar = regra.getByRole('button', { name: 'Back to list', exact: true });
    const salvar = regra.getByRole('button', { name: 'Save', exact: true });
    const mais = regra.getByRole('button', { name: 'More actions', exact: true });
    await expect(voltar).toBeInViewport();
    await expect(salvar).toBeInViewport();
    await expect(mais).toBeInViewport();
    await expect(regra.getByRole('textbox', { name: 'Name', exact: true })).toBeInViewport();
    await expect(regra.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0);
    await expect(regra.getByRole('button', { name: 'Delete rule', exact: true })).toHaveCount(0);

    // Cabeçalho fixo: o Save continua à vista depois de rolar até o fim da folha.
    await regra.getByRole('radiogroup', { name: 'Schema' }).scrollIntoViewIfNeeded();
    await expect(salvar).toBeInViewport();

    await mais.click();
    for (const item of ['Duplicate rule', 'Delete rule', 'Discard']) {
      await expect(page.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');

    await voltar.click();
    await expect(regra).toBeHidden();
    // A lista volta à vista pela regra editada; a de baixo pode ficar abaixo da dobra do celular.
    await expect(linhaDaRegra(page, PIX.name)).toBeInViewport();
  });

  test('deve mostrar na primeira tela a frase e a primeira condição, com os detalhes recolhidos', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, PIX.name);

    await expect(regra.getByLabel('Rule in plain words')).toBeInViewport();
    await expect(regra.getByRole('group', { name: 'Methods' })).toBeInViewport();
    const prioridade = regra.getByRole('spinbutton', { name: 'Priority' });
    await expect(prioridade).toBeHidden();
    await regra.locator('details > summary', { hasText: /^\s*Details\b/ }).click();
    await expect(prioridade).toBeVisible();
    await expect(regra.getByRole('switch', { name: 'Enabled' })).toBeVisible();
  });

  test('deve pôr as abas numa faixa de uma linha, sem empurrar a página para o lado', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, PIX.name);

    const abas = regra.getByRole('tablist', { name: 'Rule parts' }).getByRole('tab');
    await expect(abas).toHaveCount(4);
    const alturas = await abas.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    expect(new Set(alturas).size).toBe(1);
    expect(await rolagemLateral(page)).toBeLessThanOrEqual(1);
  });

  test('deve perguntar antes de voltar à lista com alteração não salva', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, PIX.name);
    const nome = regra.getByRole('textbox', { name: 'Name', exact: true });
    await nome.fill('Outro nome');

    await regra.getByRole('button', { name: 'Back to list', exact: true }).click();

    await expect(dialogo(page, 'Discard changes?')).toBeVisible();
  });
});

test.describe('Dado a lista de regras no celular (WM-41, RULES-05; CA-11)', () => {
  test.beforeEach(({ page }) => {
    test.skip(!celular(page), 'só abaixo de 1200 px: o projeto mobile');
  });

  test('deve manter alça, interruptor, ↑/↓ e ⋮ por item com alvos de toque de 44 px', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX, OUTRA]);
    await abrirRegras(page, tokenId);

    const linha = linhaDaRegra(page, 'Outra');
    for (const controle of [
      linha.getByRole('button', { name: 'Reorder Outra' }),
      linha.getByRole('switch', { name: 'Enable rule Outra' }),
      linha.getByRole('button', { name: 'Move up' }),
      linha.getByRole('button', { name: 'More actions for Outra' }),
    ]) {
      await expect(controle).toBeVisible();
      const { width, height } = await alvo(controle);
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(44);
    }
  });

  test('não deve rolar para o lado a 320 px, com nome, caminho e selos longos', async ({
    page,
    request,
    tokens,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      PIX,
      OUTRA,
      { ...PIX, name: `${PIX.name} (copy)`, priority: 4 },
    ]);
    await abrirRegras(page, tokenId);
    await expect(linhaDaRegra(page, PIX.name).locator('.match')).toBeVisible();

    expect(await rolagemLateral(page)).toBeLessThanOrEqual(1);
    for (const parte of ['.name', '.match', '.hits']) {
      const caixa = await linhaDaRegra(page, PIX.name).locator(parte).boundingBox();
      expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(320);
    }
  });

  test('deve abrir os diálogos na largura toda com 16 px de margem e o primário por último', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [OUTRA]);
    await abrirRegras(page, tokenId);

    const janela = await importar(page, arquivoDeRegras([{ name: 'Nova' }]));
    await expect(janela).toBeVisible();
    const largura = page.viewportSize()!.width;
    const caixa = await janela.boundingBox();
    expect(Math.abs(caixa!.x - 16)).toBeLessThanOrEqual(2);
    expect(Math.abs(caixa!.x + caixa!.width - (largura - 16))).toBeLessThanOrEqual(2);
    const cancelar = await janela
      .getByRole('button', { name: 'Cancel', exact: true })
      .boundingBox();
    const mesclar = await janela.getByRole('button', { name: 'Merge', exact: true }).boundingBox();
    expect(mesclar!.y).toBeGreaterThanOrEqual(cancelar!.y + cancelar!.height - 1);
  });
});

test.describe('Dado uma janela de 1024 px (WM-41: folha abaixo de 1200 px)', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('deve abrir o editor como folha com "Back to list"', async ({ page, request, tokens }) => {
    test.skip(!!test.info().project.use.isMobile, 'o caso de 1024 px roda no projeto ui');
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, PIX.name);

    await expect(regra.getByRole('button', { name: 'Back to list', exact: true })).toBeVisible();
    const caixa = await editor(page, `Edit rule ${PIX.name}`).boundingBox();
    expect(caixa!.width).toBeGreaterThanOrEqual(1024 - 2);
  });
});

test.describe('Dado uma janela de 1100 px, em que a folha cobre também o rail', () => {
  test.use({ viewport: { width: 1100, height: 800 } });

  test('não deve deixar o Tab pousar no que a folha cobre, e deve devolver o foco à regra no Esc', async ({
    page,
    request,
    tokens,
  }) => {
    test.skip(!!test.info().project.use.isMobile, 'o caso de 1100 px roda no projeto ui');
    await conferirAFolhaNoTeclado(page, request, tokens);
  });
});

test.describe('Dado o editor ao lado da lista, a partir de 1200 px', () => {
  test('deve deixar o rail e o cabeçalho da URL no Tab', async ({ page, request, tokens }) => {
    test.skip(celular(page), 'só a partir de 1200 px: o projeto ui');
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);
    await abrirRegra(page, PIX.name);

    for (const controle of [
      page.getByRole('button', { name: 'Settings' }),
      page.getByRole('textbox', { name: 'Webhook URL' }),
    ]) {
      await controle.focus();
      await expect(controle).toBeFocused();
    }
  });
});
