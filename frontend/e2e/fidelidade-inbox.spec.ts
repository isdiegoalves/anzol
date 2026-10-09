import { createHmac } from 'node:crypto';
import { APIRequestContext, Page, Request } from '@playwright/test';
import { TokenTracker, expect, test } from './support/fixtures';
import {
  abrirItem,
  abrirMensagem,
  acoes,
  busca,
  campoDeBusca,
  detalhes,
  filtro,
  item,
  itens,
  lista,
  abrirFiltros,
} from './support/inbox';
import { destino, secoes } from './support/shell';
import { readStorage, seedStorage } from './support/storage';

// Item 14.1, fatia F1 (fidelidade ao protótipo C): shell, Inbox, celular e Compare. Cada teste cobre um item de
// `.docs-arquivo/fidelidade-prototipo/desvios.json` (decisão "corrigir") e respeita as Travas do 00-STATUS.
// SUPOSIÇÕES (nomes do protótipo C quando ele os tem; os demais marcados aqui):
// - INBOX-01: `button "Sorted newest first. Change order"` no cabeçalho da lista; ao clicar vira "Sorted oldest
//   first. Change order" e a lista inverte; a pílula de novas começa com "↑";
// - INBOX-02/CHECKS-23: o destino Inbox do rail (e da barra inferior) mostra o número de não lidas e se chama
//   "Inbox, N unread"; o destino Checks se chama "Checks, 1 invalid signature since 21:10" quando a URL tem
//   assinatura ou schema inválidos;
// - INBOX-03/CHECKS-22: `link "N requests, auto cleanup keeps the M most recent"` no cabeçalho da URL, com o texto
//   "N · keeps M", levando a `#/{token}/checks?section=response`;
// - INBOX-04: sai o "Edit" à vista; `button "More URL actions"` abre um menu com `menuitem` "Edit URL", "Open in new
//   tab" (link para a URL), "Copy CLI command" (copia o `anzol listen … --token {uuid}` da aba CLI) e "Delete URL",
//   que pede confirmação no `dialog "Delete this URL?"` (botão "Delete URL") e, apagada, abre uma URL nova;
// - INBOX-09 (trava 4): na linha principal do `group "Filters"`, na ordem, "POST", "GET", "PUT", "Signature invalid",
//   "Signature absent" e "Schema invalid"; o `button "More filters"` (com `aria-expanded`) mostra os outros ("PATCH",
//   "DELETE", "Signature valid", "Schema valid"), sem perder nenhum;
// - INBOX-11: a linha 2 do item traz o resumo do corpo: o `type` (ou `event`) do JSON quando existe, senão o
//   user-agent;
// - filtros na rota: `#/{token}?signature=…&schema=…&methods=POST,GET&q=texto` abre com os chips pressionados e o
//   Search preenchido; mudar um filtro atualiza a rota; parâmetro inválido é ignorado;
// - INBOX-29/30/31/33 (390 px): barra do topo com `heading` h1 do destino ("Inbox"), `button "Search requests"` e
//   `button "More actions"` (menu com "Send", "New URL", "Delete URL", "Settings", "Help", "Edit URL" e, numa URL
//   com segredo destrancada, "Lock"); o cartão da URL sem a linha Send/Edit e escondido na tela do detalhe; chips
//   numa linha só que rola; a lista começa perto do topo; no detalhe, "Back to requests" no topo, as ações
//   principais numa linha e as demais no menu "More" (trava 5);
// - Compare (RULES-28/30/35/36): `heading "Compare"` com o resumo "N header(s) changed" e "N body line(s) differ";
//   na `table "Checks"`, as colunas "A · #xxxxx" e "B · #yyyyy" e nenhuma coluna "Status"; o chip da regra diz o
//   status ("201 · …"); na rota, o `status` "Compare mode. Click a request to make it B. Press Esc to leave.", sem a
//   busca, e o Esc sai do Compare; a 390 px, as células da tabela Checks não espremem o texto.

const SECRET = 'segredo-da-fidelidade';

function github(secret: string, body: string) {
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    data: body,
  };
}

async function maisNovasPrimeiro(api: APIRequestContext, tokenId: string): Promise<string[]> {
  const response = await api.get(`/token/${tokenId}/requests`, { params: { sorting: 'newest' } });
  return ((await response.json()) as { data: { uuid: string }[] }).data.map((r) => r.uuid);
}

function buscaCom(page: Page, fragmento: string): Promise<Request> {
  return page.waitForRequest(
    (sent) =>
      sent.method() === 'POST' &&
      sent.url().endsWith('/requests/search') &&
      (sent.postData() ?? '').includes(fragmento),
  );
}

test.describe('Dado a lista da Inbox (INBOX-01, a mais nova no topo)', () => {
  test('deve inverter a ordem pelo botão do cabeçalho e voltar', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    for (const data of ['um', 'dois', 'tres']) {
      await tokens.send(tokenId, { data });
    }
    const ordem = await maisNovasPrimeiro(request, tokenId);
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(3);
    await expect(abrirItem(page, ordem[0])).toBeVisible();
    await expect(itens(page).first()).toContainText(/.+/);
    expect(
      await itens(page).first().getByRole('button').first().getAttribute('aria-label'),
    ).toContain(`#${ordem[0].substring(0, 5)}`);

    await page.getByRole('button', { name: 'Sorted newest first. Change order' }).click();

    await expect(
      page.getByRole('button', { name: 'Sorted oldest first. Change order' }),
    ).toBeVisible();
    await expect
      .poll(async () => itens(page).first().getByRole('button').first().getAttribute('aria-label'))
      .toContain(`#${ordem[2].substring(0, 5)}`);
  });

  test('deve pôr a nova no topo e apontar a pílula para cima Quando chega com outra aberta', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const aberta = await tokens.send(tokenId, { data: 'aberta' });
    await seedStorage(page, {});
    const stream = page.waitForResponse((r) => r.url().endsWith(`/token/${tokenId}/stream`));
    await abrirMensagem(page, tokenId, aberta);
    await stream;

    const nova = await tokens.send(tokenId, { data: 'nova' });

    await expect(item(page, nova)).toBeVisible();
    await expect(
      itens(page)
        .first()
        .getByRole('button', { name: new RegExp(`#${nova.substring(0, 5)}`) }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /\b1 new request\b/ })).toContainText('↑');
    await expect(detalhes(page)).toContainText(aberta);
  });
});

test.describe('Dado o rail com mensagens não lidas e verificações inválidas (INBOX-02, CHECKS-23)', () => {
  test('deve contar as não lidas na Inbox e marcar Checks como precisando de atenção', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const valida = await tokens.send(tokenId, github(SECRET, '{"id":1}'));
    const invalida = await tokens.send(tokenId, github('outro-segredo', '{"id":2}'));
    await seedStorage(page, { unread: JSON.stringify({ [tokenId]: [valida, invalida] }) });

    await page.goto(`/#/${tokenId}`);

    await expect(destino(page, 'Inbox')).toHaveAccessibleName('Inbox, 2 unread');
    await expect(destino(page, 'Inbox')).toContainText('2');
    await expect(destino(page, 'Checks')).toHaveAccessibleName(
      /^Checks, 1 invalid signature since \d{1,2}:\d{2}/,
    );
  });

  test('não deve marcar Checks nem contar Quando está tudo lido e válido', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    await tokens.send(tokenId, github(SECRET, '{"id":1}'));
    await seedStorage(page, { unread: '[]' });

    await page.goto(`/#/${tokenId}`);

    await expect(destino(page, 'Inbox')).toHaveAccessibleName('Inbox');
    await expect(destino(page, 'Checks')).toHaveAccessibleName('Checks');
  });
});

test.describe('Dado o cabeçalho da URL (INBOX-03/04, CHECKS-22)', () => {
  test('deve mostrar a contagem com a limpeza e levar a Checks › Response', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ auto_cleanup: 500 });
    await tokens.send(tokenId, { data: 'um' });
    await tokens.send(tokenId, { data: 'dois' });
    await page.goto(`/#/${tokenId}`);

    const chip = page.getByRole('link', {
      name: '2 requests, auto cleanup keeps the 500 most recent',
    });
    await expect(chip).toContainText('2 · keeps 500');
    await chip.click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/checks\\?section=response$`));
  });

  test('deve trocar o "Edit" pelo menu ⋮ com Edit URL, Open in new tab, Copy CLI command e Delete URL', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    const url = `${new URL(page.url()).origin}/${tokenId}`;
    await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);

    const menu = page.getByRole('button', { name: 'More URL actions' });
    await menu.click();
    await expect(page.getByRole('menuitem', { name: 'Edit URL' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Open in new tab' })).toHaveAttribute(
      'href',
      url,
    );
    await page.getByRole('menuitem', { name: 'Copy CLI command' }).click();
    const comando = await page.evaluate(() => navigator.clipboard.readText());
    expect(comando).toMatch(/^anzol listen /);
    expect(comando).toContain(`--token ${tokenId}`);

    await menu.click();
    await page.getByRole('menuitem', { name: 'Delete URL' }).click();
    const confirmar = page.getByRole('dialog', { name: 'Delete this URL?' });
    await confirmar.getByRole('button', { name: 'Delete URL' }).click();

    await expect(page).not.toHaveURL(new RegExp(tokenId));
    tokens.track(new RegExp('#/([0-9a-f-]{36})').exec(page.url())?.[1] ?? tokenId);
    expect((await request.get(`/token/${tokenId}`)).status()).not.toBe(200);
  });
});

test.describe('Dado os chips de filtro (INBOX-09, trava 4)', () => {
  test('deve mostrar os chips do protótipo começando por POST, todos no painel de filtros', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { method: 'PATCH', data: 'patch' });
    await tokens.send(tokenId, { method: 'POST', data: 'post' });
    await page.goto(`/#/${tokenId}`);
    const grupo = page.getByRole('group', { name: 'Filters' });
    await expect(itens(page)).toHaveCount(2);

    await abrirFiltros(page);
    const visiveis = await grupo
      .getByRole('button', { pressed: false })
      .filter({ visible: true })
      .allInnerTexts();
    expect(visiveis[0].trim()).toBe('POST');
    await expect(page.getByRole('button', { name: 'More filters' })).toHaveCount(0);
    for (const nome of [
      'GET',
      'PUT',
      'Signature invalid',
      'Signature absent',
      'Schema invalid',
      'PATCH',
      'DELETE',
      'Signature valid',
      'Schema valid',
    ]) {
      await expect(filtro(page, nome)).toBeVisible();
    }
    const porPatch = buscaCom(page, '"PATCH"');
    await filtro(page, 'PATCH').click();
    expect((await porPatch).postDataJSON()).toMatchObject({ match: { method: ['PATCH'] } });
    await expect(itens(page)).toHaveCount(1);
  });
});

test.describe('Dado o resumo do corpo no item (INBOX-11)', () => {
  test('deve mostrar o type do JSON, ou o user-agent, na linha 2 do item', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const comTipo = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"type":"payment_intent.succeeded","id":"evt_1"}',
    });
    const semTipo = await tokens.send(tokenId, {
      headers: { 'User-Agent': 'agente-de-teste/1.0' },
      data: 'texto',
    });
    await page.goto(`/#/${tokenId}`);

    await expect(item(page, comTipo)).toContainText('payment_intent.succeeded');
    await expect(item(page, semTipo)).not.toContainText('agente-de-teste/1.0');
  });
});

test.describe('Dado filtros na rota da Inbox', () => {
  test('deve abrir com os chips e o Search da rota, acompanhar a tela e ignorar o inválido', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: SECRET },
      schema: { type: 'object', required: ['id'] },
    });
    const casa = await tokens.send(tokenId, github('outro-segredo', '{"pedido":"abc-1"}'));
    await tokens.send(tokenId, github(SECRET, '{"id":1,"pedido":"abc-2"}'));
    await tokens.send(tokenId, { method: 'GET', path: '?pedido=abc-3' });

    await page.goto(`/#/${tokenId}?signature=invalid&methods=POST&q=abc`);

    await abrirFiltros(page);
    await expect(filtro(page, 'Signature invalid')).toHaveAttribute('aria-pressed', 'true');
    await abrirFiltros(page);
    await expect(filtro(page, 'POST')).toHaveAttribute('aria-pressed', 'true');
    await expect(campoDeBusca(page)).toHaveValue('abc');
    await expect(itens(page)).toHaveCount(1);
    await expect(item(page, casa)).toBeVisible();

    await abrirFiltros(page);
    await filtro(page, 'Schema invalid').click();
    await expect(page).toHaveURL(/[?&]schema=invalid\b/);
    await expect(page).toHaveURL(/[?&]signature=invalid\b/);

    await page.goto(`/#/${tokenId}?signature=talvez`);
    await expect(itens(page)).toHaveCount(3);
    for (const chip of ['Signature invalid', 'Signature absent']) {
      await abrirFiltros(page);
      await expect(filtro(page, chip)).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

/**
 * INBOX-11 (checagem de layout): com o user-agent de um navegador de verdade no resumo, a linha `.meta` do item corta
 * com reticências dentro do item, e o #id continua à vista no painel da lista.
 */
const UA_DE_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

test.describe('Dado um item da lista com o user-agent de um navegador (INBOX-11, layout)', () => {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 1600, height: 1000 },
  ]) {
    test(`não deve transbordar o item nem esconder o #id a ${viewport.width} px`, async ({
      page,
      tokens,
    }) => {
      await page.setViewportSize(viewport);
      const tokenId = await tokens.create();
      const requestId = await tokens.send(tokenId, {
        headers: { 'User-Agent': UA_DE_NAVEGADOR },
        data: 'x',
      });
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}`);
      await expect(item(page, requestId)).toBeVisible();

      const medida = await item(page, requestId).evaluate(
        (el, painel) => {
          const direita = (e: Element) => Math.round(e.getBoundingClientRect().right);
          const meta = el.querySelector('.meta') as HTMLElement;
          const id = el.querySelector('.id') as HTMLElement;
          return {
            item: [el.scrollWidth, el.clientWidth],
            meta: [meta.scrollWidth, meta.clientWidth],
            // Bordas direitas: painel da lista, item, linha .meta e #id.
            direitas: [painel!, el, meta, id].map(direita),
          };
        },
        await lista(page).elementHandle(),
      );
      const [painel, noItem, naMeta, doId] = medida.direitas;
      expect(medida.item[0], 'o item não transborda').toBeLessThanOrEqual(medida.item[1]);
      expect(medida.meta[0], 'a linha .meta não transborda').toBeLessThanOrEqual(medida.meta[1]);
      expect(noItem, 'o item dentro do painel da lista').toBeLessThanOrEqual(painel + 1);
      expect(naMeta, 'a linha .meta dentro do item').toBeLessThanOrEqual(noItem + 1);
      expect(doId, 'o #id dentro do painel da lista').toBeLessThanOrEqual(painel);
      await expect(item(page, requestId)).toContainText(`#${requestId.substring(0, 5)}`);
    });
  }
});

/**
 * INBOX-19 (checagem de layout): a `toolbar "Request actions"` não rola nem corta botão em nenhuma largura. A 1400 e a
 * 1600 px as ações quebram de linha; a 390 px ficam Replay, Create rule e Copy payload, e o resto (Copy As inclusive)
 * vai para o menu "More" do detalhe (trava 5).
 */
test.describe('Dado a barra de ações do detalhe (INBOX-19, layout)', () => {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 1600, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    test(`não deve rolar nem cortar botão a ${viewport.width} px`, async ({ page, tokens }) => {
      await page.setViewportSize(viewport);
      const tokenId = await tokens.create();
      const requestId = await tokens.send(tokenId, {
        headers: { 'Content-Type': 'application/json' },
        data: '{"id":1}',
      });
      await seedStorage(page, {});
      await abrirMensagem(page, tokenId, requestId);

      const barra = acoes(page);
      await expect(barra.getByRole('button', { name: 'Copy payload' })).toBeVisible();
      const medida = await barra.evaluate((el) => {
        const caixa = el.getBoundingClientRect();
        const botoes = [...el.querySelectorAll('button')].filter(
          (b) => (b as HTMLElement).offsetParent !== null,
        );
        return {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          cortados: botoes
            .filter((b) => {
              const r = b.getBoundingClientRect();
              return (
                r.left < caixa.left - 1 ||
                r.right > caixa.right + 1 ||
                b.scrollWidth > b.clientWidth + 1
              );
            })
            .map((b) => b.textContent?.trim()),
        };
      });
      expect(medida.scrollWidth, 'a barra não rola').toBeLessThanOrEqual(medida.clientWidth);
      expect(medida.cortados, 'nenhum botão cortado').toEqual([]);

      if (viewport.width < 600) {
        await expect(barra.getByRole('button', { name: 'Copy As' })).toHaveCount(0);
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Copy As' }).click();
        for (const formato of ['curl', 'HAR']) {
          await expect(page.getByRole('menuitem', { name: formato, exact: true })).toBeVisible();
        }
      }
    });
  }
});

test.describe('Dado o celular a 390×844 (INBOX-29/30/31/33)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('deve pôr o "Lock" no menu "More actions" Quando a URL tem segredo e está destrancada', async ({
    page,
    tokens,
  }) => {
    const segredo = 'segredo-do-menu-compacto';
    const tokenId = await tokens.create({ read_secret: segredo });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await page.getByLabel('Read secret', { exact: true }).fill(segredo);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    for (const nome of ['Send', 'New URL', 'Delete URL', 'Settings', 'Help', 'Lock']) {
      await expect(page.getByRole('menuitem', { name: nome, exact: true })).toBeVisible();
    }
    await page.getByRole('menuitem', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'This URL is protected' })).toBeVisible();
  });

  test('deve ter a barra do topo do protótipo, o cartão da URL sem Send/Edit e a lista perto do topo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ auto_cleanup: 500 });
    for (const data of ['um', 'dois', 'tres']) {
      await tokens.send(tokenId, { data });
    }
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(3);

    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Search requests' }).click();
    await expect(campoDeBusca(page)).toBeFocused();

    const menu = page.getByRole('button', { name: 'More actions', exact: true });
    await menu.click();
    for (const nome of ['Send', 'New URL', 'Delete URL', 'Settings', 'Help']) {
      await expect(page.getByRole('menuitem', { name: nome, exact: true })).toBeVisible();
    }
    // Sem segredo na URL, não há o que trancar.
    await expect(page.getByRole('menuitem', { name: 'Lock', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'Send', exact: true })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);

    // Chips numa linha só (rola na horizontal) e a lista começando perto do topo. A lista é medida antes de abrir
    // os filtros: no celular o painel fica por cima dela.
    expect((await itens(page).first().boundingBox())!.y, 'lista perto do topo').toBeLessThan(330);
    await abrirFiltros(page);
    const chips = page.getByRole('group', { name: 'Filters' }).getByRole('button');
    const alturas = new Set<number>();
    for (let i = 0; i < 3; i++) {
      alturas.add(Math.round((await chips.nth(i).boundingBox())!.y));
    }
    expect(alturas.size, 'chips na mesma linha').toBe(1);
  });

  test('deve abrir o detalhe com Back no topo, ações numa linha e o resto no menu, sem o cartão da URL', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"id":1}',
    });
    await seedStorage(page, {});

    await abrirMensagem(page, tokenId, requestId);

    const voltar = page.getByRole('button', { name: 'Back to requests' });
    expect((await voltar.boundingBox())!.y, 'Back no topo').toBeLessThan(80);
    await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toBeHidden();
    const barra = acoes(page);
    expect((await barra.boundingBox())!.height, 'ações numa linha').toBeLessThanOrEqual(64);
    for (const nome of [/^Replay/, 'Create rule from this request', 'Copy payload']) {
      await expect(barra.getByRole('button', { name: nome })).toBeVisible();
    }
    await page.getByRole('button', { name: 'More', exact: true }).click();
    for (const nome of [
      /^Send as new/,
      /^Compare with/,
      'Create schema from this request',
      /^Share read-only link/,
      'Explain',
      'Permalink',
      'Raw content',
    ]) {
      await expect(page.getByRole('menuitem', { name: nome })).toBeVisible();
    }
  });

  test('deve mostrar o contador de não lidas na barra inferior', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const nova = await tokens.send(tokenId, { data: 'x' });
    await seedStorage(page, { unread: JSON.stringify({ [tokenId]: [nova] }) });
    await page.goto(`/#/${tokenId}`);

    await expect(destino(page, 'Inbox')).toHaveAccessibleName('Inbox, 1 unread');
    await expect(secoes(page)).toBeVisible();
  });
});

test.describe('Dado o Compare pela rota (RULES-28/30/35/36)', () => {
  async function abrirCompare(page: Page, tokens: TokenTracker) {
    const tokenId = await tokens.create();
    const put = await page.request.put(`/token/${tokenId}/rules`, {
      data: [
        {
          name: 'Lado A',
          match: { headers: { 'X-Lado': { equals: 'a' } } },
          response: { status: 201 },
        },
      ],
    });
    expect(put.status()).toBe(200);
    const json = { 'Content-Type': 'application/json' };
    const a = await tokens.send(tokenId, {
      headers: { ...json, 'X-Lado': 'a' },
      data: '{"id":1,"status":"pending"}',
    });
    const b = await tokens.send(tokenId, {
      headers: { ...json, 'X-Lado': 'b' },
      data: '{"id":1,"status":"paid"}',
    });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);
    const view = page.getByRole('region', { name: 'Compare requests' });
    await expect(view).toBeVisible();
    return { tokenId, a, b, view };
  }

  test('deve ter o título, o resumo das diferenças e a tabela Checks com A e B nos cabeçalhos', async ({
    page,
    tokens,
  }) => {
    const { a, b, view } = await abrirCompare(page, tokens);

    await expect(view.getByRole('heading', { name: 'Compare', exact: true })).toBeVisible();
    await expect(view).toContainText(/\b\d+ headers? changed\b/);
    await expect(view).toContainText(/\b\d+ body lines? differ\b/);
    const checks = view.getByRole('table', { name: 'Checks' });
    await expect(
      checks.getByRole('columnheader', { name: `A · #${a.substring(0, 5)}` }),
    ).toBeVisible();
    await expect(
      checks.getByRole('columnheader', { name: `B · #${b.substring(0, 5)}` }),
    ).toBeVisible();
    await expect(checks.getByRole('columnheader', { name: 'Status' })).toHaveCount(0);
    await expect(checks).toContainText(/201 · Lado A/);
  });

  test('deve avisar o modo Compare na lista, sem a busca, e sair pelo Esc', async ({
    page,
    tokens,
  }) => {
    const { tokenId, a } = await abrirCompare(page, tokens);

    await expect(page.getByRole('status').filter({ hasText: 'Compare mode.' })).toHaveText(
      'Compare mode. Click a request to make it B. Press Esc to leave.',
    );
    await expect(busca(page)).toHaveCount(0);
    await expect(lista(page)).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page).not.toHaveURL(/\/compare\//);
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}(/${a}/\\d+)?$`));
  });

  test.describe('no celular', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('deve deixar a tabela Checks legível, sem espremer as células', async ({
      page,
      tokens,
    }) => {
      const { view } = await abrirCompare(page, tokens);
      const checks = view.getByRole('table', { name: 'Checks' });
      await expect(checks).toBeVisible();

      const larguras = await checks
        .getByRole('cell')
        .evaluateAll((celulas) => celulas.map((c) => c.getBoundingClientRect().width));
      expect(larguras.length).toBeGreaterThan(0);
      for (const largura of larguras) {
        expect(largura, 'célula da tabela Checks').toBeGreaterThanOrEqual(150);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      ).toBe(false);
    });
  });
});

test.describe('Dado a preferência antiga de corpo cru (trava 9)', () => {
  test('não deve mexer na escolha salva do usuário', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"n":1}',
    });
    await seedStorage(page, { formatJsonEnable: 'false' });

    await abrirMensagem(page, tokenId, requestId);

    await expect(page.getByRole('switch', { name: 'Pretty', exact: true })).not.toBeChecked();
    expect((await readStorage(page))['formatJsonEnable']).toBe('false');
  });
});
