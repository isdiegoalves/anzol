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

test.describe('Dado o sistema pedindo menos movimento e a conexão ao vivo', () => {
  test('deve deixar o ponto do "Live" parado', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);
    await expect(page.locator('app-live-status')).toContainText('Live');

    await expect(page.locator('app-live-status .dot')).toHaveCSS('animation-name', 'none');
  });
});

test.describe('Dado o movimento normal e a conexão ao vivo', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('deve pulsar o ponto do "Live" só por opacidade, no ritmo do token longo, indo e voltando', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);
    await expect(page.locator('app-live-status')).toContainText('Live');
    const ponto = page.locator('app-live-status .dot');

    await expect(ponto).toHaveCSS('animation-duration', '1.2s');
    await expect(ponto).toHaveCSS('animation-iteration-count', 'infinite');
    await expect(ponto).toHaveCSS('animation-direction', 'alternate');
    await expect.poll(() => propriedadesAnimadas(page, 'app-live-status')).toEqual(['opacity']);
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

/** Apaga a requisição pela lixeira da linha e desfaz pelo aviso; devolve como a linha voltou. */
async function linhaQueVolta(page: Page, tokens: TokenTracker): Promise<Entrada[]> {
  const faixa = await faixaDeApagada(page, tokens);
  await faixa.getByRole('button', { name: 'Undo' }).click();
  const linha = page.locator('app-request-list .item', { hasText: '/apagar' });
  await expect(linha).toBeVisible();
  return animacoesDe(linha);
}

test.describe('Dado o sistema pedindo menos movimento e o apagar desfeito', () => {
  test('deve devolver a linha só com o fade de 120 ms, sem descer', async ({ page, tokens }) => {
    const volta = await linhaQueVolta(page, tokens);

    expect(volta).toHaveLength(1);
    expect(volta[0]).toMatchObject({ nome: 'app-born-fade', duracao: 120 });
    expect(volta[0].quadros[0]).not.toHaveProperty('transform');
  });
});

test.describe('Dado o movimento normal e o apagar desfeito', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('deve devolver a linha de 8 px acima em 120 ms, porque responde ao toque', async ({
    page,
    tokens,
  }) => {
    const volta = await linhaQueVolta(page, tokens);

    expect(volta).toHaveLength(1);
    expect(volta[0]).toMatchObject({ nome: 'app-arrive', duracao: 120 });
    expect(volta[0].quadros[0]).toMatchObject({ transform: 'translateY(-8px)' });
  });
});

type Troca = { carga: Entrada[]; ida: Entrada[]; volta: Entrada[] };

/** No celular, abre a lista, toca numa requisição e volta; devolve como cada painel entrou. */
async function paineisQueTrocam(page: Page, tokens: TokenTracker): Promise<Troca> {
  await page.setViewportSize({ width: 390, height: 844 });
  const tokenId = await tokens.create();
  await tokens.send(tokenId, { path: '/primeira' });
  await tokens.send(tokenId, { path: '/segunda' });
  await seedStorage(page, { hideTutorial: 'true' });
  await page.addInitScript(() => {
    const entradas: Entrada[] = [];
    Object.assign(window, { entradas });
    document.addEventListener('animationstart', (evento) => {
      const alvo = evento.target as Element;
      if (!alvo.matches('.pane')) {
        return;
      }
      const animacao = alvo
        .getAnimations()
        .find((a) => (a as CSSAnimation).animationName === evento.animationName);
      const efeito = animacao?.effect as KeyframeEffect | undefined;
      entradas.push({
        nome: evento.animationName,
        duracao: efeito?.getTiming().duration as number,
        quadros: efeito?.getKeyframes() ?? [],
      });
    });
  });
  const lidas = () =>
    page.evaluate(() => (window as unknown as { entradas: Entrada[] }).entradas.splice(0));
  await page.goto(`/#/${tokenId}`);
  const lista = page.getByRole('region', { name: 'Request list' });
  const detalhe = page.getByRole('region', { name: 'Request detail' });
  await expect(lista.locator('.item').first()).toBeVisible();
  const carga = await lidas();
  await lista.locator('.item', { hasText: '/primeira' }).getByRole('button').first().click();
  await expect(detalhe).toContainText('/primeira');
  await expect
    .poll(
      async () =>
        await page.evaluate(() => (window as unknown as { entradas: unknown[] }).entradas.length),
    )
    .toBeGreaterThan(0);
  const ida = await lidas();
  await page.getByRole('button', { name: 'Back to requests' }).first().click();
  await expect(lista).toBeVisible();
  await expect
    .poll(
      async () =>
        await page.evaluate(() => (window as unknown as { entradas: unknown[] }).entradas.length),
    )
    .toBeGreaterThan(0);
  return { carga, ida, volta: await lidas() };
}

test.describe('Dado o sistema pedindo menos movimento e o celular entre lista e detalhe', () => {
  test('deve trocar os painéis só com o fade de 120 ms, sem deslizar', async ({ page, tokens }) => {
    const { carga, ida, volta } = await paineisQueTrocam(page, tokens);

    expect(carga).toEqual([]);
    for (const entrada of [ida, volta]) {
      expect(entrada).toHaveLength(1);
      expect(entrada[0]).toMatchObject({ nome: 'app-born-fade', duracao: 120 });
      expect(entrada[0].quadros[0]).not.toHaveProperty('transform');
    }
  });
});

test.describe('Dado o movimento normal e o celular entre lista e detalhe', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('deve trazer o detalhe da direita e a lista da esquerda em 120 ms, e carregar parada', async ({
    page,
    tokens,
  }) => {
    const { carga, ida, volta } = await paineisQueTrocam(page, tokens);

    expect(carga).toEqual([]);
    expect(ida).toHaveLength(1);
    expect(ida[0]).toMatchObject({ nome: 'app-arrive-across', duracao: 120 });
    expect(ida[0].quadros[0]).toMatchObject({
      opacity: '0',
      transform: expect.stringMatching(/^translateX?\(24px\)$/),
    });
    expect(volta).toHaveLength(1);
    expect(volta[0]).toMatchObject({ nome: 'app-arrive-across', duracao: 120 });
    expect(volta[0].quadros[0]).toMatchObject({
      opacity: '0',
      transform: expect.stringMatching(/^translateX?\(-24px\)$/),
    });
  });
});

/** As animações de saída (`app-leave`) do painel de filtros, se ele ainda está na página. */
function saidas(page: Page): Promise<Entrada[]> {
  return page.evaluate(() =>
    (document.querySelector('app-filter-panel')?.getAnimations({ subtree: true }) ?? [])
      .filter((animacao) => (animacao as CSSAnimation).animationName === 'app-leave')
      .map((animacao) => ({
        nome: (animacao as CSSAnimation).animationName,
        duracao: animacao.effect?.getTiming().duration as number,
        quadros: (animacao.effect as KeyframeEffect).getKeyframes(),
      })),
  );
}

/** Abre a Entrada com uma requisição, na largura dada, e abre os filtros. */
async function filtrosAbertos(page: Page, tokens: TokenTracker, largura: number): Promise<Locator> {
  await page.setViewportSize({ width: largura, height: 844 });
  const tokenId = await tokens.create();
  await tokens.send(tokenId, { path: '/pedidos' });
  await seedStorage(page, { hideTutorial: 'true' });
  await page.goto(`/#/${tokenId}`);
  await page.getByRole('button', { name: /^Filters(, \d+ active)?$/ }).click();
  await expect(page.getByRole('toolbar', { name: 'Filters' })).toBeVisible();
  return page.locator('app-filter-panel');
}

test.describe('Dado o sistema pedindo menos movimento e os filtros', () => {
  test('deve abrir o painel da janela larga só com o fade de 120 ms', async ({ page, tokens }) => {
    const entrada = await animacoesDe(await filtrosAbertos(page, tokens, 1400));

    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ nome: 'app-born-fade', duracao: 120 });
  });

  test('deve abrir a folha do celular só com fades e fechá-la na hora', async ({
    page,
    tokens,
  }) => {
    const painel = await filtrosAbertos(page, tokens, 390);
    const folha = await animacoesDe(painel.locator('.panel'));

    expect(folha).toHaveLength(1);
    expect(folha[0]).toMatchObject({ nome: 'app-born-fade', duracao: 120 });
    await page.keyboard.press('Escape');
    expect(await saidas(page)).toEqual([]);
    await expect(painel).toHaveCount(0);
  });
});

test.describe('Dado o movimento normal e os filtros', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('deve abrir o painel da janela larga de 8 px acima em 120 ms, e fechá-lo na hora', async ({
    page,
    tokens,
  }) => {
    const painel = await filtrosAbertos(page, tokens, 1400);
    const entrada = await animacoesDe(painel);

    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ nome: 'app-arrive', duracao: 120 });
    expect(entrada[0].quadros[0]).toMatchObject({ transform: 'translateY(-8px)' });
    await page.getByRole('button', { name: /^Filters(, \d+ active)?$/ }).click();
    expect(await saidas(page)).toEqual([]);
    await expect(painel).toHaveCount(0);
  });

  test('deve subir a folha do celular 16 px em 120 ms e fechá-la num fade de 120 ms', async ({
    page,
    tokens,
  }) => {
    const painel = await filtrosAbertos(page, tokens, 390);
    const folha = await animacoesDe(painel.locator('.panel'));

    expect(folha).toHaveLength(1);
    expect(folha[0]).toMatchObject({ nome: 'app-rise', duracao: 120 });
    expect(folha[0].quadros[0]).toMatchObject({ transform: 'translateY(16px)' });
    await page.evaluate(() => {
      const painel = document.querySelector('app-filter-panel');
      painel?.addEventListener('animationstart', (evento) => {
        const animacao = painel
          .getAnimations()
          .find(
            (a) => (a as CSSAnimation).animationName === (evento as AnimationEvent).animationName,
          );
        animacao?.pause();
      });
    });
    await page.keyboard.press('Escape');
    await expect.poll(() => saidas(page)).toHaveLength(2);
    for (const saida of await saidas(page)) {
      expect(saida).toMatchObject({ nome: 'app-leave', duracao: 120 });
      expect(saida.quadros.at(-1)).toMatchObject({ opacity: '0' });
    }
    await expect(painel).toHaveCSS('animation-name', 'app-leave-hold');
    await page.evaluate(() =>
      document
        .querySelector('app-filter-panel')
        ?.getAnimations({ subtree: true })
        .forEach((animacao) => animacao.finish()),
    );
    await expect(painel).toHaveCount(0);
  });
});

/** Grava cada animação CSS que começa num elemento que casa com o seletor; devolve quem lê e esvazia a gravação. */
async function gravarAnimacoes(page: Page, seletor: string): Promise<() => Promise<Entrada[]>> {
  await page.addInitScript((seletor) => {
    const gravadas: Entrada[] = [];
    Object.assign(window, { gravadas });
    document.addEventListener('animationstart', (evento) => {
      const alvo = evento.target as Element;
      if (!alvo.matches(seletor)) {
        return;
      }
      const efeito = alvo
        .getAnimations()
        .find((a) => (a as CSSAnimation).animationName === evento.animationName)?.effect as
        KeyframeEffect | undefined;
      gravadas.push({
        nome: evento.animationName,
        duracao: efeito?.getTiming().duration as number,
        quadros: efeito?.getKeyframes() ?? [],
      });
    });
  }, seletor);
  return () =>
    page.evaluate(() => (window as unknown as { gravadas: Entrada[] }).gravadas.splice(0));
}

/** Abre e fecha a folha Settings; devolve o que animou na entrada e na saída. */
async function folhaQueAbreEFecha(
  page: Page,
  tokens: TokenTracker,
): Promise<{ entrada: Entrada[]; saida: Entrada[] }> {
  const lidas = await gravarAnimacoes(page, '.sheet');
  const tokenId = await tokens.create();
  await seedStorage(page, { hideTutorial: 'true' });
  await page.goto(`/#/${tokenId}`);
  await page.getByRole('button', { name: 'Settings' }).click();
  const folha = page.getByRole('dialog', { name: 'Settings' });
  await expect(folha).toBeVisible();
  await expect
    .poll(
      async () =>
        await page.evaluate(() => (window as unknown as { gravadas: unknown[] }).gravadas.length),
    )
    .toBeGreaterThan(0);
  const entrada = await lidas();
  await folha.getByRole('button', { name: 'Close' }).click();
  await expect(folha).toHaveCount(0);
  return { entrada, saida: await lidas() };
}

test.describe('Dado o sistema pedindo menos movimento e as folhas do rail', () => {
  test('deve abrir a folha só com o fade de 120 ms e fechá-la na hora', async ({
    page,
    tokens,
  }) => {
    const { entrada, saida } = await folhaQueAbreEFecha(page, tokens);

    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ nome: 'app-born-fade', duracao: 120 });
    expect(saida).toEqual([]);
  });
});

test.describe('Dado o movimento normal e as folhas do rail', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('deve trazer a folha 24 px da direita em 120 ms e fechá-la num fade de 120 ms', async ({
    page,
    tokens,
  }) => {
    const { entrada, saida } = await folhaQueAbreEFecha(page, tokens);

    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ nome: 'app-arrive-across', duracao: 120 });
    expect(entrada[0].quadros[0]).toMatchObject({
      transform: expect.stringMatching(/^translateX?\(24px\)$/),
    });
    expect(saida).toHaveLength(1);
    expect(saida[0]).toMatchObject({ nome: 'app-leave', duracao: 120 });
    expect(saida[0].quadros.at(-1)).toMatchObject({ opacity: '0' });
  });
});

/** Pede a explicação de uma requisição com o modelo simulado (responde em 600 ms); devolve a espera e a resposta. */
async function explicacaoQueChega(
  page: Page,
  tokens: TokenTracker,
): Promise<{ espera: string[]; resposta: Entrada[] }> {
  const tokenId = await tokens.create();
  await tokens.send(tokenId, { path: '/explicar' });
  await seedStorage(page, { hideTutorial: 'true' });
  await page.route('**/explain', async (rota) => {
    await new Promise((pronto) => setTimeout(pronto, 600));
    await rota.fulfill({ json: { explanation: 'Respondeu 200 pela resposta padrão.' } });
  });
  await page.goto(`/#/${tokenId}`);
  await page
    .getByRole('toolbar', { name: 'Request actions' })
    .getByRole('button', { name: /^Explain/ })
    .click();
  const corrida = page.locator('app-ai-wait .run');
  await expect(corrida).toBeVisible();
  const espera = await corrida.evaluate((elemento) => [
    ...new Set(
      elemento
        .getAnimations()
        .flatMap((animacao) => (animacao.effect as KeyframeEffect).getKeyframes())
        .flatMap((quadro) =>
          Object.keys(quadro).filter(
            (chave) => !['offset', 'computedOffset', 'easing', 'composite'].includes(chave),
          ),
        ),
    ),
  ]);
  const texto = page.getByRole('region', { name: 'Explanation' }).locator('app-markdown');
  await expect(texto).toContainText('Respondeu 200');
  return { espera, resposta: await animacoesDe(texto) };
}

test.describe('Dado o sistema pedindo menos movimento e a IA', () => {
  test('deve esperar com a barra parada e mostrar a resposta só com o fade de 120 ms', async ({
    page,
    tokens,
  }) => {
    const { espera, resposta } = await explicacaoQueChega(page, tokens);

    expect(espera).toEqual([]);
    expect(resposta).toHaveLength(1);
    expect(resposta[0]).toMatchObject({ nome: 'app-born-fade', duracao: 120 });
  });
});

test.describe('Dado o movimento normal e a IA', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('deve esperar com a barra andando só por transform e trazer a resposta de 8 px acima em 120 ms', async ({
    page,
    tokens,
  }) => {
    const { espera, resposta } = await explicacaoQueChega(page, tokens);

    expect(espera).toEqual(['transform']);
    expect(resposta).toHaveLength(1);
    expect(resposta[0]).toMatchObject({ nome: 'app-arrive', duracao: 120 });
  });
});

/** Abre Rules de uma URL com uma regra; devolve o interruptor dela. */
async function interruptorDeRegra(page: Page, tokens: TokenTracker): Promise<Locator> {
  const tokenId = await tokens.create();
  const regras = await page.request.put(`/token/${tokenId}/rules`, {
    data: [{ name: 'Pago', priority: 1, match: { method: ['POST'] }, response: { status: 202 } }],
  });
  expect(regras.status()).toBe(200);
  await seedStorage(page, { hideTutorial: 'true' });
  await page.goto(`/#/${tokenId}/rules`);
  const interruptor = page.locator('app-rule-switch').first();
  await expect(interruptor).toBeVisible();
  return interruptor;
}

test.describe('Dado o sistema pedindo menos movimento e o interruptor de regra', () => {
  test('deve trocar só a cor do trilho e da alça, sem a alça andar', async ({ page, tokens }) => {
    const interruptor = await interruptorDeRegra(page, tokens);

    await expect(interruptor.locator('.handle')).toHaveCSS(
      'transition-property',
      'background-color',
    );
    await expect(interruptor.locator('.track')).toHaveCSS(
      'transition-property',
      'background-color',
    );
  });
});

test.describe('Dado o movimento normal e o interruptor de regra', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('deve andar a alça só por transform em 120 ms, com a cor junto', async ({
    page,
    tokens,
  }) => {
    const interruptor = await interruptorDeRegra(page, tokens);
    const alca = interruptor.locator('.handle');

    await expect(alca).toHaveCSS('transition-property', 'transform, background-color');
    await expect(alca).toHaveCSS('transition-duration', '0.12s, 0.12s');
    await expect(interruptor.locator('.track')).toHaveCSS('transition-duration', '0.12s');
  });
});

test.describe('Dado o sistema pedindo menos movimento e o estado do cenário que muda', () => {
  test('deve manter o halo de cor do estado novo, que não desloca nada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const regras = await page.request.put(`/token/${tokenId}/rules`, {
      data: [
        {
          name: 'Início',
          priority: 1,
          scenario: { name: 'entrega', requiredState: 'Started', newState: 'enviada' },
        },
      ],
    });
    expect(regras.status()).toBe(200);
    await seedStorage(page, { hideTutorial: 'true' });
    await page.goto(`/#/${tokenId}/rules`);
    await page
      .getByRole('table', { name: 'Rules' })
      .getByRole('row', { name: /Início/ })
      .locator('td.item')
      .getByRole('button')
      .click();
    await page.getByRole('tab', { name: /Scenario/ }).click();
    const estado = page.locator('app-scenario-diagram .pill').first();
    await expect(estado).toBeVisible();

    await estado.evaluate((pilula) => pilula.classList.add('changed'));

    await expect(estado).toHaveCSS('animation-name', /state-changed$/);
  });
});
