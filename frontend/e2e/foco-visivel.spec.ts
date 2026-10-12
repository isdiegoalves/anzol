import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirMensagem } from './support/inbox';
import { editor, gravarRegras } from './support/regras';
import { seedStorage } from './support/storage';

/**
 * Dá o foco a cada elemento focável da tela e devolve os que não mostram o contorno de 3 px, neles ou no contêiner
 * que o desenha por `:focus-within`. Os componentes do Material ficam de fora: neles o foco é a camada de estado do
 * próprio Material, e no campo de texto, a borda.
 */
async function semContornoDeTresPx(page: Page): Promise<string[]> {
  // Depois de uma tecla, o foco dado pelo script também conta como foco de teclado (`:focus-visible`).
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const comContorno = (el: Element) => {
      const estilo = getComputedStyle(el);
      return estilo.outlineStyle !== 'none' && parseFloat(estilo.outlineWidth) >= 3;
    };
    const doMaterial = '[class*="mdc-"], [class*="mat-mdc-"], [class*="mat-button-toggle"]';
    const focaveis = document.querySelectorAll<HTMLElement>(
      'a[href], button, input, textarea, select, summary, [tabindex]:not([tabindex="-1"])',
    );
    const semContorno: string[] = [];
    for (const el of focaveis) {
      const caixa = el.getBoundingClientRect();
      if (caixa.width === 0 || caixa.height === 0) {
        continue;
      }
      el.focus();
      if (document.activeElement !== el) {
        continue;
      }
      let desenha: Element | null = el;
      for (let nivel = 0; nivel < 4 && desenha && !comContorno(desenha); nivel++) {
        desenha = desenha.parentElement;
      }
      if ((!desenha || !comContorno(desenha)) && !el.matches(doMaterial)) {
        const nome = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
        semContorno.push(`${el.tagName.toLowerCase()}.${el.className} "${nome}"`);
      }
    }
    return semContorno;
  });
}

test.describe('Dado o foco pelo teclado', () => {
  test('deve mostrar o contorno de 3 px em tudo o que recebe o foco, fora os componentes do Material', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: 'segredo-do-foco' },
      schema: { type: 'object', required: ['id'] },
    });
    const [regra] = await gravarRegras(page.request, tokenId, [
      {
        name: 'Fora do ar',
        priority: 1,
        match: { path: { equals: '/falha' } },
        response: { status: 503 },
      },
    ]);
    const json = { 'Content-Type': 'application/json' };
    const semId = await tokens.send(tokenId, { path: '/pedidos', headers: json, data: '{"x":1}' });
    const comId = await tokens.send(tokenId, { path: '/pedidos', headers: json, data: '{"id":1}' });
    await seedStorage(page, { hideTutorial: 'true' });

    await abrirMensagem(page, tokenId, semId);
    expect(await semContornoDeTresPx(page), 'na Entrada, com a requisição aberta').toEqual([]);

    await page.goto(`/#/${tokenId}/rules/${regra.id}`);
    const regiao = editor(page, 'Edit rule Fora do ar');
    await expect(regiao).toBeVisible();
    expect(await semContornoDeTresPx(page), 'em Regras, com a regra aberta').toEqual([]);
    const nome = regiao.getByRole('textbox', { name: 'Name', exact: true });
    await nome.focus();
    await expect(nome, 'o nome da regra mostra o foco na linha de baixo').toHaveCSS(
      'border-bottom-width',
      '3px',
    );

    await page.goto(`/#/${tokenId}/checks`);
    await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
    expect(await semContornoDeTresPx(page), 'em Verificações').toEqual([]);

    await page.goto(`/#/${tokenId}/compare/${semId}/${comId}`);
    await expect(page.getByRole('region', { name: 'Compare requests' })).toBeVisible();
    expect(await semContornoDeTresPx(page), 'no Comparar').toEqual([]);
  });

  test('deve deixar abaixo do cabeçalho do editor de regra o campo que recebe o foco ao voltar com Shift+Tab', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const [regra] = await gravarRegras(page.request, tokenId, [
      {
        name: 'Fora do ar',
        priority: 1,
        match: { path: { equals: '/falha' } },
        response: { status: 503 },
      },
    ]);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/rules/${regra.id}`);
    const regiao = editor(page, 'Edit rule Fora do ar');
    await expect(regiao).toBeVisible();
    // O cabeçalho gruda no topo do painel, que rola: do fim para o começo, cada campo entra por baixo dele.
    await regiao.evaluate((el) => {
      const focaveis = [
        ...el.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select'),
      ].filter((campo) => campo.getBoundingClientRect().height > 0);
      focaveis.at(-1)?.focus();
    });

    const cobertos: string[] = [];
    for (let passo = 0; passo < 60; passo++) {
      await page.keyboard.press('Shift+Tab');
      const coberto = await page.evaluate(() => {
        const cabecalho = document.querySelector('app-rule-editor-header');
        const campo = document.activeElement;
        if (!cabecalho || !campo?.closest('app-rule-editor')) {
          return 'saiu do editor';
        }
        if (cabecalho.contains(campo)) {
          return null;
        }
        const barra = cabecalho.getBoundingClientRect();
        const caixa = campo.getBoundingClientRect();
        const alto = Math.min(caixa.bottom, barra.bottom) - Math.max(caixa.top, barra.top);
        const largo = Math.min(caixa.right, barra.right) - Math.max(caixa.left, barra.left);
        const nome = (campo.getAttribute('aria-label') ?? campo.textContent ?? '').trim();
        return alto > 1 && largo > 1 ? `${nome.slice(0, 40)}: ${Math.round(alto)} px` : null;
      });
      if (coberto === 'saiu do editor') {
        break;
      }
      if (coberto) {
        cobertos.push(coberto);
      }
    }
    expect(cobertos, 'campos com o foco atrás do cabeçalho').toEqual([]);
  });
});
