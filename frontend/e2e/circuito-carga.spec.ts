import { randomUUID } from 'node:crypto';
import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { seedStorage } from './support/storage';

// Roda sozinho, fora dos outros E2E: `CARGA=1 npx playwright test`.
// Com 10.000 mensagens carregadas e uma rajada de 64 clientes, o circuito vira fluxo
// sem perder quadros (≤ 5 %) e as interações (J/K, abrir uma linha, filtrar pelo nó) respondem em até 200 ms (INP).

/** Quantas mensagens a lista carrega antes da rajada. */
const CARREGADAS = 10_000;
/** Os clientes da rajada (o `tests/subida` dispara 64). */
const CLIENTES = 64;

/**
 * A régua dos quadros (a da demo, `measure`, sem o descarte dos quadros de 500 ms ou mais: aqui a aba nunca sai da
 * vista, e um quadro longo é a tela travada) e a das interações (Event Timing), instaladas antes da tela. Guarda
 * também quando cada chegada do tempo real e cada tecla aconteceram, e se a tecla caiu com o circuito no fluxo.
 */
async function medir(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const medida = {
      quadros: 0,
      perdidos: 0,
      maior: 0,
      ligada: false,
      interacoes: new Map<number, number>(),
      chegadas: [] as number[],
      teclas: [] as { em: number; fluxo: boolean }[],
    };
    Object.assign(window, { medida });
    const Stream = window.EventSource;
    window.EventSource = class extends Stream {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener('request.created', () => medida.chegadas.push(performance.now()));
      }
    };
    document.addEventListener(
      'keydown',
      () =>
        medida.teclas.push({
          em: performance.now(),
          fluxo: document.querySelector('app-circuit .lab.meter') !== null,
        }),
      true,
    );
    const recentes: number[] = [];
    let base = 1000 / 60;
    let antes: number | null = null;
    const quadro = (agora: number) => {
      const dt = antes === null ? 0 : agora - antes;
      antes = agora;
      if (medida.ligada && dt > 0) {
        medida.maior = Math.max(medida.maior, dt);
        recentes.push(dt);
        if (recentes.length > 60) {
          recentes.shift();
        }
        if (recentes.length >= 30) {
          const ordem = [...recentes].sort((a, b) => a - b);
          const mediana = ordem[ordem.length >> 1];
          base = mediana < 12 ? mediana : 1000 / 60;
        }
        const n = Math.max(1, Math.round(dt / base));
        medida.quadros += n;
        medida.perdidos += n - 1;
      }
      requestAnimationFrame(quadro);
    };
    requestAnimationFrame(quadro);
    new PerformanceObserver((lista) => {
      for (const entrada of lista.getEntries() as PerformanceEventTiming[]) {
        if (entrada.interactionId) {
          const maior = medida.interacoes.get(entrada.interactionId) ?? 0;
          medida.interacoes.set(entrada.interactionId, Math.max(maior, entrada.duration));
        }
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
}

/** 10.000 mensagens como a API devolve, a partir de uma de verdade da URL: a lista carrega todas de uma vez. */
async function dezMil(
  page: Page,
  tokenId: string,
  modelo: Record<string, unknown>,
  p1: string,
): Promise<void> {
  const agora = Date.parse(String(modelo['created_at']).replace(' ', 'T') + 'Z');
  const data = Array.from({ length: CARREGADAS }, (_, i) => {
    const anomalia = i % 50 === 7;
    return {
      ...modelo,
      uuid: randomUUID(),
      seq: CARREGADAS - i,
      created_at: new Date(agora - (i + 1) * 1000).toISOString().replace('T', ' ').slice(0, 19),
      method: i % 4 === 2 ? 'PUT' : 'POST',
      url: String(modelo['url']).replace(
        /\/webhooks\/.*$/,
        i % 4 === 2 ? '/webhooks/estoque/sku_1' : '/webhooks/pagamentos',
      ),
      signature: anomalia
        ? { provider: 'github', valid: false, reason: 'signature mismatch' }
        : modelo['signature'],
      rule: anomalia ? { id: p1, name: 'Assinatura inválida' } : null,
      response: { status: anomalia ? 401 : 200 },
      near_miss: null,
    };
  });
  await page.route(new RegExp(`/token/${tokenId}/requests\\?(.*&)?page=1(&|$)`), (rota) =>
    rota.fulfill({
      json: {
        data,
        total: CARREGADAS,
        per_page: CARREGADAS,
        current_page: 1,
        is_last_page: true,
        from: 1,
        to: CARREGADAS,
      },
    }),
  );
}

test.describe('Dado a Entrada com 10.000 mensagens carregadas', () => {
  test.setTimeout(180_000);

  test('deve aguentar a rajada de 64 clientes sem perder mais de 5 % dos quadros, com INP de até 200 ms', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ schema: { type: 'object' } });
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
          response: { status: 503 },
        },
      ],
    });
    expect(regras.status()).toBe(200);
    const [p1] = (await regras.json()) as { id: string }[];
    const primeira = await tokens.send(tokenId, { path: '/webhooks/pagamentos', data: '{"a":1}' });
    const modelo = (await (
      await page.request.get(`/token/${tokenId}/request/${primeira}`)
    ).json()) as Record<string, unknown>;
    await seedStorage(page, { hideTutorial: 'true' });
    await medir(page);
    await dezMil(page, tokenId, modelo, p1.id);
    await page.goto(`/#/${tokenId}`);
    const circuito = page.getByRole('region', { name: 'URL circuit' });
    // As 10.000 e a de verdade, que a volta do tempo real traz por cima da lista lida.
    await expect(
      circuito.locator('.lab').filter({ hasText: `${CARREGADAS + 1} responses` }),
    ).toBeVisible({ timeout: 30_000 });
    const linhas = page.getByRole('region', { name: 'Request list', exact: true }).locator('.item');
    await expect(linhas.first()).toBeVisible();
    await page.waitForTimeout(1000);

    const antes = await page.evaluate(() => {
      const medida = (window as unknown as { medida: { ligada: boolean; chegadas: number[] } })
        .medida;
      medida.ligada = true;
      return medida.chegadas.length;
    });
    const rajada = Promise.all(
      Array.from({ length: CLIENTES }, (_, i) =>
        tokens.send(tokenId, { path: '/webhooks/pagamentos', data: `{"n":${i}}` }),
      ),
    );
    // Com a rajada em curso (o circuito no fluxo): J e K e abrir uma linha (ações frequentes, sem motion).
    await page.waitForFunction(
      () => document.querySelector('app-circuit .lab.meter') !== null,
      null,
      {
        polling: 'raf',
      },
    );
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await linhas.nth(3).getByRole('button').first().click();
    await rajada;
    // A rajada virou fluxo: o medidor "N/s" ao lado do Remetente.
    await expect(circuito.locator('.lab.meter')).toHaveText(/^\d+\/s$/);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const medida = (window as unknown as { medida: { ligada: boolean } }).medida;
      medida.ligada = false;
    });
    // Filtrar pelo nó da padrão e tirar o filtro, com as 10.000 (o INP conta essas interações também).
    const padrao = circuito.getByRole('button', { name: /^Default response/ });
    await padrao.click();
    await expect(padrao).toHaveAttribute('aria-pressed', 'true');
    await padrao.click();
    await expect(padrao).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(500);

    const { quadros, perdidos, maior, inp, chegadas, teclas } = await page.evaluate((lidas) => {
      const medida = (
        window as unknown as {
          medida: {
            quadros: number;
            perdidos: number;
            maior: number;
            interacoes: Map<number, number>;
            chegadas: number[];
            teclas: { em: number; fluxo: boolean }[];
          };
        }
      ).medida;
      return {
        quadros: medida.quadros,
        perdidos: medida.perdidos,
        maior: Math.round(medida.maior),
        inp: Math.max(0, ...medida.interacoes.values()),
        chegadas: medida.chegadas.slice(lidas),
        teclas: medida.teclas,
      };
    }, antes);
    const depois = chegadas.filter((chegada) => chegada > teclas[0].em).length;
    const medidas = `quadros perdidos: ${perdidos} de ${quadros} (${((100 * perdidos) / quadros).toFixed(1)} %); maior quadro: ${maior} ms; INP: ${inp} ms; chegadas da rajada depois da 1.ª tecla: ${depois} de ${chegadas.length}`;
    test.info().annotations.push({ type: 'medida', description: medidas });
    console.log(medidas);
    expect(chegadas).toHaveLength(CLIENTES);
    expect(teclas[0].em).toBeGreaterThanOrEqual(chegadas[0]);
    expect(teclas.map((tecla) => tecla.fluxo)).toEqual([true, true, true]);
    expect(quadros).toBeGreaterThan(60);
    expect(perdidos / quadros).toBeLessThanOrEqual(0.05);
    expect(inp).toBeLessThanOrEqual(200);
  });
});
