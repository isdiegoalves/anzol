import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirMensagem } from './support/inbox';
import { editor, gravarRegras } from './support/regras';
import { seedStorage } from './support/storage';

/**
 * Dá o foco a cada elemento focável da tela e devolve os que não mostram o contorno de 3 px, neles ou no contêiner
 * que o desenha por `:focus-within`. Os componentes do Material ficam de fora: o anel deles é um pseudo-elemento, e o
 * campo de texto mostra o foco na borda; quem os mede é `tracoDoFoco`.
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

interface Traco {
  /** Espessura, em px, do traço que o foco acrescenta com 3:1 ou mais contra o que havia no lugar. */
  espessura: number;
  contraste: number;
}

/**
 * Mede o indicador de foco pelos pixels, sem olhar o DOM: fotografa o controle sem foco e com o foco do teclado e
 * procura o traço novo. Serve para qualquer controle, do contorno da tela ao anel e à borda do Material.
 */
async function tracoDoFoco(page: Page, alvo: Locator, margem = 10): Promise<Traco> {
  await alvo.scrollIntoViewIfNeeded();
  const caixa = await alvo.boundingBox();
  if (!caixa) {
    throw new Error('controle fora da tela');
  }
  const clip = {
    x: Math.max(0, Math.floor(caixa.x) - margem),
    y: Math.max(0, Math.floor(caixa.y) - margem),
    width: Math.ceil(caixa.width) + 2 * margem,
    height: Math.ceil(caixa.height) + 2 * margem,
  };
  const foto = async () =>
    (await page.screenshot({ clip, scale: 'css', animations: 'disabled', caret: 'hide' })).toString(
      'base64',
    );
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  const antes = await foto();
  // Depois de uma tecla, o foco dado pelo script conta como foco de teclado (`:focus-visible`).
  await page.keyboard.press('Shift');
  await alvo.focus();
  const depois = await foto();

  return page.evaluate(
    async ([semFoco, comFoco]) => {
      const pixels = async (base64: string) => {
        const resposta = await fetch(`data:image/png;base64,${base64}`);
        const imagem = await createImageBitmap(await resposta.blob());
        const tela = new OffscreenCanvas(imagem.width, imagem.height).getContext('2d');
        if (!tela) {
          throw new Error('sem canvas');
        }
        tela.drawImage(imagem, 0, 0);
        return tela.getImageData(0, 0, imagem.width, imagem.height);
      };
      const [a, d] = [await pixels(semFoco), await pixels(comFoco)];
      const { width: w, height: h } = d;
      const cor = (imagem: ImageData, i: number) => [
        imagem.data[4 * i],
        imagem.data[4 * i + 1],
        imagem.data[4 * i + 2],
      ];
      const luz = (rgb: number[]) => {
        const [r, g, b] = rgb.map((canal) => {
          const c = canal / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contraste = (x: number[], y: number[]) => {
        const [clara, escura] = [luz(x), luz(y)].sort((p, q) => q - p);
        return (clara + 0.05) / (escura + 0.05);
      };
      // O traço é o que mudou com 3:1 ou mais contra o que havia; a cor dele, a mais comum entre esses pixels (o
      // texto e o cursor são poucos).
      const tom = (i: number) =>
        cor(d, i)
          .map((canal) => canal >> 3)
          .join();
      const novos: number[] = [];
      for (let i = 0; i < w * h; i++) {
        if (contraste(cor(d, i), cor(a, i)) >= 3) {
          novos.push(i);
        }
      }
      if (novos.length === 0) {
        return { espessura: 0, contraste: 0 };
      }
      const vezes = new Map<string, number>();
      for (const i of novos) {
        vezes.set(tom(i), (vezes.get(tom(i)) ?? 0) + 1);
      }
      const [doTraco] = [...vezes].sort((p, q) => q[1] - p[1])[0];
      const traco = novos.filter((i) => tom(i) === doTraco);
      // Em cada pixel do traço, a menor corrida de pixels da cor dele, na horizontal ou na vertical.
      const corrida = (i: number, passo: number) => {
        let n = 0;
        for (let j = i + passo; j >= 0 && j < w * h && tom(j) === doTraco; j += passo) {
          if (Math.abs(passo) === 1 && Math.floor(j / w) !== Math.floor(i / w)) {
            break;
          }
          n++;
        }
        return n;
      };
      const meio = (valores: number[]) =>
        valores.sort((p, q) => p - q)[Math.floor(valores.length / 2)];
      return {
        espessura: meio(
          traco.map((i) =>
            Math.min(corrida(i, 1) + corrida(i, -1) + 1, corrida(i, w) + corrida(i, -w) + 1),
          ),
        ),
        contraste: meio(traco.map((i) => contraste(cor(d, i), cor(a, i)))),
      };
    },
    [antes, depois] as const,
  );
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

  test('deve dar aos componentes do Material um traço de foco de 3 px, com 3:1 contra o fundo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: 'segredo-do-foco' },
    });
    const requestId = await tokens.send(tokenId, {
      path: '/pedidos',
      headers: { 'Content-Type': 'application/json' },
      data: '{"id":1}',
    });
    await seedStorage(page, { hideTutorial: 'true' });
    await abrirMensagem(page, tokenId, requestId);

    const noDetalhe: [string, Locator][] = [
      ['o botão cheio', page.getByRole('button', { name: /^Replay/ }).first()],
      ['o botão de texto', page.getByRole('button', { name: 'Compare with…' })],
      ['o interruptor', page.getByRole('switch', { name: 'Pretty', exact: true })],
      ['a aba', page.getByRole('tab', { name: /^Headers/ })],
    ];
    for (const [nome, controle] of noDetalhe) {
      const traco = await tracoDoFoco(page, controle);
      expect(traco.espessura, `${nome}: espessura`).toBeGreaterThanOrEqual(3);
      expect(traco.contraste, `${nome}: contraste`).toBeGreaterThanOrEqual(3);
    }

    // Com o clique do mouse o foco vai ao controle, e o traço não aparece.
    const pretty = page.getByRole('switch', { name: 'Pretty', exact: true });
    await pretty.click();
    await expect(pretty).toBeFocused();
    await expect(page.locator('mat-slide-toggle').filter({ has: pretty })).toHaveCSS(
      'outline-style',
      'none',
    );

    await page.goto(`/#/${tokenId}/checks`);
    const segredo = page.getByRole('textbox', { name: 'HMAC secret' });
    await expect(segredo).toBeVisible();
    // O campo desenha o foco na borda da caixa dele, que fica longe do <input>.
    const traco = await tracoDoFoco(page, segredo, 28);
    expect(traco.espessura, 'o campo: espessura').toBeGreaterThanOrEqual(3);
    expect(traco.contraste, 'o campo: contraste').toBeGreaterThanOrEqual(3);
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
