import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import {
  abrirChecks,
  escolherProvedor,
  pendente,
  pendenteAlerta,
  botaoSalvar,
} from './support/checks';
import { Webhook, expect, test } from './support/fixtures';

// Patamar, B3 (guia-combinacao §3.3 e §7; CA-6): os quatro botões Save dos cartões somem; salvar é o `button "Save
// changes"` da `region "Unsaved changes"`, que só aparece com alteração pendente e grava tudo num PUT só.

// Item 14.1, fase 2, fatia F2-2 (fidelidade ao protótipo C): os itens "discutir" de Checks e Outbound que o dono
// decidiu adotar (`.docs-arquivo/fidelidade-prototipo/discutir-decididos.json`), com o ajuste do `porque` nos
// "adotar-adaptado". Tipografia, cor, ícones e espaçamento (CHECKS-04/05/08, o painel tonal do CHECKS-07/16, o
// percentual e a barra do CHECKS-18, o check do segmentado do OUTBOUND-04) ficam para a regressão visual.
// SUPOSIÇÕES (os textos do protótipo C quando ele os tem; os demais marcados aqui):
// - CHECKS-07: o passo 3 diz "…compared in constant time…";
// - CHECKS-09: cada linha da tabela de provedores tem o formato do header ("Stripe-Signature: t=…,v1=<hex>"), a
//   fórmula ('HMAC-SHA256(secret, "{t}.{raw body}") → hex') e o segredo curto ("Endpoint signing secret (whsec_…)")
//   do protótipo;
// - CHECKS-10: ao trocar de provedor, o `status` diz "Unsaved: switching from {Salvo} (saved) to {Novo}. Requests
//   already received keep the result they got on arrival." e continua com a instrução de colar o segredo (S11);
// - CHECKS-13: antes do Save, o `status` "To save, fill in: …"; depois, o `alert` "N field(s) need(s) attention:
//   …"; sem nada faltando numa assinatura salva, o `status` "Saved. Leave the secret blank to keep it.";
// - CHECKS-14: o chip do schema diz "On · 2020-12" com o `$schema` 2020-12 e "On" sem `$schema`;
// - CHECKS-16: o seletor do "Generate from a message" é o `combobox "Request"`, e a opção traz o `type` do JSON
//   ("#xxxxx pedido.criado");
// - CHECKS-18: a janela do Health vira o `combobox "Window"` ao lado do título, com "Last 50", "Last 200" e "Last
//   500"; o Refresh vira botão de ícone com o nome "Refresh";
// - CHECKS-21: "Default status code" e "Content Type" na mesma linha; "Timeout before response" vira `slider` de 0 a
//   10;
// - OUTBOUND-02/12: o h1 "Outbound" fica no cartão do histórico, com "last 50 sent by the server" fora do heading e o
//   botão de ícone "Refresh history"; a descrição é "Replays of received requests and new sends, newest first. 30
//   sends per minute per URL.";
// - OUTBOUND-04: o h2 visível "New request" sobre o compositor; as regiões continuam "Replay request" e "Send
//   request";
// - OUTBOUND-06: o aviso de assinatura velha mostra o `t=` lido;
// - OUTBOUND-10: o erro de destino bloqueado não repete "blocked:" e diz "The sent headers are below.";
// - OUTBOUND-11: o "Forward from this browser (legacy)" indica o `anzol listen` como alternativa.

const SECRET = 'segredo-da-fidelidade-f2-2';
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

function stripe(t: number, body = '{"type":"x"}'): Webhook {
  const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  return {
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
    data: body,
  };
}

async function mesmaLinha(a: Locator, b: Locator): Promise<boolean> {
  const [ca, cb] = [await a.boundingBox(), await b.boundingBox()];
  return !!ca && !!cb && Math.abs(ca.y - cb.y) <= 8;
}

function provedor(regiao: Locator, nome: string): Locator {
  return regiao
    .getByRole('radiogroup', { name: 'Signature provider' })
    .getByRole('radio', { name: new RegExp(`^${nome}\\b`) });
}

test.describe('Dado o cartão Signature verification (CHECKS-07/09/10/13)', () => {
  test('deve explicar a comparação em tempo constante e mostrar o formato do header e a fórmula de cada provedor', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');

    await expect(assinatura).toContainText('compared in constant time');
    const linhaStripe = provedor(assinatura, 'Stripe');
    await expect(linhaStripe).toContainText('Stripe-Signature: t=…,v1=<hex>');
    await expect(linhaStripe).toContainText('HMAC-SHA256(secret, "{t}.{raw body}") → hex');
    await expect(linhaStripe).toContainText('Endpoint signing secret (whsec_…)');
    await expect(provedor(assinatura, 'GitHub')).toContainText('X-Hub-Signature-256: sha256=<hex>');
    await expect(provedor(assinatura, 'GitHub')).toContainText(
      'HMAC-SHA256(secret, raw body) → hex',
    );
  });

  test('deve dizer que as mensagens recebidas mantêm o resultado Quando o provedor muda', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
    await expect(assinatura.getByRole('status').filter({ hasText: /^Saved\./ })).toHaveText(
      'Saved. Leave the secret blank to keep it.',
    );

    await escolherProvedor(assinatura, 'Shopify');
    const aviso = assinatura.getByRole('status').filter({ hasText: 'switching from' });
    await expect(aviso).toContainText('Unsaved: switching from GitHub (saved) to Shopify.');
    await expect(aviso).toContainText(
      'Requests already received keep the result they got on arrival.',
    );
    await expect(aviso).toContainText('paste the Shopify secret');
  });

  test('deve contar os campos que faltam no alerta depois do Save', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    const assinatura = await abrirChecks(page, tokenId, 'Signature verification');
    await escolherProvedor(assinatura, 'Generic');

    await expect(pendente(assinatura)).toHaveText('To save, fill in: Signature header, Secret');
    await botaoSalvar(page).click();
    await expect(pendenteAlerta(assinatura)).toHaveText(
      '2 fields need attention: Signature header, Secret',
    );
    await assinatura.getByRole('textbox', { name: 'Signature header' }).fill('X-Signature');
    await expect(pendenteAlerta(assinatura)).toHaveText('1 field needs attention: Secret');
  });
});

test.describe('Dado o cartão Schema validation (CHECKS-14/16)', () => {
  test('deve dizer o dialeto no chip e mostrar o tipo do evento na opção do gerador', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ schema: { $schema: DRAFT, type: 'object' } });
    const exemplo = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"type":"pedido.criado","id":1}',
    });
    const schema = await abrirChecks(page, tokenId, 'Schema validation');

    await expect(schema.getByText('On · 2020-12', { exact: true })).toBeVisible();
    await schema.getByRole('combobox', { name: 'Request', exact: true }).click();
    await expect(
      page.getByRole('option', { name: new RegExp(`#${exemplo.substring(0, 5)} pedido\\.criado`) }),
    ).toBeVisible();
  });

  test('deve dizer só "On" Quando o schema não tem $schema', async ({ page, tokens }) => {
    const tokenId = await tokens.create({ schema: { type: 'object' } });
    const schema = await abrirChecks(page, tokenId, 'Schema validation');
    await expect(schema.getByText('On', { exact: true })).toBeVisible();
    await expect(schema.getByText(/^On · /)).toHaveCount(0);
  });
});

test.describe('Dado os cartões Health e Response (CHECKS-18/21)', () => {
  test('deve ter a janela num seletor ao lado do título e o Refresh como ícone', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    await tokens.send(tokenId, { data: 'x' });
    const health = await abrirChecks(page, tokenId, 'Health');

    const janela = health.getByRole('combobox', { name: 'Window' });
    await expect(janela).toContainText('Last 200');
    expect(await mesmaLinha(janela, health.getByRole('heading', { name: 'Health' }))).toBe(true);
    const cinquenta = page.waitForRequest(
      (r) => r.url().includes(`/token/${tokenId}/stats`) && r.url().includes('window=50'),
    );
    await janela.click();
    await expect(page.getByRole('option')).toHaveText(['Last 50', 'Last 200', 'Last 500']);
    await page.getByRole('option', { name: 'Last 50', exact: true }).click();
    await cinquenta;

    const refresh = health.getByRole('button', { name: 'Refresh', exact: true });
    await expect(refresh).toBeVisible();
    expect(await refresh.evaluate((el) => (el as HTMLElement).innerText.trim())).toBe('');
  });

  test('deve pôr status e content type na mesma linha e o timeout num slider de 0 a 10', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ timeout: '3' });
    const resposta = await abrirChecks(page, tokenId, 'Response');

    expect(
      await mesmaLinha(
        resposta.getByLabel('Default status code'),
        resposta.getByLabel('Content Type'),
      ),
    ).toBe(true);
    const timeout = resposta.getByRole('slider', { name: 'Timeout before response' });
    await expect(timeout).toHaveValue('3');
    await expect(timeout).toHaveAttribute('min', '0');
    await expect(timeout).toHaveAttribute('max', '10');
  });
});

/** O cartão do histórico de Outbound (o que tem a `table "Outbound history"`). */
function historico(page: Page): Locator {
  return page.locator('section', {
    has: page.getByRole('table', { name: 'Outbound history' }),
  });
}

test.describe('Dado a página Outbound (OUTBOUND-02/04/12)', () => {
  test('deve pôr o título e o Refresh no cartão do histórico e o "New request" sobre o compositor', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { data: 'x' });
    await page.goto(`/#/${tokenId}/outbound`);

    const cartao = historico(page).last();
    await expect(
      cartao.getByRole('heading', { level: 1, name: 'Outbound', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(cartao).toContainText('last 50 sent by the server');
    await expect(page.getByRole('heading', { name: /last 50/ })).toHaveCount(0);
    await expect(cartao.getByRole('button', { name: 'Refresh history' })).toBeVisible();
    await expect(
      page.getByText(
        'Replays of received requests and new sends, newest first. 30 sends per minute per URL.',
      ),
    ).toBeVisible();

    await expect(page.getByRole('heading', { level: 2, name: 'New request' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Replay request' })).toBeVisible();
  });
});

test.describe('Dado o compositor e o resultado de Outbound (OUTBOUND-06/10/11)', () => {
  test('deve mostrar o t= lido no aviso de assinatura velha', async ({ page, tokens }) => {
    const tokenId = await tokens.create({ signature: { provider: 'stripe', secret: SECRET } });
    const t = Math.floor(Date.now() / 1000) - 3600;
    const velha = await tokens.send(tokenId, stripe(t));
    await page.goto(`/#/${tokenId}/outbound?replay=${velha}`);

    const replay = page.getByRole('region', { name: 'Replay request' });
    await expect(replay.getByText(/older than the tolerance/)).toBeVisible();
    await expect(replay).toContainText(`t=${t}`);
  });

  test('deve dizer o bloqueio sem repetir "blocked:" e avisar que os headers enviados estão abaixo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: 'x' });
    await page.goto(`/#/${tokenId}/outbound?replay=${requestId}`);
    const replay = page.getByRole('region', { name: 'Replay request' });
    await replay
      .getByRole('textbox', { name: 'Target URL' })
      .fill('http://169.254.169.254/latest/meta-data');
    await replay.getByRole('button', { name: 'Replay', exact: true }).click();

    const erro = page.getByRole('region', { name: 'Outbound detail' }).getByRole('alert');
    await expect(erro).toContainText('Blocked');
    await expect(erro).not.toContainText(/blocked:\s*blocked/i);
    await expect(page.getByRole('region', { name: 'Outbound detail' })).toContainText(
      'Nothing reached the target, so there is no response. The sent headers are below.',
    );
  });

  test('deve indicar o anzol listen no encaminhamento pelo navegador', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}/outbound`);
    await page.getByRole('button', { name: 'Forward from this browser (legacy)' }).click();
    await expect(page.getByText(/Prefer Replay/)).toContainText('anzol listen');
  });
});
