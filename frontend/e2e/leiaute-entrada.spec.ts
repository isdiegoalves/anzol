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

/**
 * O fim do caminho não sai da caixa dele (nem cobre o que vem depois), e o começo não tem recuo que
 * esconda o texto.
 */
async function conferirCaminhos(linhas: Locator, depois: string): Promise<void> {
  const problemas = await linhas.evaluateAll(
    (nos, seletorDepois) =>
      nos.flatMap((no) => {
        const rota = no.querySelector<HTMLElement>('.route');
        const fim = rota?.lastElementChild as HTMLElement | null;
        const comeco = rota?.firstElementChild as HTMLElement | null;
        const seguinte = no.querySelector<HTMLElement>(seletorDepois);
        if (!rota || !fim || !comeco) {
          return ['sem caminho'];
        }
        const [r, f] = [rota.getBoundingClientRect(), fim.getBoundingClientRect()];
        const erros: string[] = [];
        if (f.right > r.right + 1) {
          erros.push(`o fim "${fim.textContent}" sai do caminho`);
        }
        if (seguinte && r.right > seguinte.getBoundingClientRect().left + 1) {
          erros.push(`o caminho cobre "${seguinte.textContent?.trim()}"`);
        }
        if (getComputedStyle(comeco).paddingLeft !== '0px') {
          erros.push(`o começo "${comeco.textContent}" tem recuo`);
        }
        return erros;
      }),
    depois,
  );
  expect(problemas).toEqual([]);
}

test.describe('Dado caminhos que não cabem na largura da lista', () => {
  test('deve cortar no meio sem sobrepor, no item e na linha de evento', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    for (const [evento, n] of [
      ['evt_pf_7Q2K1010', 1],
      ['evt_pf_7Q2K1010', 2],
      ['evt_pf_7Q2K1011', 1],
    ] as const) {
      await tokens.send(tokenId, {
        path: '/webhooks/pagamentos/confirmacoes',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ event_id: evento, n }),
      });
    }
    await tokens.send(tokenId, { path: '/webhooks/pagamentos/confirmacoes/saude', method: 'GET' });
    await emPortugues(page);
    await page.goto(`/#/${tokenId}`);
    const lista = page.getByRole('region', { name: 'Lista de requisições', exact: true });
    await expect(lista.locator('.item')).toHaveCount(4);

    await conferirCaminhos(lista.locator('.item .route-line'), '.ago');

    await page.evaluate(
      (chave) => localStorage.setItem(chave, '$.event_id'),
      `anzol.eventKey.${tokenId}`,
    );
    await page.reload();
    await expect(lista.locator('app-event-line')).toHaveCount(1);
    await conferirCaminhos(lista.locator('app-event-line .line').first(), '.value, .time');
  });
});

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
