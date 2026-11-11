import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { expect, test, TokenTracker } from './support/fixtures';
import { destino, prenderPedacos, tracoDeProgresso } from './support/shell';
import { seedStorage } from './support/storage';

test.use({ reducedMotion: 'reduce' });

/**
 * Movimento reduzido útil (`docs/padroes-angular.md` §5): com movimento reduzido, nada se desloca. O fade
 * (opacidade) e a troca de cor ficam; o resto vira o estado final. As animações vivas de uma parte da tela, com as propriedades que mexem.
 */
async function propriedadesAnimadas(page: Page, onde: string): Promise<string[]> {
  return page.evaluate((seletor) => {
    const props = new Set<string>();
    for (const animacao of document.getAnimations()) {
      const efeito = animacao.effect as KeyframeEffect | null;
      if (!efeito?.target?.closest(seletor)) {
        continue;
      }
      for (const quadro of efeito.getKeyframes()) {
        Object.keys(quadro)
          .filter((chave) => !['offset', 'computedOffset', 'easing', 'composite'].includes(chave))
          .forEach((chave) => props.add(chave));
      }
    }
    return [...props].sort();
  }, onde);
}

const SEGREDO = 'segredo-reduzido';
const assinado = (corpo: string) => ({
  path: '/webhooks/pagamentos',
  headers: {
    'Content-Type': 'application/json',
    'X-Hub-Signature-256': `sha256=${createHmac('sha256', SEGREDO).update(corpo).digest('hex')}`,
  },
  data: corpo,
});

test.describe('Dado o sistema pedindo menos movimento', () => {
  test('deve ir à seção de Verificações de uma vez, sem a rolagem suave', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.addInitScript(() => {
      const rolar = Element.prototype.scrollIntoView;
      const pedidos: unknown[] = [];
      Object.assign(window, { rolagensPedidas: pedidos });
      Element.prototype.scrollIntoView = function (opcoes?: boolean | ScrollIntoViewOptions) {
        pedidos.push(opcoes);
        rolar.call(this, opcoes);
      };
    });

    await page.goto(`/#/${tokenId}/checks?section=health`);

    const atalhos = page.getByRole('navigation', { name: 'On this page' });
    await expect(atalhos.locator('[aria-current]')).toContainText('Health');
    await expect(page.getByRole('region', { name: 'Health' })).toBeInViewport();
    expect(
      await page.evaluate(
        () => (window as unknown as { rolagensPedidas: unknown[] }).rolagensPedidas,
      ),
    ).toContainEqual({ block: 'start', behavior: 'auto' });
  });

  test('deve abrir "Forward from this browser (legacy)" sem a seta girar aos poucos', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/outbound`);

    const legado = page.getByRole('button', { name: 'Forward from this browser (legacy)' });
    await expect(legado.locator('.chevron')).toHaveCSS('transition-duration', '0s');
  });

  test('deve mostrar o traço de progresso parado e inteiro Quando o pedaço da página demora', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await expect(destino(page, 'Inbox')).toHaveAttribute('aria-current', 'page');
    const soltar = await prenderPedacos(page);

    await destino(page, 'Insights').click();

    const traco = tracoDeProgresso(page);
    await expect(traco).toBeVisible();
    await expect(traco).toHaveCSS('animation-name', 'none');
    expect((await traco.boundingBox())?.width, 'de ponta a ponta do conteúdo').toBe(
      (await page.locator('app-shell .content').boundingBox())?.width,
    );
    soltar();
    await expect(traco).toHaveCount(0);
  });

  test('deve mostrar a chegada isolada de uma vez no instante em que o pulso terminaria: caminho sólido, "path: …" no detalhe e a linha com fade de 120 ms, sem nada se deslocar', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: SEGREDO },
      schema: { type: 'object' },
    });
    await seedStorage(page, { hideTutorial: 'true' });
    await page.addInitScript(() => {
      const marcas = {
        pontos: 0,
        linha: 0,
        caminho: 0,
        entrada: [] as unknown[],
        props: [] as string[],
      };
      Object.assign(window, { marcas });
      new MutationObserver((mudancas) => {
        const t = performance.now();
        for (const mudanca of mudancas) {
          for (const no of mudanca.addedNodes) {
            if (!(no instanceof Element)) {
              continue;
            }
            if (no.matches('.fx .dot')) {
              marcas.pontos++;
            }
            const linha = no.matches('.item') ? no : no.querySelector('.item');
            if (linha && !marcas.linha) {
              marcas.linha = t;
              marcas.entrada = linha.getAnimations().map((animacao) => {
                const efeito = animacao.effect as KeyframeEffect;
                return {
                  nome: (animacao as CSSAnimation).animationName,
                  duracao: efeito.getTiming().duration,
                  quadros: efeito.getKeyframes(),
                };
              });
            }
            if ((no.matches('.dpath') || no.querySelector('.dpath')) && !marcas.caminho) {
              marcas.caminho = t;
            }
          }
        }
      }).observe(document, { subtree: true, childList: true });
    });
    await page.goto(`/#/${tokenId}`);
    await expect(
      page.getByRole('region', { name: 'URL circuit' }).getByRole('img'),
    ).toHaveAccessibleName(/No request open\.$/);
    // O tempo real aberto: a chegada vem pelo evento (a da volta da conexão não tem pulso).
    await expect(page.locator('app-live-status')).toContainText('Live');
    const enviada = await page.evaluate(() => performance.now());

    await tokens.send(tokenId, assinado('{"event_id":"evt_pf_7Q2K1001"}'));

    const detalhe = page.getByRole('region', { name: 'Request detail' });
    await expect(detalhe.locator('.dpath')).toHaveText(
      'path: signature ✓ → schema ✓ → default response 200',
    );
    const marcas = await page.evaluate(
      () =>
        (
          window as unknown as {
            marcas: {
              pontos: number;
              linha: number;
              caminho: number;
              entrada: { nome: string; duracao: number; quadros: Keyframe[] }[];
            };
          }
        ).marcas,
    );
    // Sem pulso: a linha, o caminho e a frase aparecem juntos, quando o pulso terminaria (3 saltos e o desfazer: 720 ms).
    expect(marcas.pontos).toBe(0);
    expect(marcas.linha - enviada).toBeGreaterThanOrEqual(700);
    expect(marcas.linha - enviada).toBeLessThan(1200);
    expect(Math.abs(marcas.caminho - marcas.linha)).toBeLessThan(100);
    expect(marcas.entrada).toHaveLength(1);
    expect(marcas.entrada[0]).toMatchObject({ nome: 'app-born-fade', duracao: 120 });
    expect(marcas.entrada[0].quadros[0]).not.toHaveProperty('transform');
    expect(marcas.entrada[0].quadros[0]).toMatchObject({ opacity: '0', easing: 'linear' });
    const caminho = page.getByRole('region', { name: 'URL circuit' }).locator('.route');
    await expect(caminho).toHaveCSS('opacity', '1');
    expect(await caminho.evaluate((el) => el.getAnimations().length)).toBe(0);
    await expect(
      page.getByRole('region', { name: 'URL circuit' }).getByRole('img'),
    ).toHaveAccessibleName(/path: signature ✓ → schema ✓ → default response 200\.$/);
  });

  test('deve virar fluxo na rajada sem pulso nem transição: contadores e espessura trocam em 0 ms', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ schema: { type: 'object' } });
    const regras = await page.request.put(`/token/${tokenId}/rules`, {
      data: [
        {
          name: 'Pedido inexistente',
          priority: 1,
          match: { method: ['DELETE'] },
          response: { status: 404 },
        },
      ],
    });
    expect(regras.status()).toBe(200);
    await tokens.send(tokenId, assinado('{"a":0}'));
    await seedStorage(page, { hideTutorial: 'true' });
    await page.goto(`/#/${tokenId}`);
    const circuito = page.getByRole('region', { name: 'URL circuit' });
    await expect(circuito.locator('[data-key="default:ann"]')).toHaveText('200 · 1');
    await expect(page.locator('app-live-status')).toContainText('Live');

    await Promise.all(
      Array.from({ length: 8 }, (_, n) => tokens.send(tokenId, assinado(`{"a":${n + 1}}`))),
    );

    await expect(circuito.locator('[data-key="default:ann"]')).toHaveText('200 · 9');
    await expect(circuito.locator('.lab.meter')).toHaveText(/^\d+\/s$/);
    expect(await circuito.locator('.fx .dot').count()).toBe(0);
    // Só o fade pode animar (a primeira da rajada nasce com ele, até a segunda chegar); nada se desloca.
    expect(
      (await propriedadesAnimadas(page, 'app-circuit, app-request-list .list')).filter(
        (propriedade) => propriedade !== 'opacity',
      ),
    ).toEqual([]);
    const contador = circuito.locator('[data-key="default:ann"] .ctr');
    await expect(contador).toHaveCSS('transition-duration', '0s');
    await expect(circuito.locator('.edge').first()).toHaveCSS('transition-duration', '0s');
  });
});

type Entrada = { nome: string; duracao: number; quadros: Keyframe[] };

// A animação que termina sai de `getAnimations()`: cada uma é gravada quando começa, com o elemento dela.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const comecadas: (Entrada & { alvo: Element })[] = [];
    Object.assign(window, { comecadas });
    document.addEventListener('animationstart', (evento) => {
      const alvo = evento.target as Element;
      const efeito = alvo
        .getAnimations()
        .find((a) => (a as CSSAnimation).animationName === evento.animationName)?.effect as
        KeyframeEffect | undefined;
      comecadas.push({
        alvo,
        nome: evento.animationName,
        duracao: efeito?.getTiming().duration as number,
        quadros: efeito?.getKeyframes() ?? [],
      });
    });
  });
});

/** As animações CSS que começaram no elemento desde a carga da página. */
async function animacoesDe(local: Locator): Promise<Entrada[]> {
  const ler = () =>
    local.evaluate((elemento) =>
      (window as unknown as { comecadas: (Entrada & { alvo: Element })[] }).comecadas
        .filter((comecada) => comecada.alvo === elemento)
        .map(({ nome, duracao, quadros }) => ({ nome, duracao, quadros })),
    );
  await expect.poll(async () => (await ler()).length).toBeGreaterThan(0);
  return ler();
}

/** Derruba o `/stream` até a faixa de conexão aparecer e devolve as animações com que ela entrou. */
async function faixaQueEntra(page: Page, tokenId: string): Promise<Entrada[]> {
  await seedStorage(page, { hideTutorial: 'true' });
  await page.route(`**/token/${tokenId}/stream`, (rota) => rota.abort('connectionreset'));
  await page.goto(`/#/${tokenId}`);
  await expect(page.getByRole('button', { name: 'Try again now' })).toBeVisible({
    timeout: 15_000,
  });
  return animacoesDe(page.locator('app-connection-band'));
}

/** Solta o `/stream` e espera a faixa dizer a volta. */
async function conexaoVolta(page: Page, tokenId: string): Promise<void> {
  await page.unroute(`**/token/${tokenId}/stream`);
  await page.getByRole('button', { name: 'Try again now' }).click();
  await expect(page.locator('app-connection-band')).toContainText('Connected again.');
}

test.describe('Dado o sistema pedindo menos movimento e a conexão que cai', () => {
  test('deve mostrar a faixa só com o fade de 120 ms, sem descer, e trocar a cor dela e a do ponto na volta', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();

    const entrada = await faixaQueEntra(page, tokenId);

    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ nome: 'app-born-fade', duracao: 120 });
    expect(entrada[0].quadros[0]).not.toHaveProperty('transform');
    await conexaoVolta(page, tokenId);
    await expect(page.locator('app-connection-band')).toHaveCSS(
      'transition-property',
      'background-color, color',
    );
    await expect(page.locator('app-live-status .dot')).toHaveCSS(
      'transition-property',
      'background-color',
    );
  });
});

test.describe('Dado o movimento normal e a conexão que cai', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('deve trazer a faixa de 8 px acima com a mola de 224 ms', async ({ page, tokens }) => {
    const tokenId = await tokens.create();

    const entrada = await faixaQueEntra(page, tokenId);

    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ nome: 'app-arrive', duracao: 224 });
    expect(entrada[0].quadros[0]).toMatchObject({
      opacity: '0',
      transform: 'translateY(-8px)',
    });
  });
});

/** Abre a Entrada com uma requisição e faz chegar outra fora da vista; devolve a pílula. */
async function pilulaQueChega(page: Page, tokens: TokenTracker) {
  const tokenId = await tokens.create();
  await tokens.send(tokenId, { path: '/antes' });
  await seedStorage(page, { hideTutorial: 'true' });
  await page.goto(`/#/${tokenId}`);
  await expect(page.locator('app-live-status')).toContainText('Live');
  await tokens.send(tokenId, { path: '/depois' });
  const pilula = page.locator('app-new-pill');
  await expect(pilula).toBeVisible();
  return pilula;
}

/** Apaga a requisição aberta pelo botão da linha; devolve a faixa "You deleted …". */
async function faixaDeApagada(page: Page, tokens: TokenTracker) {
  const tokenId = await tokens.create();
  await tokens.send(tokenId, { path: '/apagar' });
  await tokens.send(tokenId, { path: '/fica' });
  await seedStorage(page, { hideTutorial: 'true' });
  await page.goto(`/#/${tokenId}`);
  await page.getByRole('button', { name: /^Delete this request: POST \/apagar/ }).click();
  const faixa = page.locator('app-inbox .gone');
  await expect(faixa).toContainText('You deleted POST /apagar');
  return faixa;
}

test.describe('Dado o sistema pedindo menos movimento e o que avisa na lista', () => {
  test('deve mostrar a pílula das novas só com o fade de 120 ms, sem descer', async ({
    page,
    tokens,
  }) => {
    const entrada = await animacoesDe(await pilulaQueChega(page, tokens));

    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ nome: 'app-born-fade', duracao: 120 });
    expect(entrada[0].quadros[0]).not.toHaveProperty('transform');
  });

  test('deve mostrar a faixa de quem apagou só com o fade de 120 ms, sem descer', async ({
    page,
    tokens,
  }) => {
    const entrada = await animacoesDe(await faixaDeApagada(page, tokens));

    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ nome: 'app-born-fade', duracao: 120 });
    expect(entrada[0].quadros[0]).not.toHaveProperty('transform');
  });
});

test.describe('Dado o movimento normal e o que avisa na lista', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('deve trazer a pílula das novas de 8 px acima com a mola de 224 ms, porque veio do tempo real', async ({
    page,
    tokens,
  }) => {
    const entrada = await animacoesDe(await pilulaQueChega(page, tokens));

    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ nome: 'app-arrive', duracao: 224 });
    expect(entrada[0].quadros[0]).toMatchObject({ transform: 'translateY(-8px)' });
  });

  test('deve trazer a faixa de quem apagou de 8 px acima em 120 ms, porque responde ao toque', async ({
    page,
    tokens,
  }) => {
    const entrada = await animacoesDe(await faixaDeApagada(page, tokens));

    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ nome: 'app-arrive', duracao: 120 });
    expect(entrada[0].quadros[0]).toMatchObject({ transform: 'translateY(-8px)' });
  });
});
