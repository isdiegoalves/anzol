import { Locator } from '@playwright/test';
import { abrirChecks } from './support/checks';
import { expect, test } from './support/fixtures';
import { abrirFiltros, filtro, lista } from './support/inbox';
import {
  CHAVE_URLS,
  abrirSeletor,
  botaoDeFiltros,
  filtrosLigados,
  listaDeUrls,
  urlInexistente,
  verResultado,
} from './support/patamar';
import { abrirRegras, gravarRegras, novaRegra, parte } from './support/regras';
import { acaoDoShell } from './support/shell';
import { seedStorage } from './support/storage';

/** Dos alvos à vista, os que têm menos de 44 px num dos lados, como `"nome" L×A`. Exige ao menos um alvo. */
async function menoresQue44(alvos: Locator): Promise<string[]> {
  await expect(alvos.first()).toBeVisible();
  // O diálogo do Material abre crescendo: a medida espera ele chegar ao tamanho.
  await alvos
    .page()
    .waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (animacao) =>
            animacao.playState !== 'running' ||
            animacao.effect?.getTiming().iterations === Infinity,
        ),
    );
  return alvos.evaluateAll((elementos) =>
    elementos
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const caixa = el.getBoundingClientRect();
        const nome = el.getAttribute('aria-label') ?? el.textContent ?? '';
        return {
          largura: Math.round(caixa.width),
          altura: Math.round(caixa.height),
          nome: nome.replace(/\s+/g, ' ').trim(),
        };
      })
      .filter(({ largura, altura }) => largura < 44 || altura < 44)
      .map(({ largura, altura, nome }) => `"${nome}" ${largura}×${altura}`),
  );
}

test.describe('Dado um celular com toque', () => {
  test.beforeEach(({ hasTouch }) => {
    test.skip(!hasTouch, 'o alvo de toque só cresce com ponteiro grosso');
  });

  test('deve dar 44 px aos chips da folha "Filters" e aos botões dos filtros ligados', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedidos' });
    await seedStorage(page, { hideTutorial: 'true' });
    await page.goto(`/#/${tokenId}`);
    await abrirFiltros(page);
    const chips = page.getByRole('toolbar', { name: 'Filters' }).locator('button[aria-pressed]');

    expect.soft(await menoresQue44(chips), 'chips').toEqual([]);

    await filtro(page, 'POST').click();
    await verResultado(page);
    await expect(filtrosLigados(page).getByRole('button')).toHaveCount(2);
    expect.soft(await menoresQue44(botaoDeFiltros(page)), 'Filters, 1 active').toEqual([]);
    expect
      .soft(await menoresQue44(filtrosLigados(page).getByRole('button')), 'filtros ligados')
      .toEqual([]);
  });

  test('deve dar 44 px ao campo "Find a URL" do seletor de URLs', async ({ page, tokens }) => {
    const aberta = await tokens.create();
    const outras = Array.from({ length: 7 }, () => ({ uuid: urlInexistente() }));
    await seedStorage(page, { [CHAVE_URLS]: listaDeUrls([{ uuid: aberta }, ...outras]) });
    await page.goto(`/#/${aberta}`);
    const painel = await abrirSeletor(page);

    expect(await menoresQue44(painel.getByRole('searchbox', { name: 'Find a URL' }))).toEqual([]);
  });

  test('deve dar 44 px à pílula das novas requisições, sem cobrir a lista', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 30);
    await seedStorage(page, { hideTutorial: 'true' });
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (30)' })).toBeVisible();
    const janela = lista(page).locator('cdk-virtual-scroll-viewport');
    await janela.evaluate((viewport) => (viewport.scrollTop = 600));
    await tokens.send(tokenId, { path: '/nova' });
    const pilula = page.getByRole('button', { name: '1 new request' });

    expect.soft(await menoresQue44(pilula)).toEqual([]);
    const base = (await pilula.boundingBox())!;
    const topo = (await janela.boundingBox())!;
    expect(base.y + base.height, 'a pílula acaba antes de a lista começar').toBeLessThanOrEqual(
      topo.y,
    );
  });

  test('deve dar 44 px ao campo "Filter rules" e aos chips da lista de regras', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      { name: 'Ligada', priority: 1 },
      { name: 'Desligada', priority: 2, enabled: false },
    ]);
    await abrirRegras(page, tokenId);
    const filtros = page.locator('app-rule-list-filter');

    expect(await menoresQue44(filtros.locator('input, button'))).toEqual([]);
  });

  test('deve dar 44 px aos chips de método, aos alternadores, aos abre-e-fecha e aos helpers do editor de regra', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, {
      path: '/pedidos',
      headers: { 'content-type': 'application/json' },
      data: '{"tipo":"pix"}',
    });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);

    expect
      .soft(
        await menoresQue44(regra.getByRole('group', { name: 'Methods' }).getByRole('button')),
        'chips de método',
      )
      .toEqual([]);
    expect
      .soft(await menoresQue44(regra.locator('.mat-button-toggle-button')), 'alternadores')
      .toEqual([]);
    expect.soft(await menoresQue44(regra.locator('summary')), 'abre-e-fecha').toEqual([]);
    expect
      .soft(await menoresQue44(regra.getByRole('searchbox', { name: 'Filter fields' })), 'campo')
      .toEqual([]);

    await parte(regra, 'Response');
    const helpers = regra.locator('details', { hasText: 'Template helpers' });
    await helpers.evaluate((detalhes: HTMLDetailsElement) => (detalhes.open = true));
    expect.soft(await menoresQue44(helpers.locator('summary')), 'Template helpers').toEqual([]);
    expect
      .soft(await menoresQue44(helpers.getByRole('button', { name: /^Insert / })), 'helpers')
      .toEqual([]);
  });

  test('deve dar 44 px aos botões "Use …" do "From this request" no editor de regra', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, {
      path: '/pedidos',
      headers: { 'content-type': 'application/json', 'x-tenant': 'acme' },
      data: '{"a":1}',
    });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    const campos = regra.getByRole('region', { name: 'From this request' }).getByRole('button');

    await expect(campos.filter({ hasText: 'x-tenant' })).toBeVisible();
    expect(await menoresQue44(campos)).toEqual([]);
  });

  test('deve dar 44 px às opções da folha "Settings"', async ({ page, tokens }) => {
    await page.goto(`/#/${await tokens.create()}/checks`);
    await (await acaoDoShell(page, 'Settings')).click();
    const folha = page.getByRole('dialog', { name: 'Settings' });

    expect(await menoresQue44(folha.locator('label'))).toEqual([]);
  });

  test('deve dar 44 px às opções e ao campo do diálogo "Group by event"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pedidos' });
    await seedStorage(page, { hideTutorial: 'true' });
    await page.goto(`/#/${tokenId}`);
    await abrirFiltros(page);
    await page.getByRole('button', { name: 'Group by event…' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Group by event' });

    expect.soft(await menoresQue44(dialogo.locator('label')), 'opções').toEqual([]);
    expect
      .soft(
        await menoresQue44(dialogo.getByRole('textbox', { name: 'Header name or JSONPath' })),
        'campo',
      )
      .toEqual([]);
  });

  test('deve dar 44 px aos alternadores de algoritmo e de codificação em Verificações', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: {
        provider: 'generic',
        secret: 'segredo-de-teste',
        header: 'X-Signature',
        algorithm: 'sha256',
        encoding: 'hex',
        prefix: 'sha256=',
      },
    });
    const cartao = await abrirChecks(page, tokenId, 'Signature verification');

    expect(await menoresQue44(cartao.getByRole('radiogroup').getByRole('radio'))).toEqual([]);
  });

  test('deve dar 44 px ao "What is a webhook?" das boas-vindas e ao "Data table" de Métricas', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    expect
      .soft(await menoresQue44(page.locator('summary', { hasText: 'What is a webhook?' })))
      .toEqual([]);

    await tokens.send(tokenId, { path: '/pedidos' });
    await page.goto(`/#/${tokenId}/insights`);
    expect.soft(await menoresQue44(page.locator('summary', { hasText: 'Data table' }))).toEqual([]);
  });
});
