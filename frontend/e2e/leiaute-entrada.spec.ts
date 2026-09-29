import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { compacto } from './support/shell';
import { seedStorage } from './support/storage';

interface Caixa {
  texto: string;
  esquerda: number;
  direita: number;
  topo: number;
  base: number;
}

async function caixas(locator: Locator): Promise<Caixa[]> {
  return locator.evaluateAll((nos) =>
    nos.map((no) => {
      const caixa = no.getBoundingClientRect();
      return {
        texto: (no.textContent ?? '').replace(/\s+/g, ' ').trim(),
        esquerda: caixa.left,
        direita: caixa.right,
        topo: caixa.top,
        base: caixa.bottom,
      };
    }),
  );
}

/** Os pares de caixas que se cruzam, para a mensagem da falha dizer quais. */
function cruzados(lista: readonly Caixa[]): string[] {
  const pares: string[] = [];
  lista.forEach((a, i) =>
    lista.slice(i + 1).forEach((b) => {
      const x = Math.min(a.direita, b.direita) - Math.max(a.esquerda, b.esquerda);
      const y = Math.min(a.base, b.base) - Math.max(a.topo, b.topo);
      if (x > 1 && y > 1) {
        pares.push(`"${a.texto}" × "${b.texto}"`);
      }
    }),
  );
  return pares;
}

/** A tela em pt-BR, onde os rótulos são mais compridos. */
async function emPortugues(page: Page): Promise<void> {
  await seedStorage(page, { language: '"pt-BR"' });
}

test.describe('Dado a Entrada em pt-BR, com os rótulos mais compridos', () => {
  test('não deve sobrepor os chips do painel de filtros com dois ligados', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'no celular o painel é folha, com um grupo por linha');
    const tokenId = await tokens.create();
    await tokens.send(tokenId);
    await emPortugues(page);
    await page.goto(`/#/${tokenId}`);

    await page.getByRole('button', { name: /^Filtros/ }).click();
    const filtros = page.getByRole('group', { name: 'Filtros' });
    await filtros.getByRole('button', { name: 'Assinatura válida', exact: true }).click();
    await filtros.getByRole('button', { name: 'Schema inválido', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Requisições \(0 de 1\)$/ })).toBeVisible();

    expect(cruzados(await caixas(filtros.locator('.chip')))).toEqual([]);
  });
});
