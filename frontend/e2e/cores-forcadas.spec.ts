import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirMensagem, item, lista } from './support/inbox';
import {
  abrirRegra,
  abrirRegras,
  dialogo,
  gravarRegras,
  linhaDaRegra,
  novaRegra,
  parte,
} from './support/regras';
import { destino, prenderPedacos, tracoDeProgresso } from './support/shell';
import { seedStorage } from './support/storage';

const SEGREDO = 'segredo-das-cores-forcadas';
const CHAVE = 'x-evento';
// O alvo do reenvio é o próprio Anzol, visto do container.
const RECEPTOR = process.env['E2E_RECEIVER_HOST'] ?? 'host.docker.internal';

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

const evento = (page: Page, valor: string) =>
  lista(page)
    .locator('app-event-line')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^Event ${valor}, `) }) });

/** A aba aberta é a única sublinhada: nas outras, a borda sai na cor do papel. */
async function expectSoEstaAbaSublinhada(abas: Locator, aberta: Locator, sistema: Sistema) {
  await expect(aberta).toHaveAttribute('aria-selected', 'true');
  expect(await estilo(aberta, 'border-bottom-color'), 'a aberta, sublinhada').not.toBe(
    sistema.papel,
  );
  const outras = abas.and(abas.page().locator('[aria-selected="false"]'));
  expect(await outras.count(), 'há outras abas').toBeGreaterThan(0);
  for (const outra of await outras.all()) {
    expect(await estilo(outra, 'border-bottom-color'), 'as outras, não').toBe(sistema.papel);
  }
}

/** O método ligado sai nas cores do item escolhido; os outros ficam só com a borda. */
async function expectSoEsteMetodoPintado(metodos: Locator, ligado: string, sistema: Sistema) {
  const chip = (nome: string) => metodos.getByRole('button', { name: nome, exact: true });
  await expect(chip(ligado)).toHaveAttribute('aria-pressed', 'true');
  expect(await estilo(chip(ligado), 'background-color'), 'o método ligado').toBe(sistema.escolhido);
  const desligados = metodos.locator('[aria-pressed="false"]');
  expect(await desligados.count(), 'há métodos desligados').toBeGreaterThan(0);
  for (const desligado of await desligados.all()) {
    expect(await estilo(desligado, 'background-color'), 'os desligados').not.toBe(
      sistema.escolhido,
    );
  }
}

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

  test('deve pôr a régua no evento com tentativa que falhou ou que veio antes da espera, e só nele', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      default_status: '429',
      retry_after: '3',
      signature: { provider: 'github', secret: SEGREDO },
    });
    // Quem traz `x-final` é respondido pela regra, sem espera pedida.
    await gravarRegras(page.request, tokenId, [
      {
        name: 'Aceita',
        priority: 1,
        match: { headers: { 'x-final': { present: true } } },
        response: { status: 200 },
      },
    ]);
    const tentativa = (valor: string, extra: Record<string, string> = {}, segredo = SEGREDO) =>
      tokens.send(tokenId, {
        path: '/notificacoes',
        headers: { ...assinado('{"n":1}', segredo), [CHAVE]: valor, ...extra },
        data: '{"n":1}',
      });
    await tentativa('evt_inteiro', { 'x-final': '1' });
    await tentativa('evt_inteiro', { 'x-final': '1' });
    await tentativa('evt_cedo');
    await tentativa('evt_cedo');
    await tentativa('evt_falha', { 'x-final': '1' });
    await tentativa('evt_falha', { 'x-final': '1' }, 'outro-segredo');
    await seedStorage(page, { hideTutorial: 'true', [`anzol.eventKey.${tokenId}`]: CHAVE });
    await page.goto(`/#/${tokenId}`);
    await expect(lista(page).locator('app-event-line')).toHaveCount(3);
    const sistema = await coresDoSistema(page);

    await expect(evento(page, 'evt_falha')).toContainText('1 signature does not match');
    expect(
      await estilo(evento(page, 'evt_falha'), 'background-color', '::after'),
      'a régua do evento com falha',
    ).toBe(sistema.tinta);
    await expect(evento(page, 'evt_cedo')).toContainText('came before the asked wait');
    expect(
      await estilo(evento(page, 'evt_cedo'), 'background-color', '::after'),
      'a do evento com tentativa antes da espera',
    ).toBe(sistema.tinta);
    expect(
      await estilo(evento(page, 'evt_inteiro'), 'content', '::after'),
      'o evento sem nada a rever não tem régua',
    ).toBe('none');
  });

  test('deve emoldurar na Saída a linha escolhida do histórico e sublinhar só a aba aberta do resultado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const destino = await tokens.create({ default_status: '201' });
    const origem = await tokens.send(tokenId, { path: '/x', data: 'um' });
    const porta = new URL(test.info().project.use.baseURL ?? '').port || '80';
    for (let i = 0; i < 2; i++) {
      const reenvio = await page.request.post(`/token/${tokenId}/request/${origem}/replay`, {
        data: { url: `http://${RECEPTOR}:${porta}/${destino}`, keep_path: true },
      });
      expect(reenvio.status(), await reenvio.text()).toBe(200);
    }
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/outbound`);
    const linhas = page.getByRole('table', { name: 'Outbound history' }).locator('tbody tr');
    await expect(linhas).toHaveCount(2);
    const detalhe = page.getByRole('region', { name: 'Outbound detail' });
    const abas = detalhe.getByRole('tab');
    await expect(abas).toHaveCount(3);
    const sistema = await coresDoSistema(page);

    await expect(linhas.first()).toHaveAttribute('aria-selected', 'true');
    expect(await estilo(linhas.first(), 'outline-style'), 'a escolhida tem moldura').toBe('solid');
    expect(await estilo(linhas.first(), 'outline-color')).toBe(sistema.escolhido);
    expect(await estilo(linhas.last(), 'outline-style'), 'só a escolhida').toBe('none');

    await expectSoEstaAbaSublinhada(abas, abas.first(), sistema);
    await abas.last().click();
    await expectSoEstaAbaSublinhada(abas, abas.last(), sistema);
  });

  test('deve sublinhar só a aba aberta das respostas renderizadas de uma regra', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    for (const caminho of ['/a', '/b']) {
      await tokens.send(tokenId, {
        path: caminho,
        headers: { 'Content-Type': 'application/json' },
        data: '{"status":"pago"}',
      });
    }
    await seedStorage(page, {});
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Eco');
    await parte(regra, 'Response');
    await regra.getByRole('switch', { name: 'Template' }).click();
    await regra.getByRole('textbox', { name: 'Response body' }).fill('{{request.path}}');
    await regra.getByRole('button', { name: 'Test against history' }).click();
    await regra.getByRole('button', { name: 'Preview response' }).click();
    const abas = regra.getByRole('region', { name: 'Rendered responses' }).getByRole('tab');
    await expect(abas).toHaveCount(2);
    const sistema = await coresDoSistema(page);

    await expectSoEstaAbaSublinhada(abas, abas.first(), sistema);
    await abas.last().click();
    await expectSoEstaAbaSublinhada(abas, abas.last(), sistema);
  });

  test('deve pintar só o método escolhido na sequência de um cenário', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await parte(regra, 'Scenario');
    await regra.getByRole('button', { name: 'Sequence…' }).click();
    const metodos = dialogo(page, 'Sequence').getByRole('group', { name: 'Methods' });
    await metodos.getByRole('button', { name: 'PUT', exact: true }).click();
    const sistema = await coresDoSistema(page);

    await expectSoEsteMetodoPintado(metodos, 'PUT', sistema);
  });

  test('deve pintar só o método escolhido no roteiro "Test a retry"', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}?guide=retry`);
    const metodos = page
      .getByRole('region', { name: 'Guide: Test a retry' })
      .getByRole('group', { name: 'Methods' });
    await metodos.getByRole('button', { name: 'PUT', exact: true }).click();
    const sistema = await coresDoSistema(page);

    await expectSoEsteMetodoPintado(metodos, 'PUT', sistema);
  });

  test('deve manter à vista o traço de progresso de quem espera o pedaço da página', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await expect(destino(page, 'Inbox')).toHaveAttribute('aria-current', 'page');
    const sistema = await coresDoSistema(page);
    const soltar = await prenderPedacos(page);

    await destino(page, 'Insights').click();

    const traco = tracoDeProgresso(page);
    await expect(traco).toBeVisible();
    expect(await estilo(traco, 'background-color')).toBe(sistema.escolhido);
    soltar();
    await expect(traco).toHaveCount(0);
  });
});
