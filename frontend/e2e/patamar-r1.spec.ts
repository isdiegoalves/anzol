import { Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Locator, Page } from '@playwright/test';
import {
  escutarAnuncios,
  expectSemAnuncio,
  expectSoEstaFala,
  expectUmAnuncio,
  limparAnuncios,
} from './support/anuncios';
import { alvosMenores } from './support/a11y';
import { TokenTracker, expect, test } from './support/fixtures';
import {
  abrirItem,
  abrirMensagem,
  acaoDaMensagem,
  acoes,
  detalhes,
  item,
  lista,
} from './support/inbox';
import { id5, urlInexistente } from './support/patamar';
import { abrirRegras, lerRegras, metodo } from './support/regras';
import { compacto } from './support/shell';
import { readStorage, seedStorage } from './support/storage';

const RECEIVER_HOST = process.env['E2E_RECEIVER_HOST'] ?? 'host.docker.internal';
const BARRA = [
  'Replay…',
  'Compare with…',
  'Create rule from this request',
  'Copy payload',
  'Share read-only link…',
  'Explain',
];
const NO_MORE = [
  'Send as new…',
  'Create schema from this request',
  'Copy As',
  'Test a variation',
  'Permalink',
  'Raw content',
  'Delete request',
];

/** Receptor HTTP no host: responde 201 com um JSON. */
async function receptor(): Promise<{ porta: number; recebidas: string[]; server: Server }> {
  const recebidas: string[] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      recebidas.push(`${req.method} ${req.url}`);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end('{"recebido":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  return { porta: (server.address() as AddressInfo).port, recebidas, server };
}

function detalhe(page: Page): Locator {
  return page.getByRole('region', { name: 'Request detail' });
}

/** O painel de ação: `region "Action panel"` no desktop, `dialog "Actions on this request"` abaixo de 840 px. */
function painel(page: Page): Locator {
  return compacto(page)
    ? page.getByRole('dialog', { name: 'Actions on this request' })
    : page.getByRole('region', { name: 'Action panel' });
}

function aba(page: Page, nome: 'Replay' | 'Compare' | 'Create rule' | 'Explain'): Locator {
  return painel(page)
    .getByRole('tablist', { name: 'Actions on this request' })
    .getByRole('tab', { name: nome, exact: true });
}

function resultado(page: Page): Locator {
  return painel(page).getByRole('group', { name: 'Action result' }).locator('[role="status"]');
}

/** JSON com método, caminho e corpo de pedido. */
async function pedido(
  tokens: TokenTracker,
  tokenId: string,
  caminho = '/pedidos',
): Promise<string> {
  return tokens.send(tokenId, {
    path: caminho,
    headers: { 'Content-Type': 'application/json' },
    data: '{"id":"evt_ped48001","status":"pago"}',
  });
}

test.describe('Dado a barra de ações do detalhe', () => {
  for (const largura of [1440, 1024]) {
    test(`deve ter seis botões numa linha e o resto no More, a ${largura} px`, async ({
      page,
      tokens,
    }, testInfo) => {
      test.skip(!!testInfo.project.use.isMobile, 'larguras do desktop');
      await page.setViewportSize({ width: largura, height: 900 });
      const tokenId = await tokens.create();
      const id = await pedido(tokens, tokenId);
      await seedStorage(page, {});
      await abrirMensagem(page, tokenId, id);

      const botoes = acoes(page).getByRole('button');
      await expect(botoes).toHaveCount(6);
      const nomes = await botoes.evaluateAll((nos) =>
        nos.map((no) => no.getAttribute('aria-label') ?? (no.textContent ?? '').trim()),
      );
      expect(nomes).toEqual(BARRA);
      const topos = await botoes.evaluateAll((nos) =>
        nos.map((no) => Math.round(no.getBoundingClientRect().top)),
      );
      expect(new Set(topos).size, 'os seis numa linha só').toBe(1);

      await detalhe(page)
        .getByRole('button', { name: /^More(:|$)/ })
        .click();
      for (const nome of NO_MORE) {
        await expect(page.getByRole('menuitem', { name: nome, exact: true })).toBeVisible();
      }
    });
  }

  test('deve mostrar "Replay…", "Create rule", "Copy payload" e o More na barra do celular', async ({
    page,
    tokens,
  }) => {
    test.skip(!compacto(page), 'só no celular');
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);

    await expect(acoes(page).getByRole('button', { name: 'Replay…' })).toBeVisible();
    await expect(
      acoes(page).getByRole('button', { name: 'Create rule from this request' }),
    ).toBeVisible();
    await expect(acoes(page).getByRole('button', { name: 'Copy payload' })).toBeVisible();
    await expect(acoes(page).getByRole('button')).toHaveCount(3);
    await detalhe(page)
      .getByRole('button', { name: /^More(:|$)/ })
      .click();
    for (const nome of ['Compare with…', 'Explain', 'Send as new…', 'Copy As', 'Delete request']) {
      await expect(page.getByRole('menuitem', { name: nome, exact: true })).toBeVisible();
    }
  });
});

test.describe('Dado o painel de ação acoplado', () => {
  test('deve abrir na base do detalhe, sem sair da requisição, com as quatro abas', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'abaixo de 840 px o painel é folha de tela cheia');
    const tokenId = await tokens.create();
    await pedido(tokens, tokenId, '/outro');
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    await expect(painel(page)).toHaveCount(0);

    await acoes(page).getByRole('button', { name: 'Replay…' }).click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${id}/1`));
    const abas = painel(page)
      .getByRole('tablist', { name: 'Actions on this request' })
      .getByRole('tab');
    await expect(abas).toHaveText(['Replay', 'Compare', 'Create rule', 'Explain']);
    await expect(aba(page, 'Replay')).toHaveAttribute('aria-selected', 'true');
    await expect(painel(page).getByRole('textbox', { name: 'Target URL' })).toBeVisible();
    // O detalhe continua à vista acima do painel, e a lista ao lado.
    await expect(detalhes(page)).toBeInViewport();
    await expect(detalhes(page)).toContainText(id);
    await expect(lista(page)).toBeVisible();
    const coluna = (await detalhe(page).boundingBox())!;
    const caixa = (await painel(page).boundingBox())!;
    const barra = (await acoes(page).boundingBox())!;
    expect(caixa.x).toBeGreaterThanOrEqual(coluna.x - 1);
    expect(caixa.x + caixa.width).toBeLessThanOrEqual(coluna.x + coluna.width + 1);
    expect(caixa.y, 'o painel fica abaixo da barra de ações').toBeGreaterThanOrEqual(
      barra.y + barra.height - 1,
    );
    expect(
      Math.abs(caixa.y + caixa.height - (coluna.y + coluna.height)),
      'preso à base da coluna',
    ).toBeLessThanOrEqual(24);
    expect(caixa.height).toBeGreaterThanOrEqual(240);
    expect(caixa.height / coluna.height).toBeGreaterThan(0.3);
    expect(caixa.height / coluna.height).toBeLessThan(0.5);
  });

  test('deve redimensionar pelo teclado, expandir, fechar com Esc devolvendo o foco, e lembrar o estado', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'abaixo de 840 px o painel é folha de tela cheia');
    const tokenId = await tokens.create();
    const outra = await pedido(tokens, tokenId, '/outro');
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    const explicar = acoes(page).getByRole('button', { name: 'Explain' });
    await explicar.click();
    await expect(aba(page, 'Explain')).toHaveAttribute('aria-selected', 'true');

    const divisor = page.getByRole('separator', { name: 'Resize action panel' });
    const antes = Number(await divisor.getAttribute('aria-valuenow'));
    const alturaAntes = (await painel(page).boundingBox())!.height;
    await divisor.focus();
    await page.keyboard.press('ArrowUp');
    await expect(divisor).not.toHaveAttribute('aria-valuenow', String(antes));
    await expect
      .poll(async () =>
        Math.round(Math.abs((await painel(page).boundingBox())!.height - alturaAntes)),
      )
      .toBe(40);

    await painel(page).getByRole('button', { name: 'Expand panel' }).click();
    const coluna = (await detalhe(page).boundingBox())!;
    await expect
      .poll(async () => (await painel(page).boundingBox())!.height / coluna.height)
      .toBeGreaterThan(0.9);
    await painel(page).getByRole('button', { name: 'Restore panel' }).click();

    await expect.poll(async () => (await readStorage(page))['anzol.actionPanel']).toBeTruthy();
    // Lembrado: outra requisição abre com o painel, na última aba.
    await abrirMensagem(page, tokenId, outra);
    await expect(aba(page, 'Explain')).toHaveAttribute('aria-selected', 'true');

    // Pelo Replay: com o Explain, o Esc durante a espera do modelo cancela a espera antes de fechar.
    await acoes(page).getByRole('button', { name: 'Replay…' }).focus();
    await page.keyboard.press('Enter');
    await expect(painel(page).getByRole('textbox', { name: 'Target URL' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(painel(page)).toBeHidden();
    await expect(acoes(page).getByRole('button', { name: 'Replay…' })).toBeFocused();

    await acoes(page).getByRole('button', { name: 'Explain' }).click();
    await painel(page).getByRole('button', { name: 'Close panel' }).click();
    await expect(painel(page)).toBeHidden();
    await abrirMensagem(page, tokenId, id);
    await expect(painel(page)).toBeHidden();
  });

  test('deve abrir como folha de tela cheia abaixo de 840 px', async ({ page, tokens }) => {
    test.skip(!compacto(page), 'só no celular');
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);

    await acoes(page).getByRole('button', { name: 'Replay…' }).click();

    const folha = page.getByRole('dialog', { name: 'Actions on this request' });
    await expect(folha).toHaveAttribute('aria-modal', 'true');
    const caixa = (await folha.boundingBox())!;
    const tela = page.viewportSize()!;
    expect(caixa.width).toBeGreaterThanOrEqual(tela.width - 2);
    expect(caixa.height).toBeGreaterThanOrEqual(tela.height - 2);
    await expect(aba(page, 'Replay')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${id}/1`));

    await folha.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(folha).toBeHidden();
    await expect(detalhes(page)).toContainText(id);
  });

  test('deve abrir as abas pelas teclas R, D, E e abrir e fechar por P', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'teclado: só no desktop');
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    await detalhes(page).click();

    await page.keyboard.press('r');
    await expect(aba(page, 'Replay')).toHaveAttribute('aria-selected', 'true');
    await expect(painel(page).getByRole('textbox', { name: 'Target URL' })).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('e');
    await expect(aba(page, 'Explain')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('d');
    await expect(aba(page, 'Compare')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(painel(page)).toBeHidden();
    await page.keyboard.press('p');
    await expect(aba(page, 'Compare')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('p');
    await expect(painel(page)).toBeHidden();
    await expect(acoes(page).getByRole('button', { name: 'Replay…' })).toHaveAttribute(
      'aria-keyshortcuts',
      /^R$/i,
    );
  });
});

test.describe('Dado a aba Replay do painel', () => {
  let destino: Awaited<ReturnType<typeof receptor>>;

  test.beforeEach(async () => {
    destino = await receptor();
  });

  test.afterEach(async () => {
    await new Promise((resolve) => destino.server.close(resolve));
  });

  test('deve levar o foco a "Target URL" Quando o Replay abre pelo clique', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);

    await acoes(page).getByRole('button', { name: 'Replay…' }).click();

    await expect(painel(page).getByRole('textbox', { name: 'Target URL' })).toBeFocused();
  });

  test('deve reenviar sem sair da requisição, aceitar o destino sem http:// e anunciar o resultado uma vez', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    await acoes(page).getByRole('button', { name: 'Replay…' }).click();
    await expect(resultado(page)).toHaveText('');

    const alvo = painel(page).getByRole('textbox', { name: 'Target URL' });
    await alvo.fill(`${RECEIVER_HOST}:${destino.porta}/webhooks`);
    await expect(painel(page)).toContainText(
      `Sends to http://${RECEIVER_HOST}:${destino.porta}/webhooks/pedidos`,
    );
    await limparAnuncios(page);
    await alvo.press('Enter');

    await expect(resultado(page)).toContainText(/^Replay result: 201 Created in \d+ ms/);
    await expectUmAnuncio(page, /^Replay result: 201 Created in \d+ ms/, /^Action result$/);
    await expect(resultado(page)).toContainText('{"recebido":true}');
    await expect(painel(page).getByRole('link', { name: 'Open in Outbound' })).toHaveAttribute(
      'href',
      new RegExp(`#/${tokenId}/outbound`),
    );
    expect(destino.recebidas).toEqual(['POST /webhooks/pedidos']);
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${id}/1`));
    await expect(detalhes(page)).toContainText(id);
  });

  test('deve ter alvos de 24 px ou mais no detalhe e no painel, com o resultado do reenvio', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'alvos de ponteiro: os de toque têm spec própria');
    const tokenId = await tokens.create();
    const id = await tokens.send(tokenId, {
      path: '/pedidos',
      headers: { 'Content-Type': 'application/json' },
      data: '{"id":"evt_ped48001","itens":2}',
    });
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    await acoes(page).getByRole('button', { name: 'Replay…' }).click();
    const alvo = painel(page).getByRole('textbox', { name: 'Target URL' });
    await alvo.fill(`${RECEIVER_HOST}:${destino.porta}/webhooks`);
    await alvo.press('Enter');
    await expect(painel(page).getByRole('link', { name: 'Open in Outbound' })).toBeVisible();

    expect(await alvosMenores(page.locator('app-action-panel'), 24)).toEqual([]);
    expect(await alvosMenores(detalhe(page), 24)).toEqual([]);
  });

  test('deve mostrar o endereço digitado e como o servidor chega a ele', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    await acoes(page).getByRole('button', { name: 'Replay…' }).click();

    const alvo = painel(page).getByRole('textbox', { name: 'Target URL' });
    await alvo.fill(`localhost:${destino.porta}/webhooks`);
    await alvo.press('Enter');

    await expect(painel(page)).toContainText(
      `You typed localhost:${destino.porta}. The server reaches it as host.docker.internal:${destino.porta}.`,
    );
  });

  test('deve trocar com a requisição aberta e manter o destino digitado', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'lista e detalhe lado a lado: só no desktop');
    const tokenId = await tokens.create();
    const outra = await pedido(tokens, tokenId, '/outro');
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    await acoes(page).getByRole('button', { name: 'Replay…' }).click();
    const alvo = painel(page).getByRole('textbox', { name: 'Target URL' });
    await alvo.fill(`${RECEIVER_HOST}:${destino.porta}/webhooks`);

    await abrirItem(page, outra).click();

    await expect(detalhes(page)).toContainText(outra);
    await expect(alvo).toHaveValue(`${RECEIVER_HOST}:${destino.porta}/webhooks`);
    await expect(painel(page)).toContainText(
      `Sends to http://${RECEIVER_HOST}:${destino.porta}/webhooks/outro`,
    );
  });

  test('deve dizer que o destino foi bloqueado, sem instrução de operador', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    await acoes(page).getByRole('button', { name: 'Replay…' }).click();

    await painel(page)
      .getByRole('textbox', { name: 'Target URL' })
      .fill('http://169.254.169.254/x');
    await painel(page).getByRole('button', { name: 'Replay', exact: true }).click();

    await expect(resultado(page)).toContainText('Blocked');
    await expect(resultado(page)).not.toContainText(/WEBHOOK_|docker|compose/i);
  });
});

test.describe('Dado as abas Compare, Create rule e Explain do painel', () => {
  test('deve comparar com a requisição escolhida na lista, no painel, com o link da comparação inteira', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'escolher na lista ao lado: só no desktop');
    const tokenId = await tokens.create();
    const b = await tokens.send(tokenId, { headers: { 'X-Lado': 'b' }, data: 'dois' });
    const a = await tokens.send(tokenId, { headers: { 'X-Lado': 'a' }, data: 'um' });
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, a);

    await acoes(page).getByRole('button', { name: 'Compare with…' }).click();
    await expect(aba(page, 'Compare')).toHaveAttribute('aria-selected', 'true');
    await expect(painel(page)).toContainText(
      `Pick a request in the list to compare with #${id5(a)}.`,
    );
    await limparAnuncios(page);
    await item(page, b).getByRole('button').first().click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${a}/1`));
    await expect(painel(page)).toContainText(/\d+ changes? explains? the outcome/);
    await expect(painel(page).getByRole('table', { name: 'Checks' })).toBeVisible();
    await expectUmAnuncio(
      page,
      /^Compared .* \d+ changes? explains? the outcome\.$/,
      /^Action result$/,
    );
    const inteira = painel(page).getByRole('link', { name: 'Open full comparison' });
    await expect(inteira).toHaveAttribute('href', new RegExp(`#/${tokenId}/compare/${a}/${b}$`));
    await inteira.click();
    await expect(page.getByRole('region', { name: 'Compare requests' })).toBeVisible();
  });

  test('deve criar a regra pela aba Create rule e anunciar quantas ela responde', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);

    await acoes(page).getByRole('button', { name: 'Create rule from this request' }).click();

    await expect(aba(page, 'Create rule')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('dialog', { name: 'Create rule from this request' })).toHaveCount(
      0,
    );
    await expect(painel(page).getByRole('checkbox', { name: 'Method POST' })).toBeChecked();
    await expect(painel(page)).toContainText('1 of the last 500 requests would match');
    await painel(page).getByRole('spinbutton', { name: 'Status' }).fill('201');
    await limparAnuncios(page);
    await painel(page).getByRole('button', { name: 'Create rule', exact: true }).click();

    await expectSoEstaFala(
      page,
      /^Rule created: POST \/pedidos\. It answers 1 of the last 500\.$/,
      /^Action result$/,
    );
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${id}/1`));
    expect((await lerRegras(request, tokenId)).map((r) => r.name)).toEqual(['POST /pedidos']);
  });

  test('deve mostrar na aba Explain o que as verificações dizem, na hora, e o bloco do modelo local', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_status: '429' });
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    const corpoAntes = await detalhe(page)
      .getByRole('tab', { name: /^Body\b/ })
      .boundingBox();

    await acaoDaMensagem(page, 'Explain');

    await expect(aba(page, 'Explain')).toHaveAttribute('aria-selected', 'true');
    await expect(painel(page).getByRole('heading', { name: 'What the checks say' })).toBeVisible();
    await expect(painel(page)).toContainText(/429/);
    await expect(
      painel(page).getByRole('heading', { name: 'Explanation by the local model' }),
    ).toBeVisible();
    if (!compacto(page)) {
      // A explicação não empurra o corpo: as abas do corpo ficam onde estavam.
      const corpoDepois = await detalhe(page)
        .getByRole('tab', { name: /^Body\b/ })
        .boundingBox();
      expect(Math.round(corpoDepois!.y)).toBe(Math.round(corpoAntes!.y));
    }
  });
});

test.describe('Dado os roteiros', () => {
  /** Abre o menu "Guides" e escolhe o roteiro. */
  async function abrirRoteiro(
    page: Page,
    nome: 'First webhook' | 'Test a retry',
  ): Promise<Locator> {
    if (compacto(page)) {
      await page.getByRole('button', { name: 'More actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Guides' }).click();
    } else {
      await lista(page).getByRole('button', { name: 'Guides' }).click();
    }
    await page.getByRole('menuitem', { name: nome, exact: true }).click();
    const folha = page.getByRole('region', { name: `Guide: ${nome}` });
    await expect(folha).toBeVisible();
    return folha;
  }

  function passo(folha: Locator, nome: string): Locator {
    return folha.getByRole('listitem').filter({ hasText: nome });
  }

  function conferencia(folha: Locator): Locator {
    return folha.getByRole('group', { name: 'Retry check' });
  }

  /** Preenche o roteiro de retry e cria as regras. */
  async function criarRetry(
    page: Page,
    folha: Locator,
    espera: string,
    caminho = '/cobrancas',
  ): Promise<void> {
    await metodo(folha, 'POST');
    await folha.getByRole('textbox', { name: 'Path', exact: true }).fill(caminho);
    const status = folha.getByRole('spinbutton', { name: 'Status' });
    await status.first().fill('429');
    await folha.getByRole('spinbutton', { name: 'Times' }).fill('2');
    await folha.getByRole('spinbutton', { name: 'Retry-After (s)' }).fill(espera);
    await expect(status.nth(1)).toHaveValue('200');
    await folha.getByRole('button', { name: 'Create 3 rules' }).click();
    await expect(passo(folha, 'Create')).toContainText('3 rules created');
  }

  test('deve abrir o roteiro no lugar do detalhe, com o endereço, e fechar por "Close guide" e pelo Voltar', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const id = await pedido(tokens, tokenId);
    await seedStorage(page, {});
    await abrirMensagem(page, tokenId, id);
    if (compacto(page)) {
      await detalhe(page).getByRole('button', { name: 'Back to requests' }).click();
    }

    const folha = await abrirRoteiro(page, 'Test a retry');

    await expect(page).toHaveURL(/[?&]guide=retry\b/);
    await expect(folha).toContainText(
      'Make this URL refuse a few times and then accept, and see what your sender does.',
    );
    // Todos os passos à vista ao mesmo tempo, sem "Next".
    for (const nome of [
      'Which requests',
      'What to answer first',
      'What to answer after',
      'Create',
      'Send and check',
    ]) {
      await expect(passo(folha, nome).first()).toBeVisible();
    }
    await expect(folha.getByRole('button', { name: /^(Next|Continue|Avançar)$/ })).toHaveCount(0);
    await expect(folha).toContainText(/Starts at the most common: POST, 1 of 1\./);

    await folha.getByRole('button', { name: 'Close guide' }).click();
    await expect(folha).toBeHidden();
    await expect(page).not.toHaveURL(/guide=/);

    await page.goto(`/#/${tokenId}?guide=first`);
    await expect(page.getByRole('region', { name: 'Guide: First webhook' })).toBeVisible();
    await page.goto(`/#/${tokenId}?guide=retry`);
    await expect(page.getByRole('region', { name: 'Guide: Test a retry' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('region', { name: 'Guide: First webhook' })).toBeVisible();
  });

  test('deve dizer o estado de cada passo do "First webhook" e copiar o comando, avisando que ele tem a URL', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}?guide=first`);
    const folha = page.getByRole('region', { name: 'Guide: First webhook' });

    await expect(passo(folha, 'Send a request')).toContainText('to do');
    await expect(passo(folha, 'See it arrive')).toContainText('to do');
    for (const opcional of [
      "Check the provider's signature",
      'Choose the answer',
      'Test a retry',
    ]) {
      await expect(passo(folha, opcional)).toContainText('optional');
    }
    await limparAnuncios(page);
    await folha.getByRole('button', { name: 'Copy curl command' }).click();

    await expectUmAnuncio(page, /^Command copied\. It has this URL, which is a secret\.$/);
    const comando = await page.evaluate(() => navigator.clipboard.readText());
    expect(comando).toMatch(new RegExp(`^curl .*/${tokenId}$`));

    await pedido(tokens, tokenId, '');
    await expect(passo(folha, 'Send a request')).toContainText('done');
    await expect(passo(folha, "Check the provider's signature").getByRole('link')).toHaveAttribute(
      'href',
      new RegExp(`#/${tokenId}/checks`),
    );
  });

  test('deve copiar o comando curl já no "Your URL is ready" da primeira visita, avisando que ele tem a URL', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    const painel = page.getByRole('region', { name: 'Your URL is ready' });
    await expect(painel).toBeVisible();
    await limparAnuncios(page);

    await painel.getByRole('button', { name: 'Copy curl command' }).click();

    await expectSoEstaFala(page, /^Command copied\. It has this URL, which is a secret\.$/);
    const comando = await page.evaluate(() => navigator.clipboard.readText());
    expect(comando).toMatch(new RegExp(`^curl .*/${tokenId}$`));
  });

  test('deve trocar o "Your URL is ready" pela faixa "First request arrived" e anunciar a chegada uma vez', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'no desktop a primeira requisição abre sozinha no detalhe');
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const stream = page.waitForResponse((r) => r.url().endsWith(`/token/${tokenId}/stream`));
    await page.goto(`/#/${tokenId}`);
    await stream;
    await expect(page.getByRole('region', { name: 'Your URL is ready' })).toBeVisible();
    await limparAnuncios(page);

    const id = await pedido(tokens, tokenId, '/primeira');

    const faixa = page.getByRole('region', { name: 'First request arrived' });
    await expect(faixa).toContainText(/POST \/primeira, at \d{1,2}:\d{2}.*What next\?/);
    await expect(detalhes(page)).toContainText(id);
    await expect(page.getByRole('region', { name: 'Your URL is ready' })).toHaveCount(0);
    await expectUmAnuncio(page, /^First request arrived: POST \/primeira, at \d{1,2}:\d{2}/);
    // No lugar da fala de chegada comum, não além dela.
    await expectSemAnuncio(page, /\b1 new request\b/);
    for (const link of ["Check the provider's signature", 'Choose the answer', 'Test a retry']) {
      await expect(faixa.getByRole('link', { name: link })).toBeVisible();
    }

    await faixa.getByRole('button', { name: 'Dismiss' }).click();
    await expect(faixa).toHaveCount(0);
    await lista(page).getByRole('button', { name: 'Guides' }).click();
    await expect(page.getByRole('menuitem', { name: 'First webhook', exact: true })).toBeVisible();
  });

  test('deve criar as três regras com o Retry-After e dizer "as programmed" Quando a espera é respeitada', async ({
    page,
    request,
    tokens,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const stream = page.waitForResponse((r) => r.url().endsWith(`/token/${tokenId}/stream`));
    await page.goto(`/#/${tokenId}?guide=retry`);
    await stream;
    const folha = page.getByRole('region', { name: 'Guide: Test a retry' });
    await limparAnuncios(page);

    await criarRetry(page, folha, '1');

    await expectSoEstaFala(page, /^3 rules created\.$/);
    const regras = await lerRegras(request, tokenId);
    expect(regras).toHaveLength(3);
    expect(
      regras.map((r) => r['response'] as { status: number; headers: Record<string, string> }),
    ).toMatchObject([
      { status: 429, headers: { 'Retry-After': '1' } },
      { status: 429, headers: { 'Retry-After': '1' } },
      { status: 200 },
    ]);
    await expect(conferencia(folha)).toContainText(
      'Waiting for POST /cobrancas. Nothing arrived yet.',
    );

    // O remetente espera mais do que o pedido (2,3 s contra 1 s).
    const respostas: number[] = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await page.waitForTimeout(2_300);
      }
      respostas.push((await request.post(`/${tokenId}/cobrancas`)).status());
    }
    expect(respostas).toEqual([429, 429, 200]);

    await expect(conferencia(folha)).toContainText(
      '3 requests arrived. Answers: 429, 429, 200, as programmed.',
    );
    await expect(conferencia(folha)).toContainText(/Waited [23] s\. It asked to wait 1 s\./);
    await expect(conferencia(folha)).toContainText(
      'Wait asked: Retry-After: 1, as configured now. Times are kept to the second.',
    );
    await expect(conferencia(folha)).not.toContainText('came before the asked wait');
    await expectUmAnuncio(
      page,
      /^3 requests arrived\. Answers: 429, 429, 200, as programmed\.$/,
      /^Retry check$/,
    );
    // A folha continua aberta, com a conferência nela.
    await expect(folha).toBeVisible();
  });

  test('deve falar a trilha uma vez só, no fim, Quando cada tentativa chega dentro da espera pedida', async ({
    page,
    request,
    tokens,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const stream = page.waitForResponse((r) => r.url().endsWith(`/token/${tokenId}/stream`));
    await page.goto(`/#/${tokenId}?guide=retry`);
    await stream;
    const folha = page.getByRole('region', { name: 'Guide: Test a retry' });
    await criarRetry(page, folha, '2');
    await expectUmAnuncio(page, /^3 rules created\.$/);
    await limparAnuncios(page);

    // O remetente espera o pedido, 2 s, e mais um pouco: as três são uma leva, sem fala no meio.
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await page.waitForTimeout(2_200);
      }
      await request.post(`/${tokenId}/cobrancas`);
    }

    await expect(conferencia(folha)).toContainText('3 requests arrived. Answers: 429, 429, 200');
    await expectSoEstaFala(page, /^3 requests arrived\. Answers: 429, 429, 200\b/, /^Retry check$/);
  });

  test('deve falar de novo a cada leva Quando o remetente demora mais que a espera pedida', async ({
    page,
    request,
    tokens,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const stream = page.waitForResponse((r) => r.url().endsWith(`/token/${tokenId}/stream`));
    await page.goto(`/#/${tokenId}?guide=retry`);
    await stream;
    const folha = page.getByRole('region', { name: 'Guide: Test a retry' });
    await criarRetry(page, folha, '1');
    await expectUmAnuncio(page, /^3 rules created\.$/);
    await limparAnuncios(page);

    await request.post(`/${tokenId}/cobrancas`);
    await expectUmAnuncio(page, /^1 request arrived\. Answers: 429\.$/, /^Retry check$/);
    await request.post(`/${tokenId}/cobrancas`);
    await expectUmAnuncio(page, /^2 requests arrived\. Answers: 429, 429\.$/, /^Retry check$/);
    await request.post(`/${tokenId}/cobrancas`);
    await expectUmAnuncio(
      page,
      /^3 requests arrived\. Answers: 429, 429, 200, as programmed\.$/,
      /^Retry check$/,
    );
    await expectSemAnuncio(page, /new requests? arrived/);
  });

  test('deve escolher um método só, com POST de padrão, e esperar por qualquer caminho sem o Path', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}?guide=retry`);
    const folha = page.getByRole('region', { name: 'Guide: Test a retry' });
    const metodos = folha.getByRole('group', { name: 'Methods' });

    await expect(metodos.locator('[aria-pressed="true"]')).toHaveText(['POST']);
    await metodos.getByRole('button', { name: 'PUT', exact: true }).click();
    await expect(metodos.locator('[aria-pressed="true"]')).toHaveText(['PUT']);
    await metodos.getByRole('button', { name: 'POST', exact: true }).click();
    await expect(metodos.locator('[aria-pressed="true"]')).toHaveText(['POST']);

    await folha.getByRole('spinbutton', { name: 'Status' }).first().fill('429');
    await folha.getByRole('spinbutton', { name: 'Times' }).fill('2');
    await folha.getByRole('button', { name: 'Create 3 rules' }).click();
    await expect(passo(folha, 'Create')).toContainText('3 rules created');

    await expect(conferencia(folha)).toContainText('Waiting for POST (any path).');
  });

  test('nunca deve dizer "as programmed" Quando as requisições chegaram antes da espera pedida', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const stream = page.waitForResponse((r) => r.url().endsWith(`/token/${tokenId}/stream`));
    await page.goto(`/#/${tokenId}?guide=retry`);
    await stream;
    const folha = page.getByRole('region', { name: 'Guide: Test a retry' });
    await criarRetry(page, folha, '5');
    await expectUmAnuncio(page, /^3 rules created\.$/);
    await limparAnuncios(page);

    // O remetente não espera: as três chegam em sequência, a 0 ou 1 s uma da outra, contra 5 s pedidos.
    const respostas: number[] = [];
    for (let i = 0; i < 3; i++) {
      respostas.push((await request.post(`/${tokenId}/cobrancas`)).status());
    }
    expect(respostas).toEqual([429, 429, 200]);

    const check = conferencia(folha);
    await expect(check).toContainText('3 requests arrived. Answers: 429, 429, 200');
    await expect(check).toContainText('2 requests came before the asked wait of 5 s.');
    await expect(check).toContainText(
      /Came [01] s after the previous answer\. It asked to wait 5 s\./,
    );
    await expect(check).not.toContainText(/as programmed/i);
    await expect(folha).not.toContainText(/as programmed|as scheduled|como programado/i);
    // Uma fala por leva, 1,5 s depois da última chegada: numa rajada de três sai só a do resumo final.
    await expectSoEstaFala(page, /^3 requests arrived\. Answers: 429, 429, 200\b/, /^Retry check$/);
    await expectSemAnuncio(page, /^[12] requests? arrived\b/);
    await expectSemAnuncio(page, /^Attempt \d+ arrived\b/);
    await expectSemAnuncio(page, /as programmed/i);
  });

  test('deve mandar as requisições de teste do navegador, dizendo que confere as regras e não o remetente', async ({
    page,
    tokens,
  }) => {
    test.setTimeout(60_000);
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    const stream = page.waitForResponse((r) => r.url().endsWith(`/token/${tokenId}/stream`));
    await page.goto(`/#/${tokenId}?guide=retry`);
    await stream;
    const folha = page.getByRole('region', { name: 'Guide: Test a retry' });
    await criarRetry(page, folha, '1');

    await folha.getByRole('button', { name: 'Send 3 test requests' }).click();

    await expect(folha).toContainText(
      'Sent from this browser, 1 s apart. This checks the rules, not your sender.',
    );
    await expect(conferencia(folha)).toContainText('3 requests arrived. Answers: 429, 429, 200', {
      timeout: 20_000,
    });
    expect((await tokens.listed(tokenId)).map((r) => r.method)).toEqual(['POST', 'POST', 'POST']);

    await folha.getByRole('button', { name: 'Start over' }).click();
    await expect(conferencia(folha)).toContainText(
      'Waiting for POST /cobrancas. Nothing arrived yet.',
    );
    expect((await page.request.post(`/${tokenId}/cobrancas`)).status()).toBe(429);
  });

  test('deve abrir o mesmo roteiro pelo modelo "Fail N times, then accept" de Regras', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirRegras(page, tokenId);

    await page.getByRole('button', { name: 'New rule from template' }).click();
    await page.getByRole('menuitem', { name: 'Fail N times, then accept', exact: true }).click();

    const folha = page.getByRole('region', { name: 'Guide: Test a retry' });
    await expect(folha).toBeVisible();
    await expect(folha.getByRole('spinbutton', { name: 'Retry-After (s)' })).toHaveValue('');
    await expect(folha.getByRole('spinbutton', { name: 'Times' })).toHaveValue('2');
  });

  test('não deve abrir o roteiro numa URL que não existe', async ({ page }) => {
    await seedStorage(page, {});

    await page.goto(`/#/${urlInexistente()}?guide=retry`);

    await expect(
      page.getByRole('heading', { name: 'This URL no longer exists', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: /^Guide: / })).toHaveCount(0);
  });
});
