import { createHmac } from 'node:crypto';
import { APIRequestContext, Locator, Page } from '@playwright/test';
import { abrirChecks } from './support/checks';
import { expect, test } from './support/fixtures';
import { abrirItem, abrirMensagem, acoes, item, itens, lista } from './support/inbox';
import { abrirRegras, editor, linhaDaRegra } from './support/regras';
import { seedStorage } from './support/storage';

// Item 14.1, reauditoria da fidelidade (scratchpad/reaud-fidelidade/veredito.json, "regressoes"): as regressões que as
// specs da fidelidade não pegavam, escritas antes da correção. SUPOSIÇÕES:
// - Inbox a 390 e a 320 px: nenhum `.item` nem a lista virtual rolam de lado, o que o item mostra (rota, tempo
//   relativo, selos) não passa da borda dele nem da tela, e a lixeira "Delete request {uuid}" de cada item fica
//   dentro da tela;
// - Rules a 1440 com o editor aberto (lista de 440 px): numa regra com os três flags (template, delay e scenario), o
//   `.name` tem mais de 80 px e ocupa uma linha só (não quebra letra a letra);
// - foco: "Back to requests" (390 px) devolve o foco ao botão do item aberto; abrir uma regra com Enter põe o foco no
//   `textbox "Name"` do editor; "Discard" devolve o foco ao botão da regra na lista; depois de Replay e de Send, o foco
//   fica dentro da `region "Outbound detail"`;
// - pt-BR: o rótulo visível do Share na barra de ações é "Compartilhar"; os atalhos do `navigation "Nesta página"` de
//   Checks são "Assinatura", "Schema", "Resposta", "Privacidade" e "Saúde";
// - Checks › Signature (Stripe com segredo salvo) a 1440: a ajuda "Leave blank to keep the current secret" não
//   encosta no rótulo "Timestamp tolerance (seconds)".

const SECRET = 'segredo-da-reauditoria';
const JSON_TIPO = '{"type":"payment_intent.succeeded","id":1}';

function github(secret: string | null, body: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) {
    headers['X-Hub-Signature-256'] =
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }
  return { headers, data: body };
}

function stripe(body: string) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  return {
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
    data: body,
  };
}

type Caixa = { x: number; y: number; width: number; height: number };

function seCruzam(a: Caixa, b: Caixa): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test.describe('Dado a lista da Inbox no celular', () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ]) {
    test(`não deve rolar de lado nem pôr a lixeira fora da tela a ${viewport.width} px`, async ({
      page,
      tokens,
    }) => {
      await page.setViewportSize(viewport);
      const tokenId = await tokens.create({ signature: { provider: 'stripe', secret: SECRET } });
      // A mais nova sem assinatura: o selo "No signature" é o mais largo.
      const ids = [
        await tokens.send(tokenId, { ...stripe(JSON_TIPO), path: '/webhooks/stripe' }),
        await tokens.send(tokenId, { ...github(null, JSON_TIPO), path: '/webhooks/stripe' }),
      ];
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}`);
      await expect(itens(page)).toHaveCount(2);

      const medidas = await lista(page).evaluate((regiao) => {
        const rola = (e: Element) => e.scrollWidth > e.clientWidth + 1;
        const viewport = regiao.querySelector('cdk-virtual-scroll-viewport');
        const quantos = regiao.querySelectorAll('.item').length;
        // O que o item mostra (rota, tempo, selos, lixeira) cabe nele e na tela: nada cortado na borda direita.
        const cortados = [...regiao.querySelectorAll('.item')].flatMap((el) => {
          const limite = Math.min(el.getBoundingClientRect().right, window.innerWidth) + 1;
          return [...el.querySelectorAll('*')]
            .filter((filho) => {
              const r = filho.getBoundingClientRect();
              return r.width > 0 && r.right > limite;
            })
            .map(
              (filho) =>
                `${filho.tagName.toLowerCase()} "${filho.textContent?.trim().slice(0, 20)}"`,
            );
        });
        return {
          quantos,
          itensRolando: [...regiao.querySelectorAll('.item')].filter(rola).length,
          listaRola: viewport ? rola(viewport) : false,
          cortados,
        };
      });
      expect(medidas.quantos, 'os itens medidos').toBe(2);
      expect(medidas.itensRolando, 'itens sem rolagem lateral').toBe(0);
      expect(medidas.listaRola, 'a lista sem rolagem lateral').toBe(false);
      expect(medidas.cortados, 'nada cortado na borda do item').toEqual([]);
      for (const id of ids) {
        const lixeira = item(page, id).getByRole('button', { name: `Delete request ${id}` });
        const caixa = await lixeira.boundingBox();
        expect(caixa, 'a lixeira existe').not.toBeNull();
        expect(caixa!.x + caixa!.width, 'a lixeira dentro da tela').toBeLessThanOrEqual(
          viewport.width,
        );
      }
    });
  }
});

/** URL com uma regra de três flags (template, delay e cenário) e o nome "Refund queued". */
async function regraComFlags(api: APIRequestContext, tokenId: string): Promise<void> {
  const resposta = await api.put(`/token/${tokenId}/rules`, {
    data: [
      {
        name: 'Refund queued',
        priority: 1,
        match: { method: ['POST'], path: { equals: '/refunds' } },
        scenario: { name: 'reembolso', requiredState: 'Started', newState: 'na fila' },
        response: {
          status: 202,
          body: '{"method":"{{request.method}}"}',
          template: true,
          delay: { fixed: 200 },
        },
      },
      { name: 'Outra', priority: 2, response: { status: 200 } },
    ],
  });
  expect(resposta.status(), await resposta.text()).toBe(200);
}

function botaoDaRegra(page: Page, nome: string): Locator {
  return linhaDaRegra(page, nome).locator('td.item').getByRole('button');
}

test.describe('Dado a lista de regras ao lado do editor aberto a 1440 px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('deve manter o nome da regra com flags legível, numa linha e com mais de 80 px', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await regraComFlags(request, tokenId);
    await abrirRegras(page, tokenId);
    await botaoDaRegra(page, 'Outra').click();
    await expect(editor(page, 'Edit rule Outra')).toBeVisible();

    const nome = linhaDaRegra(page, 'Refund queued').locator('.name');
    await expect(linhaDaRegra(page, 'Refund queued').locator('.flag')).toHaveCount(3);
    const medida = await nome.evaluate((el) => {
      const estilo = getComputedStyle(el);
      const linha = parseFloat(estilo.lineHeight) || parseFloat(estilo.fontSize) * 1.5;
      const caixa = el.getBoundingClientRect();
      return { largura: caixa.width, altura: caixa.height, linha };
    });
    expect(medida.largura, 'largura do nome').toBeGreaterThan(80);
    expect(medida.altura, 'nome numa linha').toBeLessThanOrEqual(medida.linha * 1.5);
  });
});

test.describe('Dado o foco depois das ações (reauditoria)', () => {
  test('deve devolver o foco ao item Quando "Back to requests" é usado no celular', async ({
    page,
    tokens,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: 'x' });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await abrirItem(page, requestId).click();
    await page.getByRole('button', { name: 'Back to requests' }).click();

    await expect(abrirItem(page, requestId)).toBeFocused();
  });

  test('deve pôr o foco no nome Quando a regra é aberta com Enter', async ({
    page,
    request,
    tokens,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const tokenId = await tokens.create();
    await regraComFlags(request, tokenId);
    await abrirRegras(page, tokenId);

    await botaoDaRegra(page, 'Outra').focus();
    await page.keyboard.press('Enter');
    const regra = editor(page, 'Edit rule Outra');
    await expect(regra).toBeVisible();
    await expect(regra.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  });

  test('deve devolver o foco à linha da regra Quando "Discard" fecha o editor', async ({
    page,
    request,
    tokens,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const tokenId = await tokens.create();
    await regraComFlags(request, tokenId);
    await abrirRegras(page, tokenId);
    await botaoDaRegra(page, 'Outra').click();
    const regra = editor(page, 'Edit rule Outra');
    await expect(regra).toBeVisible();

    await regra.getByRole('button', { name: 'Discard' }).click();
    await expect(regra).toBeHidden();
    await expect(botaoDaRegra(page, 'Outra')).toBeFocused();
  });

  /** Foco dentro da `region "Outbound detail"`. */
  function focoNoResultado(page: Page): () => Promise<boolean> {
    return () =>
      page
        .getByRole('region', { name: 'Outbound detail' })
        .evaluate((el) => el.contains(document.activeElement))
        .catch(() => false);
  }

  test('deve levar o foco ao resultado depois do Replay', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: 'x' });
    await abrirMensagem(page, tokenId, requestId);
    await acoes(page)
      .getByRole('button', { name: /^Replay/ })
      .click();
    const replay = page.getByRole('region', { name: 'Replay request' });
    await replay.getByRole('textbox', { name: 'Target URL' }).fill('http://169.254.169.254/x');
    await replay.getByRole('button', { name: 'Replay', exact: true }).click();

    const resultado = page
      .getByRole('region', { name: 'Outbound detail' })
      .getByRole('alert')
      .or(page.getByRole('group', { name: 'Action result' }).locator('[role="status"]'));
    await expect(resultado.first()).toContainText('Blocked');
    await expect.poll(focoNoResultado(page), { message: 'foco no resultado do Replay' }).toBe(true);
  });

  test('deve levar o foco ao resultado depois do Send', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}/outbound?send=new`);
    const send = page.getByRole('region', { name: 'Send request' });
    await send.getByRole('textbox', { name: 'URL', exact: true }).fill('http://169.254.169.254/y');
    await send.getByRole('button', { name: 'Send', exact: true }).click();

    const resultado = page.getByRole('region', { name: 'Outbound detail' });
    await expect(resultado.getByRole('alert')).toContainText('Blocked');
    await expect.poll(focoNoResultado(page), { message: 'foco no resultado do Send' }).toBe(true);
  });
});

test.describe('Dado a tela em pt-BR (reauditoria)', () => {
  test('deve mostrar "Compartilhar" na barra de ações', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, github(null, JSON_TIPO));
    await seedStorage(page, { language: '"pt-BR"' });

    await page.goto(`/#/${tokenId}/${requestId}/1`);
    const compartilhar = page.getByRole('toolbar').getByRole('button', { name: /^Compartilhar/ });
    await expect(compartilhar).toBeVisible();
    expect(
      await compartilhar.evaluate((el) =>
        (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
      ),
    ).toBe('Compartilhar');
    await expect(page.getByText('Parcela', { exact: true })).toHaveCount(0);
  });

  test('deve traduzir os atalhos "Nesta página" de Checks', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, { language: '"pt-BR"' });

    await page.goto(`/#/${tokenId}/checks`);
    await expect(
      page.getByRole('navigation', { name: 'Nesta página' }).getByRole('link'),
    ).toHaveText([
      /^\s*Assinatura( · .+)?\s*$/,
      /^\s*Schema( · .+)?\s*$/,
      /^\s*Resposta( · .+)?\s*$/,
      /^\s*Privacidade( · .+)?\s*$/,
      /^\s*Saúde( · .+)?\s*$/,
    ]);
  });
});

test.describe('Dado o formulário do Stripe com segredo salvo a 1440 px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('não deve sobrepor a ajuda do Secret ao rótulo da tolerância', async ({ page, tokens }) => {
    const tokenId = await tokens.create({ signature: { provider: 'stripe', secret: SECRET } });
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');

    const ajuda = assinatura.getByText('Leave blank to keep the current secret');
    const rotulo = assinatura.getByText(/^Timestamp tolerance/).first();
    await expect(ajuda).toBeVisible();
    await expect(rotulo).toBeVisible();
    expect(seCruzam((await ajuda.boundingBox())!, (await rotulo.boundingBox())!)).toBe(false);
  });
});
