import { createHmac } from 'node:crypto';
import { APIRequestContext, Locator, Page, Response } from '@playwright/test';
import { abrirChecks, secao, botaoSalvar, barraDeSalvar } from './support/checks';
import { expect, test } from './support/fixtures';
import { seedStorage } from './support/storage';

// Item 14, E5 — refutação independente (CA-12), transformada em spec: o que a refutação provou que a E5 quebra.
// (a) CA-11 entre abas: o que outra aba (ou o CLI, ou o MCP) gravou no `PUT /token` depois que esta aba leu a URL
//     não volta ao padrão quando esta aba salva outro cartão; ou persiste, ou a tela avisa e não sobrescreve;
// (b) trocar o segredo em Privacy não derruba a própria tela: nenhuma chamada volta 401, o desbloqueio não aparece,
//     o rascunho de outro cartão e o "Saved." do Privacy ficam;
// (c) apagar o Timeout salva `timeout` 0 (o que o placeholder diz), não `null` (o servidor recusa com 422).
// SUPOSIÇÕES (seguem a implementação da E5): o aviso de conflito é um `alert` com "changed elsewhere"; com a URL
// protegida, o campo do segredo novo é "New secret"; salvar mostra "Saved." no cartão.

const SECRET = 'segredo-da-concorrencia';
const BODY = '{"action":"opened","number":42}';
const SEGREDO_ANTIGO = 'segredo-antigo-1234';
const SEGREDO_NOVO = 'segredo-novo-5678';

/** O que outra aba manda no `PUT /token/{id}`: a configuração que ela leu, com uma mudança. */
async function gravarEmOutraAba(
  api: APIRequestContext,
  tokenId: string,
  mudanca: Record<string, unknown>,
): Promise<void> {
  const atual = (await (await api.get(`/token/${tokenId}`)).json()) as Record<string, unknown>;
  const response = await api.put(`/token/${tokenId}`, {
    data: {
      default_status: String(atual['default_status']),
      default_content_type: atual['default_content_type'],
      timeout: String(atual['timeout']),
      default_content: atual['default_content'],
      retry_after: atual['retry_after'] ?? null,
      auto_cleanup: atual['auto_cleanup'] ?? null,
      signature: atual['signature'] ?? null,
      schema: atual['schema'] ?? null,
      ...mudanca,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
}

function conflito(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: /changed elsewhere/i });
}

/**
 * Clica no Save e espera o desfecho sem espera fixa: o `PUT /token/{id}` responder, ou o aviso de conflito aparecer
 * (quando a tela prefere não gravar). Devolve a resposta do PUT, se houve.
 */
async function salvarEsperando(page: Page, tokenId: string): Promise<Response | null> {
  const put = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith(`/token/${tokenId}`),
  );
  await botaoSalvar(page).click();
  return Promise.race([
    put,
    conflito(page)
      .waitFor()
      .then(() => null),
  ]);
}

async function destrancar(page: Page, segredo: string): Promise<void> {
  await page.getByLabel('Secret', { exact: true }).fill(segredo);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Unlock' })).toHaveCount(0);
}

test.describe('Dado outra aba que grava a URL depois que esta leu (CA-11 entre abas)', () => {
  test('não deve voltar o schema ao padrão Quando "Save response" é clicado depois', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_content: 'antes' });
    await seedStorage(page, {});
    const resposta = await abrirChecks(page, tokenId, 'Response');
    await expect(resposta.getByLabel('Response body')).toHaveValue('antes');

    await gravarEmOutraAba(request, tokenId, { schema: { type: 'object' } });
    await resposta.getByLabel('Response body').fill('depois');
    const put = await salvarEsperando(page, tokenId);

    const depois = await tokens.read(tokenId);
    expect(depois['schema'], 'o schema da outra aba continua').toEqual({ type: 'object' });
    if (put) {
      expect(put.status()).toBe(200);
      expect(depois['default_content']).toBe('depois');
    } else {
      await expect(conflito(page)).toBeVisible();
    }
  });

  test('não deve voltar a assinatura ao padrão Quando "Save schema" é clicado depois', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_content: 'antes' });
    await seedStorage(page, {});
    const schema = await abrirChecks(page, tokenId, 'Schema validation');
    await expect(secao(page, 'Response').getByLabel('Response body')).toHaveValue('antes');

    await gravarEmOutraAba(request, tokenId, { signature: { provider: 'github', secret: SECRET } });
    await schema.getByRole('textbox', { name: 'JSON Schema' }).fill('{"type":"object"}');
    const put = await salvarEsperando(page, tokenId);

    expect(await tokens.read(tokenId)).toMatchObject({ signature: { provider: 'github' } });
    if (put) {
      expect(put.status()).toBe(200);
      // O segredo gravado pela outra aba segue valendo.
      const hmac = createHmac('sha256', SECRET).update(BODY).digest('hex');
      const requestId = await tokens.send(tokenId, {
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${hmac}` },
        data: BODY,
      });
      const mensagem = (await (
        await request.get(`/token/${tokenId}/request/${requestId}`)
      ).json()) as { signature: { valid: boolean } | null };
      expect(mensagem.signature?.valid).toBe(true);
    } else {
      await expect(conflito(page)).toBeVisible();
    }
  });
});

test.describe('Dado uma URL protegida aberta nesta tela, com um rascunho em outro cartão', () => {
  test('deve trocar o segredo sem 401, sem desbloqueio e sem perder o rascunho Quando "Save privacy" é clicado', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ read_secret: SEGREDO_ANTIGO });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await destrancar(page, SEGREDO_ANTIGO);
    const privacy = await abrirChecks(page, tokenId, 'Privacy');
    const corpo = secao(page, 'Response').getByLabel('Response body');
    await corpo.fill('rascunho-que-fica');
    await privacy.getByLabel('New secret', { exact: true }).fill(SEGREDO_NOVO);
    await privacy.getByLabel('Confirm secret', { exact: true }).fill(SEGREDO_NOVO);

    const recusas: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes(`/token/${tokenId}`) && r.status() === 401) {
        recusas.push(`${r.request().method()} ${new URL(r.url()).pathname}`);
      }
    });
    // Registra se a tela de desbloqueio aparece, mesmo que por um instante (sem sondar por tempo). Pela tela em si:
    // o heading exato "This URL is protected" ou o botão "Unlock" (o cartão Privacy tem uma frase que começa igual).
    await page.evaluate(() => {
      const marca = window as unknown as { desbloqueioApareceu?: boolean };
      marca.desbloqueioApareceu = false;
      const texto = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim();
      new MutationObserver(() => {
        const heading = [
          ...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]'),
        ].some((el) => texto(el) === 'This URL is protected');
        const unlock = [...document.querySelectorAll('button, [role=button]')].some(
          (el) => texto(el) === 'Unlock',
        );
        if (heading || unlock) {
          marca.desbloqueioApareceu = true;
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    // Determinismo: entre o PUT (que troca o segredo e invalida o cookie de acesso) e o `POST /unlock` com o segredo
    // novo há uma janela. O `POST /unlock` só segue depois que qualquer leitura que a tela disparar nessa janela (o
    // Health relê o `stats`) tiver voltado; se a tela não ler nada ali, segue no limite de 3 s. Assim o 401 da janela,
    // quando existe, acontece sempre, e não só quando a máquina está lenta.
    await page.route(`**/token/${tokenId}/unlock`, async (route) => {
      await page
        .waitForResponse(
          (r) => r.request().method() === 'GET' && r.url().includes(`/token/${tokenId}/stats`),
          { timeout: 3_000 },
        )
        .catch(() => undefined);
      await route.continue();
    });
    const put = await salvarEsperando(page, tokenId);
    tokens.protectedWith(tokenId, SEGREDO_NOVO);

    expect(put?.status()).toBe(200);
    // Soft: um defeito não esconde os outros.
    await expect.soft(page.getByText('URL updated!').last()).toBeVisible();
    await expect.soft(barraDeSalvar(page)).toBeHidden();
    await expect.soft(corpo).toHaveValue('rascunho-que-fica');
    expect.soft(recusas, 'nenhuma chamada da tela volta 401').toEqual([]);
    expect
      .soft(
        await page.evaluate(
          () => (window as unknown as { desbloqueioApareceu?: boolean }).desbloqueioApareceu,
        ),
        'o desbloqueio não aparece',
      )
      .toBe(false);
    const comNovo = await request.get(`/token/${tokenId}`, {
      headers: { 'X-Webhook-Secret': SEGREDO_NOVO },
    });
    expect(comNovo.status()).toBe(200);
  });
});

// Fidelidade ao C, fase 2 (CHECKS-21): o timeout vira slider de 0 a 10 e nunca fica vazio; o caso "timeout
// apagado" vira "slider levado a 0".
test.describe('Dado o slider Timeout levado a 0 no cartão Response', () => {
  test('deve salvar timeout 0, e não null, com resposta 200', async ({ page, tokens }) => {
    const tokenId = await tokens.create({ timeout: '3' });
    await seedStorage(page, {});
    const resposta = await abrirChecks(page, tokenId, 'Response');
    const timeout = resposta.getByRole('slider', { name: 'Timeout before response' });
    await expect(timeout).toHaveValue('3');

    await timeout.focus();
    await page.keyboard.press('Home');
    await expect(timeout).toHaveValue('0');
    const put = await salvarEsperando(page, tokenId);

    expect(put, 'o Save manda o PUT').not.toBeNull();
    const corpo = put!.request().postDataJSON() as Record<string, unknown>;
    expect(corpo['timeout']).not.toBeNull();
    expect(Number(corpo['timeout'])).toBe(0);
    expect(put!.status()).toBe(200);
    expect(await tokens.read(tokenId)).toMatchObject({ timeout: 0 });
  });
});

// Reauditoria CA-12 sobre 35ba5f2: os parâmetros de rota `?schema-from=` (E5) e `?replay=` (E7) são o id de uma
// mensagem desta URL; um valor com `../` não pode levar a tela a ler fora de `/token/{id}/` (por exemplo o link
// só-leitura de outra URL, `/share/{sid}`) nem preencher a página com dados de outra URL.
test.describe('Dado ?schema-from= e ?replay= com um caminho relativo (../) no lugar do id', () => {
  test('não deve ler fora de /token/{id}/ nem mostrar dados de outra URL', async ({
    page,
    request,
    tokens,
  }) => {
    const minha = await tokens.create();
    const outra = await tokens.create();
    const daOutra = await tokens.send(outra, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"campo_da_outra":"valor-da-outra-url"}',
    });
    const link = await request.post(`/token/${outra}/request/${daOutra}/share`, {
      data: { expires_in: '1h', redact: false },
    });
    expect([200, 201]).toContain(link.status());
    const { id: sid } = (await link.json()) as { id: string };
    const foraDaUrl: string[] = [];
    page.on('request', (sent) => {
      const caminho = new URL(sent.url()).pathname;
      const leitura = ['fetch', 'xhr', 'eventsource'].includes(sent.resourceType());
      if (leitura && !caminho.startsWith(`/token/${minha}`)) {
        foraDaUrl.push(`${sent.method()} ${caminho}`);
      }
    });
    const travessia = encodeURIComponent(`../../../share/${sid}`);
    await seedStorage(page, {});

    await page.goto(`/#/${minha}/checks?schema-from=${travessia}`);
    const schema = secao(page, 'Schema validation');
    await expect(schema).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect
      .soft(schema.getByRole('textbox', { name: 'JSON Schema' }))
      .not.toHaveValue(/campo_da_outra/);

    await page.goto(`/#/${minha}/outbound?replay=${travessia}`);
    await page.waitForLoadState('networkidle');
    await expect.soft(page.locator('body')).not.toContainText('valor-da-outra-url');
    expect(foraDaUrl, 'a tela só lê em /token/{id}/ desta URL').toEqual([]);
  });
});
