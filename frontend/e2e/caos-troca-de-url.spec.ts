import { Page } from '@playwright/test';
import { expect, test } from './support/caos';
import { abrirChecks, barraDeSalvar, botaoSalvar, secao } from './support/checks';
import { acaoDaMensagem, campoDeBusca, detalhes, itens, lista } from './support/inbox';
import { CHAVE_URLS, abrirSeletor, listaDeUrls, urlNoSeletor } from './support/patamar';
import { gravarRegras } from './support/regras';
import { seedStorage } from './support/storage';

const rotulos = (page: Page) =>
  itens(page)
    .locator('button.select')
    .evaluateAll((botoes) => botoes.map((botao) => botao.getAttribute('aria-label') ?? ''));
const rodape = (page: Page) => lista(page).locator('.range');
const irPara = (page: Page, hash: string) =>
  page.evaluate((destino) => (location.hash = destino), hash);

/** Espera a tela tratar o que já chegou: a resposta atrasada vira tarefa e quadro antes disto voltar. */
const depoisDeTratar = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((pronto) =>
        setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(pronto)), 50),
      ),
  );

test.describe('Dado a troca de URL com a resposta da anterior atrasada', () => {
  test('deve ficar na URL nova, com a lista e o cabeçalho dela, Quando a lista da anterior chega depois', async ({
    page,
    tokens,
    caos,
  }) => {
    const [c, a, b] = [await tokens.create(), await tokens.create(), await tokens.create()];
    await tokens.send(c, { path: '/c' });
    for (const n of [1, 2, 3]) {
      await tokens.send(a, { path: `/a-${n}` });
    }
    await tokens.send(b, { path: '/b' });
    await page.goto(`/#/${c}`);
    await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
    const listaDeA = caos.segurar(new RegExp(`^/token/${a}/requests\\?`));

    await irPara(page, `#/${a}`);
    await listaDeA.respondida;
    await irPara(page, `#/${b}`);
    await expect.poll(() => rotulos(page)).toEqual([expect.stringContaining('/b')]);
    const entregue = page.waitForResponse((r) => r.url().includes(`/token/${a}/requests?`));
    listaDeA.soltar();
    await entregue;
    await depoisDeTratar(page);

    expect(page.url()).toMatch(new RegExp(`#/${b}(/|$)`));
    await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
    expect(await rotulos(page)).toEqual([expect.stringContaining('/b')]);
    await expect(page.getByText(`URL ${b.slice(0, 5)}`).first()).toBeVisible();
    await expect(page.getByText(`URL ${a.slice(0, 5)}`)).toHaveCount(0);
  });

  test('não deve misturar a página seguinte do filtro anterior Quando o filtro muda com ela a caminho', async ({
    page,
    tokens,
    caos,
  }) => {
    const tokenId = await tokens.create();
    for (let n = 0; n < 10; n++) {
      await tokens.send(tokenId, { path: '/velho' });
    }
    await tokens.sendMany(tokenId, 50, 25);
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (60)' })).toBeVisible();
    const pagina2 = caos.segurar(new RegExp(`^/token/${tokenId}/requests\\?.*page=2`));

    await page.getByRole('button', { name: 'Next page' }).click();
    await pagina2.respondida;
    await campoDeBusca(page).fill('velho');
    await expect(rodape(page)).toHaveText('1–10 of 10');
    const entregue = page.waitForResponse((r) => /\/requests\?.*page=2/.test(r.url()));
    pagina2.soltar();
    await entregue;
    await depoisDeTratar(page);

    await expect(rodape(page)).toHaveText('1–10 of 10');
    expect((await rotulos(page)).every((rotulo) => rotulo.includes('/velho'))).toBe(true);
  });

  test('deve fechar o painel de ação aberto Quando a URL muda', async ({ page, tokens }) => {
    const [a, b] = [await tokens.create(), await tokens.create()];
    const aberta = await tokens.send(a, { path: '/a' });
    await tokens.send(b, { path: '/b' });
    await page.goto(`/#/${a}/${aberta}/1`);
    await expect(detalhes(page)).toContainText(aberta);
    await acaoDaMensagem(page, 'Replay…');
    await expect(page.getByRole('region', { name: 'Action panel' })).toBeVisible();

    await irPara(page, `#/${b}`);

    await expect.poll(() => rotulos(page)).toEqual([expect.stringContaining('/b')]);
    await expect(page.getByRole('region', { name: 'Action panel' })).toHaveCount(0);
  });

  test('deve mostrar as regras da URL da rota Quando as da anterior chegam depois', async ({
    page,
    tokens,
    caos,
  }) => {
    const [a, b] = [await tokens.create(), await tokens.create()];
    await gravarRegras(page.request, a, [
      { name: 'Regra de A1', priority: 1, match: { method: ['POST'] }, response: { status: 201 } },
    ]);
    await page.goto(`/#/${b}/rules`);
    await expect(page.getByRole('table', { name: 'Rules' })).toBeVisible();
    const regrasDeA = caos.segurar(new RegExp(`^/token/${a}/rules$`), 'GET');

    await irPara(page, `#/${a}/rules`);
    await regrasDeA.respondida;
    const regrasDeB = page.waitForResponse((r) => r.url().endsWith(`/token/${b}/rules`));
    await irPara(page, `#/${b}/rules`);
    await regrasDeB;
    await depoisDeTratar(page);
    const entregue = page.waitForResponse((r) => r.url().endsWith(`/token/${a}/rules`));
    regrasDeA.soltar();
    await entregue;
    await depoisDeTratar(page);

    expect(page.url()).toMatch(new RegExp(`#/${b}/rules$`));
    await expect(page.getByText('Regra de A1')).toHaveCount(0);
  });
});

test.describe('Dado Verificações salvando quando a pessoa troca de URL', () => {
  test('deve terminar de salvar e só então abrir a outra URL, dizendo isso, sem perguntar se descarta', async ({
    page,
    tokens,
    caos,
  }) => {
    const [a, b] = [await tokens.create(), await tokens.create()];
    await seedStorage(page, { [CHAVE_URLS]: listaDeUrls([{ uuid: a }, { uuid: b }]) });
    const resposta = await abrirChecks(page, a, 'Response');
    await resposta.getByLabel('Response body').fill('depois');
    const put = caos.segurar(new RegExp(`^/token/${a}$`), 'PUT');
    await botaoSalvar(page).click();
    await put.respondida;

    await urlNoSeletor(await abrirSeletor(page), b).click();

    await expect(barraDeSalvar(page)).toContainText(`Saving… then opening URL ${b.slice(0, 5)}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(page.url()).toMatch(new RegExp(`#/${a}/checks$`));
    put.soltar();
    await expect(page).toHaveURL(new RegExp(`#/${b}/checks$`));
    await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
      new RegExp(`/${b}$`),
    );
    expect((await tokens.read(a))['default_content']).toBe('depois');
  });

  test('deve ficar na URL com o aviso do erro, sem abrir a outra, Quando o salvar falha', async ({
    page,
    tokens,
    caos,
  }) => {
    const [a, b] = [await tokens.create(), await tokens.create()];
    await seedStorage(page, { [CHAVE_URLS]: listaDeUrls([{ uuid: a }, { uuid: b }]) });
    const resposta = await abrirChecks(page, a, 'Response');
    await resposta.getByLabel('Response body').fill('depois');
    const put = caos.segurar(new RegExp(`^/token/${a}$`), 'PUT');
    await botaoSalvar(page).click();
    await put.respondida;
    await urlNoSeletor(await abrirSeletor(page), b).click();
    await expect(barraDeSalvar(page)).toContainText(`Saving… then opening URL ${b.slice(0, 5)}`);

    put.soltar(503);

    await expect(barraDeSalvar(page).getByRole('alert')).toBeVisible();
    await depoisDeTratar(page);
    expect(page.url()).toMatch(new RegExp(`#/${a}/checks$`));
    await expect(secao(page, 'Response').getByLabel('Response body')).toHaveValue('depois');
  });
});
