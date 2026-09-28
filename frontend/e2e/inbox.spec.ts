import { createHmac } from 'node:crypto';
import { Locator, Page, Request } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import { expect, test } from './support/fixtures';
import {
  aba,
  abrirAba,
  abrirMensagem,
  campoDeBusca,
  detalhes,
  filtro,
  abrirItem,
  item,
  itens,
  lista,
  verificacoes,
  abrirFiltros,
} from './support/inbox';
import { seedStorage } from './support/storage';

// Patamar, B1 (guia-combinacao §3.1 e §7): os chips ficam recolhidos atrás do `button "Filters"`; `abrirFiltros()`
// abre o painel antes de usar um chip.

// Item 14, E4: o que a Inbox nova acrescenta e as specs de hoje não cobrem — split redimensionável, apagar com
// "Undo", "Copy as webhook wait-for" (S10), a linha do header de assinatura em partes, o cartão de assinatura que
// leva à aba Headers, o atalho "/", o link permanente abaixo de 840 px (CA-8/CA-9) e o axe na Inbox e no detalhe
// (CA-2).
// SUPOSIÇÕES (contrato da E4, além das de `support/inbox.ts`):
// - a divisória é o `app-split` da E2 com o nome "Resize list and detail", lembrada entre recargas;
// - apagar uma mensagem mostra o snackbar "Request deleted" com o botão "Undo"; o DELETE só vai à API quando o
//   snackbar fecha sem "Undo";
// - na `search`, o `button "Copy as webhook wait-for"` copia (o CLI se chama `anzol`: o nome do botão pode
//   dizer "anzol wait-for")
//   `anzol wait-for --server '<origem>' --token <uuid> --match '<o match da busca em JSON>'` e confirma num
//   `status` que começa por "Copied"; com texto na busca, a confirmação avisa "The text search is not part of
//   wait-for"; com a URL protegida, o comando leva `--read-secret "$WEBHOOK_READ_SECRET"` (nunca o segredo);
// - abaixo de 840 px aparece um painel por vez; o link permanente da mensagem abre o detalhe, com "Back to
//   requests";
// - a linha do header de assinatura mostra cada parte do valor num elemento próprio (`t=…`, `v1=…` no Stripe);
// - o cartão "Signature …" é clicável e abre a aba "Headers (n)".

const SECRET = 'segredo-da-inbox';
const SEGREDO_DE_LEITURA = 'segredo-de-leitura-da-inbox';

/** A próxima busca cujo corpo contém `fragment`. */
function searchRequest(page: Page, fragment: string): Promise<Request> {
  return page.waitForRequest(
    (sent) =>
      sent.method() === 'POST' &&
      sent.url().endsWith('/requests/search') &&
      (sent.postData() ?? '').includes(fragment),
  );
}

/** O `--match '…'` de um comando copiado, lido como JSON. */
function matchDe(comando: string): unknown {
  const achado = /--match '([^']*)'/.exec(comando);
  expect(achado, `--match em: ${comando}`).not.toBeNull();
  return JSON.parse(achado![1]);
}

/** A confirmação do "Copy as webhook wait-for" (com o aviso do texto que ficou de fora, quando há). */
// Patamar, B1 (guia-combinacao §3.1 e §7): o "Copy as anzol wait-for" sai da `search` e vai para a linha do cabeçalho
// da lista; o botão e a confirmação são procurados na `region "Request list"`.
function confirmacao(page: Page): Locator {
  return lista(page)
    .getByRole('status')
    .filter({ hasText: /^Copied/ });
}

async function copiarWaitFor(page: Page): Promise<string> {
  await lista(page)
    .getByRole('button', { name: /^Copy as (webhook|anzol) wait-for$/ })
    .click();
  await expect(confirmacao(page)).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('Dado o split entre a lista e o detalhe', () => {
  test('deve redimensionar a lista pelo teclado e lembrar a largura Quando a página recarrega', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { data: 'um' });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    const divisoria = page.getByRole('separator', { name: 'Resize list and detail' });
    await expect(itens(page)).toHaveCount(1);
    const antes = Number(await divisoria.getAttribute('aria-valuenow'));
    const caixaAntes = await lista(page).boundingBox();

    await divisoria.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    await expect(divisoria).toHaveAttribute('aria-valuenow', String(antes + 32));
    await expect
      .poll(async () => (await lista(page).boundingBox())?.width)
      .toBeGreaterThan((caixaAntes?.width ?? 0) + 16);
    await page.reload();
    await expect(page.getByRole('separator', { name: 'Resize list and detail' })).toHaveAttribute(
      'aria-valuenow',
      String(antes + 32),
    );
  });
});

test.describe('Dado uma mensagem apagada pela lixeira', () => {
  test('deve devolvê-la à lista e não apagar na API Quando "Undo" é clicado', async ({
    page,
    tokens,
  }) => {
    test.setTimeout(45_000);
    const tokenId = await tokens.create();
    const fica = await tokens.send(tokenId, { data: 'fica' });
    await tokens.send(tokenId, { data: 'outra' });
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(2);

    await item(page, fica).hover();
    await page.getByRole('button', { name: `Delete request ${fica}` }).click();
    await expect(itens(page)).toHaveCount(1);
    await expect(page.getByText('Request deleted')).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();

    await expect(item(page, fica)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Requests (2)' })).toBeVisible();
    // Passado o tempo do snackbar, a mensagem continua no servidor.
    await page.waitForTimeout(7_000);
    expect((await tokens.listed(tokenId)).map((r) => r.uuid)).toContain(fica);
  });
});

test.describe('Dado filtros ativos na Inbox (S10, "Copy as webhook wait-for")', () => {
  test('deve copiar o comando com o mesmo match da busca e avisar que o texto fica de fora', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    await tokens.send(tokenId, { method: 'POST', data: '{"id":1}' });
    await tokens.send(tokenId, { method: 'PUT', data: 'x' });
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(2);
    const origem = new URL(page.url()).origin;

    await abrirFiltros(page);
    await filtro(page, 'POST').click();
    const busca2 = searchRequest(page, '"absent"');
    await abrirFiltros(page);
    await filtro(page, 'Signature absent').click();
    const { match } = (await busca2).postDataJSON() as { match: unknown };
    const comando = await copiarWaitFor(page);

    expect(comando).toMatch(/^anzol wait-for /);
    expect(comando).toContain(`--token ${tokenId}`);
    expect(comando).toMatch(new RegExp(`--server '?${origem.replace(/[.]/g, '\\.')}'?`));
    expect(matchDe(comando)).toEqual(match);
    expect(matchDe(comando)).toEqual({ method: ['POST'], signature: 'absent' });
    expect(comando).not.toContain('--read-secret');
    await expect(confirmacao(page)).not.toContainText('The text search is not part of wait-for');

    await campoDeBusca(page).fill('id');

    expect(matchDe(await copiarWaitFor(page))).toEqual({ method: ['POST'], signature: 'absent' });
    await expect(confirmacao(page)).toContainText('The text search is not part of wait-for');
  });

  test('deve levar --read-secret pela variável, nunca o segredo, Quando a URL é protegida', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ read_secret: SEGREDO_DE_LEITURA });
    // A captura não pede o segredo de leitura (item 12).
    await tokens.send(tokenId, { method: 'POST', data: 'x' });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await page.getByLabel('Secret', { exact: true }).fill(SEGREDO_DE_LEITURA);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(itens(page)).toHaveCount(1);

    await abrirFiltros(page);
    await filtro(page, 'POST').click();
    const comando = await copiarWaitFor(page);

    expect(comando).toContain('--read-secret "$WEBHOOK_READ_SECRET"');
    expect(comando).not.toContain(SEGREDO_DE_LEITURA);
    expect(matchDe(comando)).toEqual({ method: ['POST'] });
  });
});

test.describe('Dado uma mensagem assinada pelo Stripe', () => {
  test('deve mostrar o header em partes e levar do cartão de assinatura à aba Headers', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'stripe', secret: SECRET } });
    const body = '{"type":"payment_intent.succeeded"}';
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
    const requestId = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
      data: body,
    });
    await abrirMensagem(page, tokenId, requestId);
    await expect(aba(page, 'Body')).toHaveAttribute('aria-selected', 'true');

    await verificacoes(page).getByText('Signature valid').click();

    await expect(aba(page, 'Headers')).toHaveAttribute('aria-selected', 'true');
    const linha = page
      .getByRole('table', { name: 'Headers' })
      .getByRole('row', { name: /^stripe-signature / });
    await expect(linha.getByText(`t=${t}`, { exact: true })).toBeVisible();
    await expect(linha.getByText(`v1=${v1}`, { exact: true })).toBeVisible();
    await expect(linha).toContainText('Signature valid');
  });
});

test.describe('Dado a Inbox com uma mensagem aberta', () => {
  test('deve focar a busca Quando "/" é teclado fora de um campo', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: 'x' });
    await abrirMensagem(page, tokenId, requestId);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await page.keyboard.press('/');

    await expect(campoDeBusca(page)).toBeFocused();
  });
});

test.describe('Dado a tela estreita, abaixo de 840 px (um painel por vez)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('deve abrir o detalhe pelo link permanente e voltar à lista por "Back to requests"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: 'no celular' });

    await abrirMensagem(page, tokenId, requestId);
    await page.getByRole('button', { name: 'Back to requests' }).click();

    await expect(abrirItem(page, requestId)).toBeVisible();
    await expect(detalhes(page)).toHaveCount(0);
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`Dado a Inbox no tema ${colorScheme} a ${viewport.width}×${viewport.height} (axe, CA-2)`, () => {
      test.use({ colorScheme, viewport });

      test('deve passar no axe sem violação grave na lista e no detalhe (Body e Headers)', async ({
        page,
        tokens,
      }) => {
        const tokenId = await tokens.create({
          signature: { provider: 'github', secret: SECRET },
          schema: { type: 'object', required: ['id'] },
        });
        const requestId = await tokens.send(tokenId, {
          path: '/pedidos?x=1',
          headers: { 'Content-Type': 'application/json' },
          data: '{"nome":"sem id"}',
        });
        await tokens.send(tokenId, { method: 'GET' });
        await seedStorage(page, { formatJsonEnable: 'true' });

        await page.goto(`/#/${tokenId}`);
        await expect(itens(page)).toHaveCount(2);
        await expectSemViolacoesGraves(page, `Inbox, ${colorScheme}, ${viewport.width} px`);

        await abrirItem(page, requestId).click();
        await expect(detalhes(page)).toContainText(requestId);
        await expectSemViolacoesGraves(page, `detalhe Body, ${colorScheme}, ${viewport.width} px`);
        await abrirAba(page, 'Headers');
        await expectSemViolacoesGraves(
          page,
          `detalhe Headers, ${colorScheme}, ${viewport.width} px`,
        );
      });
    });
  }
}
