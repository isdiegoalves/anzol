import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirMensagem, item } from './support/inbox';
import { abrirRegra, abrirRegras, gravarRegras, linhaDaRegra } from './support/regras';
import { seedStorage } from './support/storage';

const SEGREDO = 'segredo-das-cores-forcadas';

// As cores forçadas do sistema (o alto contraste do Windows): o navegador apaga fundo e sombra e pinta tudo com as
// cores de quem usa. Elas mudam de uma máquina para outra, e o teste as lê na página.
test.use({ forcedColors: 'active' });

interface Sistema {
  papel: string;
  tinta: string;
  escolhido: string;
  desligado: string;
}

function coresDoSistema(page: Page): Promise<Sistema> {
  return page.evaluate(() => {
    const sonda = document.body.appendChild(document.createElement('span'));
    const cor = (nome: string) => {
      sonda.style.color = nome;
      return getComputedStyle(sonda).color;
    };
    const cores = {
      papel: cor('canvas'),
      tinta: cor('canvastext'),
      escolhido: cor('highlight'),
      desligado: cor('graytext'),
    };
    sonda.remove();
    return cores;
  });
}

function estilo(alvo: Locator, propriedade: string, parte?: string): Promise<string> {
  return alvo.evaluate(
    (el, [nome, pseudo]) => getComputedStyle(el, pseudo).getPropertyValue(nome),
    [propriedade, parte] as const,
  );
}

function assinado(corpo: string, segredo = SEGREDO): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Hub-Signature-256': `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`,
  };
}

const seloDaAssinatura = (page: Page, uuid: string) =>
  item(page, uuid).locator('app-check-chip[data-kind="signature"]');

test.describe('Dado as cores forçadas do sistema', () => {
  test('deve marcar na Entrada a requisição aberta, a falha, o destino atual e a conexão sem depender de fundo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: SEGREDO },
      schema: { type: 'object', required: ['id'] },
    });
    const valida = await tokens.send(tokenId, {
      path: '/pago',
      headers: assinado('{"id":1}'),
      data: '{"id":1}',
    });
    const invalida = await tokens.send(tokenId, {
      path: '/outro',
      headers: assinado('{"x":1}', 'outro-segredo'),
      data: '{"x":1}',
    });
    await seedStorage(page, { hideTutorial: 'true' });
    await abrirMensagem(page, tokenId, invalida);
    const sistema = await coresDoSistema(page);

    expect(await estilo(item(page, invalida), 'outline-style'), 'a aberta tem moldura').toBe(
      'solid',
    );
    expect(await estilo(item(page, invalida), 'outline-color')).toBe(sistema.escolhido);
    expect(await estilo(item(page, valida), 'outline-style'), 'só a aberta').toBe('none');

    expect(
      await estilo(seloDaAssinatura(page, invalida), 'background-color'),
      'o selo da falha fica em negativo',
    ).toBe(sistema.tinta);
    expect(await estilo(seloDaAssinatura(page, invalida).locator('.title'), 'color')).toBe(
      sistema.papel,
    );
    expect(
      await estilo(seloDaAssinatura(page, valida), 'background-color'),
      'o selo do que passou, não',
    ).not.toBe(sistema.tinta);
    expect(
      await estilo(item(page, invalida), 'background-color', '::after'),
      'a régua da falha',
    ).toBe(sistema.tinta);

    const destinos = page.getByRole('navigation', { name: 'URL sections' });
    expect(
      await estilo(destinos.locator('[aria-current="page"] .indicator'), 'background-color'),
      'o destino atual',
    ).toBe(sistema.escolhido);
    expect(
      await estilo(
        destinos.locator('a:not([aria-current]) .indicator').first(),
        'background-color',
      ),
      'só o atual',
    ).not.toBe(sistema.escolhido);

    await expect(page.locator('app-live-status')).toContainText('Live');
    expect(
      await estilo(page.locator('app-live-status .dot'), 'background-color'),
      'o ponto do "Live"',
    ).toBe(sistema.tinta);
    expect(
      await estilo(page.getByRole('button', { name: 'Previous page' }), 'color'),
      'a página que não existe sai na cor do desligado',
    ).toBe(sistema.desligado);
  });

  test('deve mostrar em Regras a regra ligada, a desligada, a aberta, a aba e o método escolhidos', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(page.request, tokenId, [
      {
        name: 'Pago',
        priority: 1,
        match: { method: ['POST'], path: { equals: '/pago' } },
        response: { status: 201 },
      },
      { name: 'Parada', priority: 2, enabled: false, response: { status: 503 } },
    ]);
    await seedStorage(page, {});
    await abrirRegras(page, tokenId);
    const regiao = await abrirRegra(page, 'Pago');
    const sistema = await coresDoSistema(page);

    const interruptor = (nome: string) =>
      linhaDaRegra(page, nome).getByRole('switch', { name: `Enable rule ${nome}` });
    expect(
      await estilo(interruptor('Pago').locator('.track'), 'background-color'),
      'o trilho da ligada, cheio',
    ).toBe(sistema.escolhido);
    expect(
      await estilo(interruptor('Parada').locator('.track'), 'background-color'),
      'o da desligada, vazio',
    ).not.toBe(sistema.escolhido);
    expect(
      await estilo(interruptor('Parada').locator('.handle'), 'background-color'),
      'a alça da desligada à vista',
    ).toBe(sistema.tinta);

    expect(await estilo(linhaDaRegra(page, 'Pago'), 'outline-style'), 'a regra aberta').toBe(
      'solid',
    );
    expect(await estilo(linhaDaRegra(page, 'Parada'), 'outline-style'), 'só a aberta').toBe('none');

    const aba = (nome: string) => regiao.getByRole('tab', { name: new RegExp(`^${nome}`) });
    expect(
      await estilo(aba('Match'), 'border-bottom-color'),
      'a aba escolhida, sublinhada',
    ).not.toBe(sistema.papel);
    expect(
      await estilo(aba('Response'), 'border-bottom-color'),
      'a outra, com a borda na cor do papel',
    ).toBe(sistema.papel);

    const metodo = (nome: string) => regiao.getByRole('button', { name: nome, exact: true });
    expect(await estilo(metodo('POST'), 'background-color'), 'o método ligado').toBe(
      sistema.escolhido,
    );
    expect(await estilo(metodo('GET'), 'background-color'), 'o desligado').not.toBe(
      sistema.escolhido,
    );
  });

  test('deve marcar em Verificações a seção em que a página está', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/checks`);
    const atalhos = page.getByRole('navigation', { name: 'On this page' });
    await expect(atalhos.locator('[aria-current]')).toHaveCount(1);
    const sistema = await coresDoSistema(page);

    expect(await estilo(atalhos.locator('[aria-current]'), 'background-color')).toBe(
      sistema.escolhido,
    );
    expect(
      await estilo(atalhos.locator('a:not([aria-current])').first(), 'background-color'),
      'só a atual',
    ).not.toBe(sistema.escolhido);
  });
});
