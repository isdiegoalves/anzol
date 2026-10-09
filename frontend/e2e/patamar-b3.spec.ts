import { createHmac } from 'node:crypto';
import { Locator, Page, Request } from '@playwright/test';
import {
  escutarAnuncios,
  expectSemAnuncio,
  expectSoEstaFala,
  expectUmAnuncio,
  limparAnuncios,
} from './support/anuncios';
import {
  Secao,
  abrirCartao,
  abrirChecks,
  barraDeSalvar,
  botaoSalvar,
  escolherProvedor,
  pendente,
  secao,
} from './support/checks';
import { expect, test } from './support/fixtures';
import { abrirSeletor, urlNoSeletor } from './support/patamar';
import { compacto, destino } from './support/shell';
import { seedStorage } from './support/storage';

const SECRET = 'segredo-do-patamar-b3';
const SEGREDO_NOVO = 'shpss_segredo_novo_b3';
const SEGREDO_DE_LEITURA = 'leitura-do-b3-5678';

function github(secret: string, body = '{"id":1}') {
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    data: body,
  };
}

/** Os pedidos de escrita em `/token/{id}…` que a página faz a partir daqui. */
function escritas(page: Page, tokenId: string): Request[] {
  const pedidos: Request[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith(`/token/${tokenId}`)) {
      pedidos.push(r);
    }
  });
  return pedidos;
}

const caminho = (r: Request) => `${r.method()} ${new URL(r.url()).pathname}`;

function status(page: Page): Locator {
  return secao(page, 'Response').getByLabel('Default status code');
}

async function comStatusPendente(page: Page, tokenId: string): Promise<void> {
  await abrirChecks(page, tokenId, 'Response');
  await expect(status(page)).toHaveValue('200');
  await status(page).fill('429');
  await expect(barraDeSalvar(page)).toBeVisible();
}

test.describe('Dado Verificações sem alteração', () => {
  test('não deve ter botão Save nos cartões nem a barra de salvar', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirChecks(page, tokenId, 'Signature verification');

    for (const nome of ['Save signature', 'Save schema', 'Save response', 'Save privacy']) {
      await expect(page.getByRole('button', { name: nome, exact: true })).toHaveCount(0);
    }
    await expect(barraDeSalvar(page)).toBeHidden();
  });
});

test.describe('Dado uma alteração pendente em Verificações', () => {
  test('deve mostrar a barra dizendo o que muda, com "Save changes · Ctrl+S", "Discard" e "Review changes"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await comStatusPendente(page, tokenId);
    const barra = barraDeSalvar(page);

    await expect(barra.getByRole('status')).toContainText(/^1 unsaved change\b/);
    if (!compacto(page)) {
      await expect(barra.getByRole('status')).toHaveText('1 unsaved change: Default status code');
    }
    await expect(botaoSalvar(page)).toBeEnabled();
    await expect(botaoSalvar(page)).toContainText(compacto(page) ? 'Save changes' : 'Ctrl+S');
    await expect(barra.getByRole('button', { name: 'Discard', exact: true })).toBeVisible();
    await expect(secao(page, 'Response')).toContainText('Unsaved');
    if (!compacto(page)) {
      await expect(barra.getByRole('button', { name: 'Review changes' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
  });

  test('deve gravar tudo num PUT só, sumir com a barra e anunciar "Saved." uma vez', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_content: 'antes' });
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
    await limparAnuncios(page);

    await escolherProvedor(assinatura, 'GitHub');
    await assinatura.getByLabel('HMAC secret', { exact: true }).fill(SECRET);
    await abrirCartao(page, 'Response');
    await status(page).fill('429');
    await secao(page, 'Response').getByLabel('Response body').fill('depois');
    await expectUmAnuncio(page, /^4 unsaved changes/);
    await expectSemAnuncio(page, /^5 unsaved/);
    const pedidos = escritas(page, tokenId);
    await limparAnuncios(page);

    await botaoSalvar(page).click();

    await expect(barraDeSalvar(page)).toBeHidden();
    await expect(page.getByText('URL updated!').last()).toBeVisible();
    await expectUmAnuncio(page, /^Saved\. 4 changes\.$/);
    await expectSemAnuncio(page, /URL updated!/);
    expect(pedidos.map(caminho)).toEqual([`PUT /token/${tokenId}`]);
    expect(pedidos[0].postDataJSON()).toMatchObject({
      default_content: 'depois',
      signature: { provider: 'github', secret: SECRET },
    });
    expect(await tokens.read(tokenId)).toMatchObject({
      default_status: 429,
      default_content: 'depois',
      signature: { provider: 'github' },
    });
    await expect(secao(page, 'Response')).not.toContainText('Unsaved');
  });

  test('deve anunciar a primeira alteração uma vez e não falar a cada tecla', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirChecks(page, tokenId, 'Response');
    await limparAnuncios(page);

    const corpo = secao(page, 'Response').getByLabel('Response body');
    await corpo.click();
    await corpo.pressSequentially('um corpo digitado devagar', { delay: 60 });

    await expectUmAnuncio(page, /^1 unsaved change: Response body\.?$/);
    await expectSemAnuncio(page, /^[2-9] unsaved/);
  });

  test('deve falar cada alteração só pelo resumo da barra, e não também pelo resumo do cartão', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
    await limparAnuncios(page);

    await escolherProvedor(assinatura, 'GitHub');

    await expect(pendente(assinatura)).toHaveText('To save, fill in: HMAC secret');
    await expectSoEstaFala(page, /^1 unsaved change: Signature provider\.?$/);
  });

  test('deve falar só "Saved." ao gravar a assinatura e trancar a URL com um segredo de leitura', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
    await escolherProvedor(assinatura, 'GitHub');
    await assinatura.getByLabel('HMAC secret', { exact: true }).fill(SECRET);
    await abrirCartao(page, 'Privacy');
    const privacidade = secao(page, 'Privacy');
    await privacidade.getByRole('switch', { name: 'Require a secret to view this URL' }).click();
    await privacidade.getByLabel('Secret to view', { exact: true }).fill(SEGREDO_DE_LEITURA);
    await privacidade.getByLabel('Confirm secret', { exact: true }).fill(SEGREDO_DE_LEITURA);
    await expectUmAnuncio(page, /^4 unsaved changes/);
    await limparAnuncios(page);

    await botaoSalvar(page).click();

    await expect(barraDeSalvar(page)).toBeHidden();
    await expect(assinatura.getByLabel('HMAC secret', { exact: true })).toHaveAccessibleDescription(
      'Leave blank to keep the current secret',
    );
    await expectSoEstaFala(page, /^Saved\. 4 changes\.$/);
  });

  test('deve listar o valor antigo e o novo em "Review changes", sem mostrar segredo', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'o celular mostra só a contagem e os botões (wireframe)');
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
    await escolherProvedor(assinatura, 'GitHub');
    await assinatura.getByLabel('HMAC secret', { exact: true }).fill(SECRET);
    await status(page).fill('429');

    const rever = barraDeSalvar(page).getByRole('button', { name: 'Review changes' });
    await rever.click();

    await expect(rever).toHaveAttribute('aria-expanded', 'true');
    const lista = page.getByRole('list', { name: 'Changes to save' });
    await expect(lista.getByRole('listitem')).toHaveCount(3);
    await expect(lista).toContainText('Default status code: 200 → 429');
    await expect(lista).toContainText('HMAC secret: set (not shown)');
    await expect(lista).not.toContainText(SECRET);
  });

  test('deve manter "Save changes" habilitado e, com campo inválido, levar ao campo e não gravar nada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
    await abrirCartao(page, 'Response');
    await status(page).fill('429');
    await escolherProvedor(assinatura, 'Generic');
    const pedidos = escritas(page, tokenId);
    // O foco começa longe do campo inválido.
    await status(page).focus();

    await expect(botaoSalvar(page)).toBeEnabled();
    await botaoSalvar(page).click();

    await expect(barraDeSalvar(page).getByRole('alert')).toHaveText(
      '2 fields need attention: Signature header, HMAC secret',
    );
    const cabecalho = assinatura.getByRole('textbox', { name: 'Signature header' });
    await expect(cabecalho).toBeFocused();
    await expect(cabecalho).toBeInViewport();
    expect(pedidos.map(caminho)).toEqual([]);
    expect(await tokens.read(tokenId)).toMatchObject({ default_status: 200, signature: null });
    await expect(status(page)).toHaveValue('429');
  });

  test('deve pôr o CORS na barra: o interruptor marca a alteração e a chamada sai no salvar, depois do PUT', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    const resposta = await abrirChecks(page, tokenId, 'Response');
    const pedidos = escritas(page, tokenId);

    await resposta.getByRole('switch', { name: /Enable CORS/ }).click();

    await expect(barraDeSalvar(page).getByRole('status')).toContainText(/^1 unsaved change\b/);
    expect(pedidos.map(caminho)).toEqual([]);
    await botaoSalvar(page).click();
    await expect(barraDeSalvar(page)).toBeHidden();
    expect(pedidos.map(caminho)).toEqual([
      `PUT /token/${tokenId}`,
      `PUT /token/${tokenId}/cors/toggle`,
    ]);
    expect(
      ((await (await request.get(`/token/${tokenId}`)).json()) as { cors: boolean }).cors,
    ).toBe(true);
  });

  test('deve desfazer as alterações com "Discard" e anunciar uma vez', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await comStatusPendente(page, tokenId);
    const pedidos = escritas(page, tokenId);
    await limparAnuncios(page);

    await barraDeSalvar(page).getByRole('button', { name: 'Discard', exact: true }).click();

    await expect(barraDeSalvar(page)).toBeHidden();
    await expect(status(page)).toHaveValue('200');
    await expectUmAnuncio(page, /^Changes discarded\.$/);
    expect(pedidos.map(caminho)).toEqual([]);
  });

  test('deve salvar com Ctrl/Cmd+S com o foco num campo', async ({ page, tokens }) => {
    test.skip(compacto(page), 'teclado: só no desktop');
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await comStatusPendente(page, tokenId);
    await expect(botaoSalvar(page)).toHaveAttribute('aria-keyshortcuts', /Control\+S/i);

    await secao(page, 'Response').getByLabel('Response body').press('ControlOrMeta+s');

    await expect(barraDeSalvar(page)).toBeHidden();
    expect(await tokens.read(tokenId)).toMatchObject({ default_status: 429 });
  });

  test('deve desligar "Send a signed test" com a razão Quando há rascunho na assinatura', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    await seedStorage(page, {});
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
    const teste = assinatura
      .getByRole('link', { name: 'Send a signed test' })
      .or(assinatura.getByRole('button', { name: 'Send a signed test' }));
    await expect(teste).not.toHaveAttribute('aria-disabled', 'true');

    await assinatura.getByLabel('HMAC secret', { exact: true }).fill(SEGREDO_NOVO);

    await expect(teste).toHaveAttribute('aria-disabled', 'true');
    await expect(teste).toHaveAccessibleDescription(
      'Save first: the test uses the saved settings.',
    );
  });
});

test.describe('Dado uma alteração pendente e uma saída de Verificações (guarda de saída)', () => {
  function pergunta(page: Page): Locator {
    return page.getByRole('dialog', { name: 'Discard changes?' });
  }

  test('deve perguntar ao sair pelo rail, listar as alterações e ficar com "Keep editing"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await comStatusPendente(page, tokenId);

    await destino(page, 'Rules').click();

    const dialogo = pergunta(page);
    await expect(dialogo).toContainText('Checks has 1 unsaved change');
    await expect(dialogo).toContainText('Default status code: 200 → 429');
    const continuar = dialogo.getByRole('button', { name: 'Keep editing' });
    await expect(continuar).toBeFocused();
    await expect(dialogo.getByRole('button', { name: 'Discard', exact: true })).toBeVisible();
    await expect(dialogo.getByRole('button', { name: 'Save and leave' })).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(dialogo).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/checks`));
    await expect(status(page)).toHaveValue('429');
  });

  test('deve sair sem gravar com "Discard"', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await comStatusPendente(page, tokenId);

    await destino(page, 'Rules').click();
    await pergunta(page).getByRole('button', { name: 'Discard', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules$`));
    expect(await tokens.read(tokenId)).toMatchObject({ default_status: 200 });
  });

  test('deve gravar e sair com "Save and leave"', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await comStatusPendente(page, tokenId);

    await destino(page, 'Rules').click();
    await pergunta(page).getByRole('button', { name: 'Save and leave' }).click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules$`));
    expect(await tokens.read(tokenId)).toMatchObject({ default_status: 429 });
  });

  test('deve ficar na página e apontar o campo Quando "Save and leave" encontra campo inválido', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
    await escolherProvedor(assinatura, 'Generic');

    await destino(page, 'Rules').click();
    await pergunta(page).getByRole('button', { name: 'Save and leave' }).click();

    await expect(pergunta(page)).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/checks`));
    await expect(barraDeSalvar(page).getByRole('alert')).toContainText(
      '2 fields need attention: Signature header, HMAC secret',
    );
    await expect(assinatura.getByRole('textbox', { name: 'Signature header' })).toBeFocused();
  });

  test('deve perguntar ao trocar de URL pelo seletor e ao voltar no navegador', async ({
    page,
    tokens,
  }) => {
    const outra = await tokens.create();
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${outra}`);
    await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
      new RegExp(`/${outra}$`),
    );
    await comStatusPendente(page, tokenId);

    await urlNoSeletor(await abrirSeletor(page), outra).click();
    await expect(pergunta(page)).toBeVisible();
    await pergunta(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/checks`));

    await page.goBack();
    await expect(pergunta(page)).toBeVisible();
    await pergunta(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/checks`));
    await expect(status(page)).toHaveValue('429');
  });

  test('deve pedir a confirmação do navegador ao fechar a aba', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirChecks(page, tokenId, 'Response');
    // Tecla de verdade: o `beforeunload` só pergunta depois de um gesto na página.
    await status(page).click();
    await status(page).press('ControlOrMeta+a');
    await status(page).pressSequentially('429');
    await expect(barraDeSalvar(page)).toBeVisible();

    const aviso = new Promise<string | null>((resolve) => {
      page.once('dialog', (janela) => {
        resolve(janela.type());
        void janela.dismiss();
      });
      page.once('close', () => resolve(null));
    });
    await page.close({ runBeforeUnload: true });

    expect(await aviso, 'a aba fechou sem perguntar').toBe('beforeunload');
  });

  test('não deve perguntar nada Quando não há alteração', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirChecks(page, tokenId, 'Response');

    await destino(page, 'Rules').click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules$`));
    await expect(pergunta(page)).toHaveCount(0);
  });
});

test.describe('Dado o rascunho de Verificações guardado na aba', () => {
  test('deve oferecer o rascunho ao reabrir, sem guardar segredo nenhum', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    page.on('dialog', (janela) => void janela.accept());
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
    await escolherProvedor(assinatura, 'GitHub');
    await assinatura.getByLabel('HMAC secret', { exact: true }).fill(SECRET);
    const privacidade = secao(page, 'Privacy');
    await abrirCartao(page, 'Privacy');
    await privacidade.getByRole('switch', { name: 'Require a secret to view this URL' }).click();
    await privacidade.getByLabel('Secret to view', { exact: true }).fill(SEGREDO_NOVO);
    await abrirCartao(page, 'Response');
    await status(page).fill('429');
    const guardado = () =>
      page.evaluate((chave) => sessionStorage.getItem(chave) ?? '', `anzol.checksDraft.${tokenId}`);
    await expect.poll(guardado).toContain('429');
    expect(await guardado()).not.toContain(SECRET);
    expect(await guardado()).not.toContain(SEGREDO_NOVO);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Checks', level: 1 })).toBeVisible();
    await abrirCartao(page, 'Response');
    await expect(status(page)).toHaveValue('200');
    const rascunho = page.getByRole('alert').filter({ hasText: /^\s*You have a draft from / });
    await rascunho.getByRole('button', { name: 'Restore draft' }).click();

    await expect(status(page)).toHaveValue('429');
    await expect(barraDeSalvar(page)).toBeVisible();
    await expect(assinatura.getByLabel('HMAC secret', { exact: true })).toHaveValue('');
  });
});

test.describe('Dado a ordem por assunto de Verificações', () => {
  const ORDEM: Secao[] = [
    'Signature verification',
    'Schema validation',
    'Response',
    'Privacy',
    'E2EE decryption',
    'Health',
  ];

  test('deve mostrar os cartões na ordem do índice, numa coluna na largura da página', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await abrirChecks(page, tokenId, 'Signature verification');

    const caixas = [];
    for (const nome of ORDEM) {
      await expect(secao(page, nome)).toBeAttached();
      caixas.push((await secao(page, nome).boundingBox())!);
    }
    const topos = caixas.map((c) => Math.round(c.y));
    expect(topos, 'os cartões descem na ordem do índice').toEqual([...topos].sort((a, b) => a - b));
    expect(new Set(topos).size, 'uma coluna: nenhum cartão ao lado de outro').toBe(ORDEM.length);
    expect(new Set(caixas.map((c) => Math.round(c.x))).size).toBe(1);
    const pagina = (await page.getByRole('main', { name: 'Checks' }).boundingBox())!;
    for (const caixa of caixas) {
      expect(
        pagina.x + pagina.width - (caixa.x + caixa.width),
        'o cartão vai até a margem direita da página',
      ).toBeLessThanOrEqual(25);
    }
    const atalhos = page.getByRole('navigation', { name: 'On this page' }).getByRole('link');
    await expect(atalhos).toHaveCount(ORDEM.length);
    const nomes = await atalhos.evaluateAll((links) =>
      links.map((l) => (l.textContent ?? '').trim().split(/[\s·,]/)[0]),
    );
    expect(nomes).toEqual(['Signature', 'Schema', 'Response', 'Privacy', 'Decryption', 'Health']);
  });

  test('deve dizer o estado de cada seção no índice e marcar a que tem alteração', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      default_status: '429',
      signature: { provider: 'github', secret: SECRET },
      schema: { type: 'object' },
    });
    await seedStorage(page, {});
    await abrirChecks(page, tokenId, 'Response');
    const indice = page.getByRole('navigation', { name: 'On this page' });

    await expect(indice.getByRole('link', { name: /^Signature, GitHub$/ })).toBeVisible();
    await expect(indice.getByRole('link', { name: /^Schema, on\b/ })).toBeVisible();
    await expect(indice.getByRole('link', { name: /^Decryption, off$/ })).toBeVisible();
    await expect(indice.getByRole('link', { name: /^Response, 429$/ })).toBeVisible();
    await expect(indice.getByRole('link', { name: /^Privacy, open$/ })).toBeVisible();

    await status(page).fill('503');
    await expect(indice.getByRole('link', { name: /^Response, .*unsaved$/ })).toBeVisible();
    await expect(indice.getByRole('link', { name: /^Signature, GitHub$/ })).toBeVisible();
  });

  test('deve marcar no índice a seção à vista', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/checks?section=privacy`);
    await expect(secao(page, 'Privacy')).toBeInViewport();

    const indice = page.getByRole('navigation', { name: 'On this page' });
    // `location` é o valor próprio para a posição dentro da página; `true` também vale.
    await expect(indice.getByRole('link', { name: /^Privacy\b/ })).toHaveAttribute(
      'aria-current',
      /^(true|location)$/,
    );
    await expect(indice.locator('[aria-current]')).toHaveCount(1);
  });

  test('deve mostrar a Saúde por último e recolhida, com as taxas e o link para Métricas', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    await tokens.send(tokenId, github(SECRET));
    await tokens.send(tokenId, github('outro-segredo'));
    await seedStorage(page, {});
    const saude = await abrirChecks(page, tokenId, 'Health');

    await expect(saude).toContainText(/Signatures 50(\.0)? % valid/);
    await expect(saude.getByRole('link', { name: 'Open in Insights' })).toHaveAttribute(
      'href',
      new RegExp(`#/${tokenId}/insights`),
    );
    const mostrar = saude.getByRole('button', { name: 'Show health' });
    await expect(mostrar).toHaveAttribute('aria-expanded', 'false');
    await expect(saude.getByRole('combobox', { name: 'Window' })).toBeHidden();

    await mostrar.click();

    await expect(mostrar).toHaveAttribute('aria-expanded', 'true');
    await expect(saude.getByRole('combobox', { name: 'Window' })).toBeVisible();
  });
});

test.describe('Dado Verificações no celular', () => {
  test.beforeEach(({ page }) => {
    test.skip(!compacto(page), 'só no celular');
  });

  test('deve recolher os cartões e abrir sozinho o da seção pedida', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/checks?section=response`);
    await expect(page.getByRole('heading', { name: 'Checks', level: 1 })).toBeVisible();

    const cabecalho = (nome: string) =>
      page.getByRole('button', { name: new RegExp(`^${nome}, `) });
    await expect(cabecalho('Response')).toHaveAttribute('aria-expanded', 'true');
    await expect(status(page)).toBeVisible();
    for (const nome of ['Signature verification', 'Schema validation', 'Privacy']) {
      await expect(cabecalho(nome)).toHaveAttribute('aria-expanded', 'false');
    }
    await expect(secao(page, 'Privacy').getByRole('switch')).toBeHidden();

    await cabecalho('Privacy').click();
    await expect(cabecalho('Privacy')).toHaveAttribute('aria-expanded', 'true');
    await expect(secao(page, 'Privacy').getByRole('switch')).toBeVisible();
  });

  test('deve pôr a barra de salvar acima da barra de destinos, sem cobrir o campo com foco', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await comStatusPendente(page, tokenId);

    const barra = (await barraDeSalvar(page).boundingBox())!;
    const destinos = (await page.getByRole('navigation', { name: 'URL sections' }).boundingBox())!;
    expect(barra.y + barra.height).toBeLessThanOrEqual(destinos.y + 1);
    const salvar = (await botaoSalvar(page).boundingBox())!;
    expect(salvar.height).toBeGreaterThanOrEqual(48);

    const corpo = secao(page, 'Response').getByLabel('Response body');
    await corpo.focus();
    const campo = (await corpo.boundingBox())!;
    expect(campo.y + campo.height, 'o campo com foco fica acima da barra').toBeLessThanOrEqual(
      barra.y + 1,
    );
  });
});

test.describe('Dado um erro ao salvar Verificações', () => {
  test('deve manter as alterações e oferecer "Try again" Quando o servidor não responde', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await comStatusPendente(page, tokenId);
    let falhar = true;
    await page.route(`**/token/${tokenId}`, async (rota) => {
      if (rota.request().method() === 'PUT' && falhar) {
        falhar = false;
        await rota.abort('failed');
        return;
      }
      await rota.continue();
    });

    await botaoSalvar(page).click();

    const barra = barraDeSalvar(page);
    await expect(barra).toContainText(
      'Could not save. The server did not answer. Your changes are still here.',
    );
    await expect(status(page)).toHaveValue('429');
    await barra.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(barra).toBeHidden();
    expect(await tokens.read(tokenId)).toMatchObject({ default_status: 429 });
  });

  test('deve dizer o campo que o servidor recusou (422), sem gravar nada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ schema: { type: 'object' } });
    await seedStorage(page, {});
    const schema = await abrirChecks(page, tokenId, 'Schema validation');
    const campo = schema.getByRole('textbox', { name: 'JSON Schema' });
    await campo.fill('{"$ref": "https://exemplo.com/pedido.json"}');
    await abrirCartao(page, 'Response');
    await status(page).fill('429');
    const recusa = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.status() === 422,
    );

    await botaoSalvar(page).click();
    await recusa;

    await expect(barraDeSalvar(page).getByRole('alert')).toContainText('JSON Schema');
    await expect(campo).toBeFocused();
    expect(await tokens.read(tokenId)).toMatchObject({
      default_status: 200,
      schema: { type: 'object' },
    });
  });

  test('deve avisar que a URL mudou em outro lugar, com "Reload" e "Save anyway"', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_content: 'antes' });
    await seedStorage(page, {});
    await comStatusPendente(page, tokenId);
    const atual = await tokens.read(tokenId);
    const outra = await request.put(`/token/${tokenId}`, {
      data: {
        default_status: String(atual['default_status']),
        default_content_type: atual['default_content_type'],
        timeout: String(atual['timeout']),
        default_content: 'mudou em outra aba',
        retry_after: null,
        auto_cleanup: null,
        signature: null,
        schema: null,
      },
    });
    expect(outra.status()).toBe(200);

    await botaoSalvar(page).click();

    const aviso = page
      .getByRole('alert')
      .filter({ hasText: 'This URL was changed elsewhere since you opened this page.' });
    await expect(aviso).toBeVisible();
    await expect(aviso.getByRole('button', { name: 'Reload' })).toBeVisible();
    expect(await tokens.read(tokenId)).toMatchObject({ default_status: 200 });

    await aviso.getByRole('button', { name: 'Save anyway' }).click();
    await expect(barraDeSalvar(page)).toBeHidden();
    expect(await tokens.read(tokenId)).toMatchObject({
      default_status: 429,
      default_content: 'mudou em outra aba',
    });
  });
});

test.describe('Dado o ponto de atenção de Verificações no rail', () => {
  test('deve dizer quantas assinaturas inválidas e desde quando, e apagar ao abrir Verificações', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    await tokens.send(tokenId, github('outro-segredo'));
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);

    const verificacoes = page
      .getByRole('navigation', { name: 'URL sections' })
      .getByRole('link', { name: /^Checks\b/ });
    await expect(verificacoes).toHaveAccessibleName(
      /^Checks, 1 invalid signatures? since \d{1,2}:\d{2}/,
    );

    await verificacoes.click();
    await expect(page.getByRole('heading', { name: 'Checks', level: 1 })).toBeVisible();
    await expect(verificacoes).toHaveAccessibleName('Checks');
  });
});
