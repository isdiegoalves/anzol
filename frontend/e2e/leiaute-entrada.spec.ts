import { createHmac } from 'node:crypto';
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

test.describe('Dado a linha de um evento com muitas tentativas', () => {
  test('deve mostrar inteira a contagem e a última resposta, perdendo as mais antigas da trilha', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    for (let n = 1; n <= 7; n++) {
      await tokens.send(tokenId, {
        path: '/webhooks/pagamentos/confirmacoes',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ event_id: 'evt_pf_7Q2K1010', n }),
      });
    }
    await emPortugues(page);
    await page.goto('/favicon.ico');
    await page.evaluate(
      (chave) => localStorage.setItem(chave, '$.event_id'),
      `anzol.eventKey.${tokenId}`,
    );
    await page.goto(`/#/${tokenId}`);
    const trilha = page.locator('app-event-line .trail');
    await expect(trilha).toHaveCount(1);

    const problemas = await trilha.evaluate((linha) => {
      const caixa = linha.getBoundingClientRect();
      const contagem = linha.querySelector<HTMLElement>('.count');
      const ultima = linha.querySelector<HTMLElement>('.seal.last');
      const erros: string[] = [];
      if (!contagem || contagem.scrollWidth > contagem.clientWidth + 1) {
        erros.push(`contagem cortada: "${contagem?.textContent?.trim()}"`);
      }
      const fim = ultima?.getBoundingClientRect();
      if (!fim || fim.left < caixa.left || fim.right > caixa.right + 1) {
        erros.push('a última resposta não está inteira à vista');
      }
      return erros;
    });
    expect(problemas).toEqual([]);
  });
});

test.describe('Dado a segunda linha do item, com o status e os selos', () => {
  test('deve mostrar inteiros o número do status e o texto de cada erro, e só o ícone do que passou', async ({
    page,
    tokens,
  }) => {
    const segredo = 'segredo-do-leiaute';
    const assinado = (chave: string, corpo: string) => ({
      path: '/webhooks/pagamentos/confirmacoes',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': `sha256=${createHmac('sha256', chave).update(corpo).digest('hex')}`,
      },
      data: corpo,
    });
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: segredo },
      default_status: '401',
    });
    await tokens.send(tokenId, assinado(segredo, '{"id":1}'));
    await tokens.send(tokenId, assinado('outro-segredo', '{"id":2}'));
    await emPortugues(page);
    await page.goto(`/#/${tokenId}`);
    const selos = page
      .getByRole('region', { name: 'Lista de requisições', exact: true })
      .locator('.item .seals app-check-chip');
    await expect(selos).toHaveCount(4);

    const cortados = await selos.evaluateAll((chips) =>
      chips.flatMap((chip) => {
        const titulo = chip.querySelector<HTMLElement>('.title');
        const texto = titulo?.textContent?.trim() ?? '';
        if (chip.classList.contains('ok') && chip.getAttribute('data-kind') !== 'rule') {
          return titulo ? [`"${texto}" aparece num selo que passou`] : [];
        }
        if (!titulo) {
          return [`selo ${chip.getAttribute('data-kind')} sem texto`];
        }
        if (chip.getAttribute('data-kind') === 'rule') {
          // "401 ·" em fonte de código: quatro caracteres de ~8 px.
          return titulo.clientWidth < 32 ? [`o status "${texto}" não cabe`] : [];
        }
        return titulo.scrollWidth > titulo.clientWidth + 1 ? [`"${texto}" cortado`] : [];
      }),
    );
    expect(cortados).toEqual([]);
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
