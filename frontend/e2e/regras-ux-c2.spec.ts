import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { itens, lista, abrirFiltros } from './support/inbox';
import { abrirRegras, gravarRegras, linhaDaRegra } from './support/regras';
import { estadoAoVivo } from './support/shell';

// UX de Regras, tela de C2 — filtros por desfecho na Entrada e ponto no rail (WM-27, WM-01; guia-ux §3.10; CA-9 na
// parte da Entrada filtrada). Os chips "Answered by rule…", "Near miss of…" e "Default response" no `group
// "Filters"` usam o `outcome` da busca (backend pronto); os acertos da lista de Regras levam à Entrada filtrada; o
// rail marca Regras quando chegaram mensagens sem regra desde a última visita. SUPOSIÇÕES:
// - SUPOSIÇÃO: "Answered by rule…" e "Near miss of…" abrem um `menu` com as regras (`menuitem` pelo nome); o chip
//   ativo passa a se chamar "Answered by: {nome}" / "Near miss of: {nome}" (o "✕" fica fora do nome ou ao fim).
// - SUPOSIÇÃO: o nome do link do rail ganha o sufixo " · {n} requests without a rule" (ou "request" no singular); a
//   visita a Regras grava `rulesSeenAt` e zera o ponto.
// - SUPOSIÇÃO: "· N near misses" na lista de Regras é um `link` à parte.

const PIX = {
  name: 'Pix pago',
  priority: 1,
  match: { method: ['POST'], path: { equals: '/pagamentos' } },
  response: { status: 201 },
};

/** Três mensagens: uma respondida pela Pix, uma perto dela (GET) e uma da resposta padrão (sem perto). */
async function tres(tokens: { send: (t: string, w: object) => Promise<string> }, tokenId: string) {
  const respondida = await tokens.send(tokenId, { path: '/pagamentos' });
  const perto = await tokens.send(tokenId, { method: 'GET', path: '/pagamentos' });
  return { respondida, perto };
}

function chip(page: Page, nome: string | RegExp) {
  return page
    .getByRole('group', { name: 'Filters' })
    .getByRole('button', { name: nome, exact: typeof nome === 'string' });
}

async function abrirEntrada(page: Page, tokenId: string): Promise<void> {
  await page.goto(`/#/${tokenId}`);
  await expect(lista(page)).toBeVisible();
}

test.describe('Dado a Entrada com mensagens de desfechos diferentes (WM-27)', () => {
  test('deve filtrar pelas respondidas por uma regra escolhida no chip "Answered by rule…"', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    const { respondida } = await tres(tokens, tokenId);
    await abrirEntrada(page, tokenId);
    await expect(itens(page)).toHaveCount(2);

    await abrirFiltros(page);
    await chip(page, 'Answered by rule…').click();
    await page.getByRole('menuitem', { name: 'Pix pago', exact: true }).click();

    await abrirFiltros(page);
    await expect(chip(page, /^Answered by: Pix pago/)).toHaveAttribute('aria-pressed', 'true');
    await expect(itens(page)).toHaveCount(1);
    await expect(itens(page).first().getByRole('button').first()).toHaveAccessibleName(
      new RegExp(`#${respondida.substring(0, 5)}`),
    );
  });

  test('deve filtrar os quase acertos de uma regra e as da resposta padrão', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    const { perto } = await tres(tokens, tokenId);
    await abrirEntrada(page, tokenId);

    await abrirFiltros(page);
    await chip(page, 'Near miss of…').click();
    await page.getByRole('menuitem', { name: 'Pix pago', exact: true }).click();
    await abrirFiltros(page);
    await expect(chip(page, /^Near miss of: Pix pago/)).toHaveAttribute('aria-pressed', 'true');
    await expect(itens(page)).toHaveCount(1);
    await expect(itens(page).first().getByRole('button').first()).toHaveAccessibleName(
      new RegExp(`#${perto.substring(0, 5)}`),
    );

    await abrirFiltros(page);
    await chip(page, /^Near miss of: Pix pago/).click();
    await expect(itens(page)).toHaveCount(2);
    await abrirFiltros(page);
    await chip(page, 'Default response').click();
    await abrirFiltros(page);
    await expect(chip(page, 'Default response')).toHaveAttribute('aria-pressed', 'true');
    await expect(itens(page)).toHaveCount(1);
  });
});

test.describe('Dado os acertos na lista de Regras (WM-27; CA-9)', () => {
  test('deve levar da regra à Entrada filtrada pelas mensagens que ela respondeu', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await tres(tokens, tokenId);
    await abrirRegras(page, tokenId);

    await linhaDaRegra(page, 'Pix pago')
      .getByRole('link', { name: 'Answered 1 of the last 2' })
      .click();

    await abrirFiltros(page);
    await expect(chip(page, /^Answered by: Pix pago/)).toHaveAttribute('aria-pressed', 'true');
    await expect(itens(page)).toHaveCount(1);
  });

  test('deve levar do "· 1 near miss" à Entrada filtrada pelos quase acertos', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await tres(tokens, tokenId);
    await abrirRegras(page, tokenId);

    await linhaDaRegra(page, 'Pix pago')
      .getByRole('link', { name: /1 near miss(es)?/ })
      .click();

    await abrirFiltros(page);
    await expect(chip(page, /^Near miss of: Pix pago/)).toHaveAttribute('aria-pressed', 'true');
    await expect(itens(page)).toHaveCount(1);
  });
});

test.describe('Dado mensagens sem regra desde a última visita a Regras (WM-01)', () => {
  test('deve marcar Regras no rail e mostrar a linha que leva a elas', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);
    await abrirEntrada(page, tokenId);
    const regras = page.getByRole('link', { name: /^Rules\b/ });
    await expect(regras).toHaveAccessibleName('Rules');
    // A Entrada só abre o tempo real depois de a lista carregar: a mensagem sai depois do "Live", senão chega no
    // meio e não entra na conta (intermitente).
    await expect(estadoAoVivo(page)).toContainText('Live');

    await tokens.send(tokenId, { method: 'GET', path: '/pagamentos' });

    await expect(regras).toHaveAccessibleName(/^Rules · 1 requests? without a rule$/, {
      timeout: 8_000,
    });
    await regras.click();
    const aviso = page.getByRole('link', {
      name: /^1 requests? without a rule since .+ — see them$/,
    });
    await expect(aviso).toBeVisible();
    await expect(page.getByRole('link', { name: /^Rules\b/ })).toHaveAccessibleName('Rules');

    await aviso.click();
    await abrirFiltros(page);
    await expect(chip(page, 'Default response')).toHaveAttribute('aria-pressed', 'true');
    await expect(itens(page)).toHaveCount(1);
  });
});
