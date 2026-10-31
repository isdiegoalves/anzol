import { createHmac } from 'node:crypto';
import { Page } from '@playwright/test';
import { TokenTracker, expect, test } from './support/fixtures';
import { seedStorage } from './support/storage';

// Feature "Circuito", F2: o pulso de cada chegada, a escada de rajada com histerese, a linha que nasce do nó Resposta e
// o que nunca anima (demo combinada; proposta 1 §4 M1–M2). Tempos e curvas pela WAAPI do navegador (`getAnimations`).

const SEGREDO = 'segredo-pulso';

function assinado(corpo: string, segredo = SEGREDO) {
  return {
    path: '/webhooks/pagamentos',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`,
    },
    data: corpo,
  };
}

/** Grava, na página, quando cada coisa aparece: o ponto do pulso, o rastro, a linha que nasce e o que o leitor ouve. */
async function cronometrar(page: Page): Promise<void> {
  await page.addInitScript(() => {
    /** As animações do elemento no instante em que ele aparece (o ponto dura 720 ms; a classe da linha, 600). */
    const animacoesDe = (el: Element) =>
      el.getAnimations().map((animacao) => {
        const efeito = animacao.effect as KeyframeEffect;
        const tempo = efeito.getTiming();
        return {
          nome: (animacao as CSSAnimation).animationName ?? '',
          duracao: tempo.duration,
          atraso: tempo.delay,
          curva: tempo.easing ?? '',
          quadros: efeito.getKeyframes(),
        };
      });
    const marcas = {
      pontos: [] as number[],
      rastros: [] as number[],
      nascidas: [] as number[],
      falas: [] as { t: number; texto: string }[],
      ponto: [] as unknown[],
      rastro: [] as unknown[],
      entrada: [] as unknown[],
    };
    Object.assign(window, { marcas });
    const nasceu = (el: Element, t: number) => {
      if (marcas.nascidas.length === 0 || t - marcas.nascidas[marcas.nascidas.length - 1] > 50) {
        marcas.nascidas.push(t);
        marcas.entrada = animacoesDe(el);
      }
    };
    new MutationObserver((mudancas) => {
      const t = performance.now();
      for (const mudanca of mudancas) {
        for (const no of mudanca.addedNodes) {
          if (!(no instanceof Element)) {
            continue;
          }
          if (no.matches('.fx .dot')) {
            marcas.pontos.push(t);
            marcas.ponto = animacoesDe(no);
          }
          if (no.matches('.fx .trail')) {
            marcas.rastros.push(t);
            marcas.rastro = animacoesDe(no);
          }
          const linha = no.matches('.item.app-born') ? no : no.querySelector('.item.app-born');
          if (linha) {
            nasceu(linha, t);
          }
        }
        const alvo =
          mudanca.target instanceof Element ? mudanca.target : mudanca.target.parentElement;
        if (mudanca.type === 'attributes' && alvo?.matches('.item.app-born')) {
          nasceu(alvo, t);
        }
        const viva = alvo?.closest('.cdk-live-announcer-element');
        if (viva && viva.textContent?.trim()) {
          marcas.falas.push({ t, texto: viva.textContent.trim() });
        }
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
}

interface Animacao {
  nome: string;
  duracao: number;
  atraso: number;
  curva: string;
  quadros: ComputedKeyframe[];
}

interface Marcas {
  pontos: number[];
  rastros: number[];
  nascidas: number[];
  falas: { t: number; texto: string }[];
  ponto: Animacao[];
  rastro: Animacao[];
  entrada: Animacao[];
}

/** O tempo real aberto: a chegada vem pelo evento (a que a volta da conexão traz não tem pulso). */
const aoVivo = (page: Page) => expect(page.locator('app-live-status')).toContainText('Live');

const marcas = (page: Page) =>
  page.evaluate(() => (window as unknown as { marcas: Marcas }).marcas);
const circuito = (page: Page) => page.getByRole('region', { name: 'URL circuit' });
const linhas = (page: Page) =>
  page.getByRole('region', { name: 'Request list', exact: true }).locator('.item');

/** O valor de um token do tema, como o navegador o calcula. */
const token = (page: Page, nome: string) =>
  page.evaluate(
    (variavel) => getComputedStyle(document.documentElement).getPropertyValue(variavel).trim(),
    nome,
  );

/** A URL da demo, R1: assinatura e schema, sem regras. */
async function urlR1(page: Page, tokens: TokenTracker): Promise<string> {
  const tokenId = await tokens.create({
    signature: { provider: 'github', secret: SEGREDO },
    schema: { type: 'object', required: ['event_id'] },
  });
  await seedStorage(page, { hideTutorial: 'true' });
  return tokenId;
}

/** A URL da demo, R2: P1–P3 e uma mensagem antiga. */
async function urlR2(page: Page, tokens: TokenTracker): Promise<string> {
  const tokenId = await urlR1(page, tokens);
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
      {
        name: 'Pedido inexistente',
        priority: 3,
        match: { method: ['DELETE'], path: { prefix: '/webhooks/pedidos' } },
        response: { status: 404 },
      },
    ],
  });
  expect(regras.status()).toBe(200);
  await tokens.send(tokenId, assinado('{"event_id":"antiga"}'));
  return tokenId;
}

/** As animações do circuito agora, com o que interessa de cada uma. */
const animacoes = (page: Page, seletor: string) =>
  page.locator(seletor).evaluateAll((elementos) =>
    elementos.flatMap((el) =>
      el.getAnimations().map((animacao) => {
        const efeito = animacao.effect as KeyframeEffect;
        const tempo = efeito.getTiming();
        return {
          nome: (animacao as CSSAnimation).animationName ?? '',
          duracao: tempo.duration,
          atraso: tempo.delay,
          curva: tempo.easing ?? '',
          quadros: efeito.getKeyframes(),
        };
      }),
    ),
  );

test.describe('Dado uma chegada isolada pelo tempo real', () => {
  test('deve percorrer o caminho com o pulso (180 ms por aresta, com rastro) e a linha nascer do nó Resposta, com o anúncio no mesmo instante (CA-1)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await urlR1(page, tokens);
    await cronometrar(page);
    await page.goto(`/#/${tokenId}`);
    await aoVivo(page);
    await expect(circuito(page).getByRole('img')).toHaveAccessibleName(/No request open\.$/);
    const mola = await token(page, '--app-spring-standard');
    const efeitos = (await token(page, '--app-spring-effects')).replace(/^231ms\s+/, '');

    await tokens.send(tokenId, assinado('{"event_id":"evt_pf_7Q2K1001"}'));

    // O ponto e o rastro: 3 saltos (Remetente → Assinatura → Schema → Resposta) de 180 ms, cada um na mola.
    await expect.poll(async () => (await marcas(page)).pontos.length).toBe(1);
    const { ponto: doPonto, rastro } = await marcas(page);
    expect(doPonto[0]).toMatchObject({ duracao: 540, atraso: 0 });
    expect(doPonto[0].quadros.map((quadro) => quadro.offset)).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(normal(String(doPonto[0].quadros[1].easing))).toBe(normal(mola));
    // No nó Resposta, o ponto se desfaz no tempo de um salto (cresce e some).
    expect(doPonto[1]).toMatchObject({ duracao: 180, atraso: 540 });
    expect(normal(doPonto[1].curva)).toBe(normal(efeitos));
    expect(rastro[0]).toMatchObject({ duracao: 540 });
    // A chegada que a tela abre (a primeira da Entrada vazia) aparece de passagem: o ✓ da assinatura em 180 ms.
    const glifo = await animacoes(page, 'app-circuit [data-key="signature:gl"]');
    expect(glifo[0]).toMatchObject({ duracao: 231, atraso: 180 });
    expect(normal(glifo[0].curva)).toBe(normal(efeitos));
    expect((await animacoes(page, 'app-circuit [data-key="response:data"]'))[0]).toMatchObject({
      atraso: 540,
    });
    // O caminho fica em tinta cheia até a linha nascer e assenta em 1,5 s.
    expect((await animacoes(page, 'app-circuit .route'))[0]).toMatchObject({ duracao: 720 + 1500 });

    // A linha nasce quando o pulso se desfaz (720 ms), descendo 16 px e aparecendo em 224 ms.
    await expect(linhas(page)).toHaveCount(1);
    const nascida = linhas(page).first();
    await expect.poll(async () => (await marcas(page)).nascidas.length).toBe(1);
    const [entrada] = (await marcas(page)).entrada;
    expect(entrada).toMatchObject({ nome: 'app-born', duracao: 224 });
    // Numa animação CSS, a curva fica nos quadros (`animation-timing-function`).
    expect(normal(String(entrada.quadros[0].easing))).toBe(normal(mola));
    expect(entrada.quadros[0]).toMatchObject({ opacity: '0', transform: 'translateY(-16px)' });
    const { pontos, nascidas, falas } = await marcas(page);
    const atraso = nascidas[0] - pontos[0];
    expect(atraso).toBeGreaterThanOrEqual(690);
    expect(atraso).toBeLessThan(900);
    // O leitor ouve a chegada no mesmo instante (o anunciador do CDK escreve 100 ms depois de chamado).
    await expect.poll(async () => (await marcas(page)).falas.length).toBeGreaterThan(0);
    const fala = (await marcas(page)).falas[0];
    expect(fala.texto).toMatch(/^First request arrived: POST \/webhooks\/pagamentos/);
    expect(Math.abs(fala.t - nascidas[0])).toBeLessThan(200);
    expect(falas.every((cada) => cada.t >= nascidas[0] - 50)).toBe(true);
    await expect(circuito(page).getByRole('img')).toHaveAccessibleName(
      /path: signature ✓ → schema ✓ → default response 200\.$/,
    );
    await expect(nascida).not.toHaveClass(/app-born/);
  });

  test('deve dizer "New request: …" quando a linha nasce, e o pulso passar sem mexer na mensagem aberta', async ({
    page,
    tokens,
  }) => {
    const tokenId = await urlR2(page, tokens);
    await cronometrar(page);
    await page.goto(`/#/${tokenId}`);
    await aoVivo(page);
    await expect(linhas(page)).toHaveCount(1);
    await linhas(page).first().getByRole('button').first().click();
    const desenho = circuito(page).getByRole('img');
    const antes = await desenho.getAttribute('aria-label');

    await tokens.send(tokenId, assinado('{"event_id":"evt_2"}', 'outro-segredo'));

    await expect.poll(async () => (await marcas(page)).pontos.length).toBe(1);
    // 5 saltos: até a escada e pela regra P1 até a Resposta.
    expect((await marcas(page)).ponto[0]).toMatchObject({ duracao: 900 });
    expect(await desenho.getAttribute('aria-label')).toBe(antes);
    await expect(linhas(page)).toHaveCount(2);
    await expect
      .poll(async () => (await marcas(page)).falas.map((fala) => fala.texto))
      .toContain(
        'New request: POST /webhooks/pagamentos; answered 401 by rule Assinatura inválida; signature invalid; schema valid.',
      );
    const { pontos, nascidas } = await marcas(page);
    expect(nascidas[0] - pontos[0]).toBeGreaterThanOrEqual(1050);
  });
});

test.describe('Dado uma rajada', () => {
  test('deve dar pulso só até 5 por segundo e virar fluxo: arestas engrossando, o medidor e os contadores rolando 231 ms, com histerese de 2 s (CA-2)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await urlR2(page, tokens);
    await cronometrar(page);
    await page.goto(`/#/${tokenId}`);
    await aoVivo(page);
    await expect(linhas(page)).toHaveCount(1);
    const efeitos = (await token(page, '--app-spring-effects')).replace(/^231ms\s+/, '');

    for (let n = 1; n <= 8; n++) {
      void tokens.send(tokenId, assinado(`{"event_id":"r${n}"}`));
      await page.waitForTimeout(60);
    }
    await expect(linhas(page)).toHaveCount(9);
    await expect(circuito(page).locator('.lab.meter')).toHaveText(/^\d+\/s$/);
    const { pontos, rastros } = await marcas(page);
    // O inteiro da primeira (com rastro), pulsos curtos até a 5.ª, e nenhum pulso depois.
    expect(rastros).toHaveLength(1);
    expect(pontos.length).toBeLessThanOrEqual(5);
    // As arestas do caminho engrossam pela contagem, com o passo de 231 ms; os contadores rolam no mesmo passo.
    const aresta = circuito(page).locator('.edge[data-edge="rs"]');
    expect(
      Number.parseFloat(await aresta.evaluate((el) => getComputedStyle(el).strokeWidth)),
    ).toBeGreaterThan(1);
    expect(await aresta.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0.231s');
    const contador = circuito(page).locator('[data-key="default:ann"] .ctr');
    await expect(contador).toHaveCount(1);
    expect(await contador.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe('--n');
    expect(await contador.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0.231s');
    expect(
      normal(await contador.evaluate((el) => getComputedStyle(el).transitionTimingFunction)),
    ).toBe(normal(efeitos));
    await expect(circuito(page).locator('[data-key="default:ann"]')).toHaveText('200 · 9');

    // Uma chegada dentro da histerese (2 s depois de a janela voltar abaixo do limiar): ainda fluxo, sem pulso.
    await page.waitForTimeout(800);
    const pulsosAntes = (await marcas(page)).pontos.length;
    await tokens.send(tokenId, assinado('{"event_id":"meio"}'));
    await expect(linhas(page)).toHaveCount(10);
    expect((await marcas(page)).pontos).toHaveLength(pulsosAntes);
    // Passada a histerese, o medidor sai e a chegada isolada volta a ter o pulso inteiro.
    await expect(circuito(page).locator('.lab.meter')).toHaveCount(0, { timeout: 5000 });
    // Sozinha na janela de 1 s (a do meio já saiu dela): pulso inteiro, com rastro.
    await page.waitForTimeout(1100);
    await tokens.send(tokenId, assinado('{"event_id":"depois"}'));
    await expect.poll(async () => (await marcas(page)).rastros.length).toBe(2);
  });

  test('deve rolar os contadores sem ficar para trás numa rajada de 60 por segundo, e chegar ao número quando ela acaba (CA-2, C-6)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await urlR2(page, tokens);
    await tokens.sendMany(tokenId, 19);
    await page.goto(`/#/${tokenId}`);
    await aoVivo(page);
    await expect(page.getByRole('heading', { name: 'Requests (20)' })).toBeVisible();
    // Como na demo R2: a vista fora do topo (a pílula conta), o caso em que cada chegada mede a lista.
    await page.locator('cdk-virtual-scroll-viewport').evaluate((el) => el.scrollTo({ top: 200 }));
    await page.evaluate(() => {
      const atrasos: number[] = [];
      Object.assign(window, { atrasos });
      const medir = () => {
        // O total da lista (todas válidas: a padrão respondeu todas) menos o número que o contador mostra.
        const contador = document.querySelector<HTMLElement>('[data-key="default:ann"] .ctr');
        const total = /\((\d+)\)/.exec(
          document.querySelector('app-request-list h2')?.textContent ?? '',
        );
        if (contador && total) {
          atrasos.push(
            Number(total[1]) - Number(getComputedStyle(contador).getPropertyValue('--n')),
          );
        }
        requestAnimationFrame(medir);
      };
      requestAnimationFrame(medir);
    });

    // 60 por segundo, pelo relógio do Node (o `waitForTimeout` da página espaçaria mais).
    const envios: Promise<string>[] = [];
    for (let n = 1; n <= 150; n++) {
      envios.push(tokens.send(tokenId, assinado(`{"event_id":"f${n}"}`)));
      await new Promise((passo) => setTimeout(passo, 1000 / 60));
    }
    await Promise.all(envios);
    await expect(circuito(page).locator('[data-key="default:ann"] .real')).toHaveText('170');
    await page.waitForTimeout(600);

    const atrasos = await page.evaluate(() => (window as unknown as { atrasos: number[] }).atrasos);
    console.log(`atraso máximo do contador: ${Math.max(...atrasos)}`);
    // Um passo de 231 ms a 60 por segundo são uns 14 números: o contador fica no máximo uns dois passos atrás.
    expect(Math.max(...atrasos)).toBeLessThanOrEqual(30);
    expect(atrasos.at(-1)).toBe(0);
    await expect(circuito(page).locator('[data-key="default:ann"]')).toHaveText('200 · 170');
  });

  test('não deve rolar a lista nem fazer a linha nascer fora do topo; a pílula conta as novas (CA-3)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await urlR2(page, tokens);
    await tokens.sendMany(tokenId, 39);
    await cronometrar(page);
    await page.goto(`/#/${tokenId}`);
    await aoVivo(page);
    await expect(page.getByRole('heading', { name: 'Requests (40)' })).toBeVisible();
    const vista = page.locator('cdk-virtual-scroll-viewport');
    await vista.evaluate((el) => el.scrollTo({ top: 400 }));
    await page.waitForTimeout(300);
    const primeira = async () =>
      vista.evaluate((el) => {
        const topo = el.getBoundingClientRect().top;
        const item = [...el.querySelectorAll<HTMLElement>('.item')].find(
          (each) => each.getBoundingClientRect().bottom > topo + 1,
        );
        return {
          id: item?.querySelector<HTMLElement>('[data-uuid]')?.dataset['uuid'],
          y: Math.round((item?.getBoundingClientRect().top ?? 0) - topo),
        };
      });
    const antes = await primeira();

    await tokens.send(tokenId, assinado('{"event_id":"fora"}'));

    await expect(page.locator('.new-pill')).toHaveText(/1 new request/);
    await page.waitForTimeout(1300);
    expect(await primeira()).toEqual(antes);
    expect((await marcas(page)).nascidas).toHaveLength(0);
    await expect(page.locator('.item.app-born')).toHaveCount(0);
  });
});

test.describe('Dado as ações frequentes', () => {
  test('não deve animar nada no circuito nem na lista com J/K, a seleção, o filtro pelo nó e o hover no nó (CA-6)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await urlR2(page, tokens);
    await tokens.send(tokenId, assinado('{"event_id":"b"}', 'outro'));
    await tokens.send(tokenId, assinado('{"event_id":"c"}'));
    await page.goto(`/#/${tokenId}`);
    await aoVivo(page);
    await expect(linhas(page)).toHaveCount(3);
    const semMotion = async (passo: string) => {
      const vivas = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((animacao) => {
            const alvo = (animacao.effect as KeyframeEffect | null)?.target;
            return (
              !!alvo?.closest('app-circuit, app-request-list .list') &&
              animacao.playState === 'running'
            );
          })
          .map((animacao) => (animacao.effect as KeyframeEffect).target?.className),
      );
      expect(vivas, passo).toEqual([]);
    };

    await linhas(page).nth(1).getByRole('button').first().click();
    await semMotion('seleção');
    await page.keyboard.press('j');
    await semMotion('J');
    await page.keyboard.press('k');
    await semMotion('K');
    const p1 = circuito(page).getByRole('button', { name: /^Rule P1 Assinatura inválida/ });
    await p1.hover();
    await semMotion('hover');
    await p1.click();
    await expect(p1).toHaveAttribute('aria-pressed', 'true');
    await semMotion('filtro');
    await expect(circuito(page)).not.toHaveClass(/rolls/);
    await p1.click();
    await expect(p1).toHaveAttribute('aria-pressed', 'false');
    await semMotion('tirar o filtro');
  });
});

/** A curva como o navegador a devolve pode trazer as porcentagens dos pontos: compara-se só os valores. */
function normal(curva: string): string {
  return (curva.replace(/-?[\d.]+%/g, '').match(/-?\d*\.?\d+/g) ?? []).map(Number).join(',');
}
