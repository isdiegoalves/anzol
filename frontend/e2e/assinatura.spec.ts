import { createHmac } from 'node:crypto';
import { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  abrirChecks,
  escolherProvedor,
  pendente,
  pendenteAlerta,
  resumo,
  salvar,
  secao,
  botaoSalvar,
} from './support/checks';
import { Webhook, expect, test } from './support/fixtures';
import { abrirAba, abrirItem, abrirMensagem, item, porque, verificacoes } from './support/inbox';
import { abrirRegras, condicao, novaRegra, parte, salvarRegra } from './support/regras';

// Verificação de assinatura HMAC (CA-7, o que é da tela): configurar pela tela, selo na
// mensagem e condição "Signature" no editor de regras. Precisa do backend com `signature` no
// token, na mensagem e em `match.signature`. Item 13.1: selo na lista, linha do header realçada,
// quadro dos provedores com a anatomia e o Edit que diz o que falta.
// Item 14 (D7, CA-5): o leiaute novo mantém o que este spec cobra. E4: o selo da lista é o `app-check-chip` do
// item (fidelidade ao C, fase 2, INBOX-13: "GitHub", "Mismatch", "No signature"; o nome acessível do item diz
// "Signature …"); o selo do detalhe
// vira o cartão no `group "Checks on this request"` (título e, na linha seguinte, o provedor ou o motivo do
// servidor); a tabela Headers fica na aba "Headers (n)" e a linha realçada leva a frase do veredito (a classe
// `signature valid|invalid|absent` de hoje sai: o tom vem por ícone e texto).

const SCREENS = process.env['SCREENS_DIR'];
const SECRET = 'segredo-do-e2e';
/** Como o servidor mostra o segredo salvo: `••••` e os 4 últimos. */
const MASKED = '••••-e2e';
const BODY = '{"action":"opened","number":42}';

async function screenshot(page: Page, name: string) {
  if (SCREENS) {
    await page.screenshot({ path: `${SCREENS}/${name}.png`, animations: 'disabled' });
  }
}

/** Webhook como o GitHub manda: `X-Hub-Signature-256: sha256=<hex>` do corpo cru. */
function github(secret: string | null, body = BODY): Webhook {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) {
    headers['X-Hub-Signature-256'] =
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }
  return { headers, data: body };
}

/** Webhook assinado como o genérico `X-Signature: sha256=<hex>` configurado no teste. */
function generic(secret: string, body = BODY): Webhook {
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return { headers: { 'X-Signature': `sha256=${signature}` }, data: body };
}

/** A linha da tabela Headers de um header (a sintética "(not received)" também). */
function headerRow(page: Page, name: string): Locator {
  return page
    .getByRole('table', { name: 'Headers' })
    .getByRole('row', { name: new RegExp(`^${name} `) });
}

/** A aba "Headers (n)" do detalhe, onde fica a tabela. */
async function openHeaders(page: Page) {
  await abrirAba(page, 'Headers');
}

/**
 * Item 14, E5: a seção sai do diálogo "Edit URL" e vira o cartão `region "Signature verification"` de Checks, com
 * o Save "Save signature" (S12: nunca desabilitado; o resumo do que falta à vista desde o início). SUPOSIÇÕES em
 * `support/checks.ts`; a linha "Expected header: …" (a anatomia) continua com o texto de hoje.
 */
async function openEditUrl(page: Page, tokenId: string): Promise<Locator> {
  return abrirChecks(page, tokenId, 'Signature verification');
}

/** Clica em "Save signature" e devolve o corpo do `PUT /token/{id}`. */
async function submitEdit(page: Page, dialog: Locator, tokenId: string) {
  return salvar(page, tokenId);
}

/** A linha "Expected header: …" (a anatomia do header do provedor escolhido). */
function anatomy(dialog: Locator): Locator {
  return dialog.getByText(/^Expected header:/);
}

/** A tabela de provedores, que é também o seletor. */
function providerRadios(dialog: Locator): Locator {
  return dialog.getByRole('radiogroup', { name: 'Signature provider' }).getByRole('radio');
}

/** O provedor escolhido (o radio marcado). */
function checkedProvider(dialog: Locator): Locator {
  return dialog
    .getByRole('radiogroup', { name: 'Signature provider' })
    .getByRole('radio', { checked: true });
}

async function openRequest(page: Page, tokenId: string, requestId: string) {
  await abrirMensagem(page, tokenId, requestId);
}

async function getRules(api: APIRequestContext, tokenId: string) {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as Record<string, unknown>[];
}

test.describe('Dado o cartão "Signature verification" de Checks', () => {
  test('deve verificar com o GitHub configurado pela tela e marcar as mensagens assinada certa, errada e sem assinatura', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await openEditUrl(page, tokenId);

    const providers = providerRadios(dialog);
    await expect(providers).toHaveCount(6);
    await expect(checkedProvider(dialog)).toHaveAccessibleName(/^None\b/);
    await escolherProvedor(dialog, 'GitHub');
    // Fidelidade ao C, fase 2 (CHECKS-09): formato do header, fórmula e segredo curto do protótipo.
    await expect(checkedProvider(dialog)).toHaveText(
      /^\s*GitHub\s*X-Hub-Signature-256: sha256=<hex>\s*HMAC-SHA256\(secret, raw body\) → hex\s*The webhook Secret field\s*$/,
    );
    await expect(anatomy(dialog)).toHaveText(
      'Expected header: X-Hub-Signature-256: sha256=<hex of HMAC-SHA256(body)>',
    );
    await dialog.getByLabel('HMAC secret', { exact: true }).fill(SECRET);
    await expect(dialog.getByLabel('HMAC secret', { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
    await dialog.getByRole('radiogroup', { name: 'Signature provider' }).scrollIntoViewIfNeeded();
    await screenshot(page, '01-edit-url-github');
    const put = await submitEdit(page, dialog, tokenId);

    expect(put['signature']).toEqual({ provider: 'github', secret: SECRET });
    expect(await tokens.read(tokenId)).toMatchObject({
      signature: { provider: 'github', secret: MASKED },
    });

    const certa = await tokens.send(tokenId, github(SECRET));
    const errada = await tokens.send(tokenId, github('outro-segredo'));
    const semAssinatura = await tokens.send(tokenId, github(null));

    await openRequest(page, tokenId, certa);
    await expect(verificacoes(page)).toContainText(/Signature valid\s*GitHub/);
    await expect(abrirItem(page, certa)).toHaveAccessibleName(/\bSignature valid: GitHub\b/);
    // O selo da assinatura que passou é só o ícone; o provedor fica no title.
    await expect(
      item(page, certa).locator('app-check-chip[data-kind="signature"]'),
    ).toHaveAttribute('title', 'Signature valid: GitHub');
    await expect(abrirItem(page, errada)).toHaveAccessibleName(
      /\bSignature invalid: the HMAC did not match \(signature mismatch\)/,
    );
    await expect(item(page, errada)).toContainText('Mismatch');
    await expect(abrirItem(page, semAssinatura)).toHaveAccessibleName(
      /\bSignature absent: header X-Hub-Signature-256 absent\b/,
    );
    await expect(item(page, semAssinatura)).toContainText('No signature');
    await openHeaders(page);
    const valida = headerRow(page, 'x-hub-signature-256');
    await expect(valida).toContainText('Signature valid — HMAC-SHA256 of the raw body matched');
    await expect(
      page
        .getByRole('table', { name: 'Headers' })
        .getByRole('row')
        .filter({ hasText: 'Signature ' }),
    ).toHaveCount(1);
    await screenshot(page, '02-selo-valida');
    await openRequest(page, tokenId, errada);
    await expect(verificacoes(page)).toContainText(
      /Signature invalid\s*the HMAC did not match \(signature mismatch\)/,
    );
    await openHeaders(page);
    await expect(headerRow(page, 'x-hub-signature-256')).toContainText(
      'Signature invalid — HMAC-SHA256 of the raw body did not match (signature mismatch): different secret on each side, or the body was altered on the way.',
    );
    await screenshot(page, '03-selo-invalida');
    await openRequest(page, tokenId, semAssinatura);
    await expect(verificacoes(page)).toContainText(
      /Signature absent\s*header X-Hub-Signature-256 absent/,
    );
    await openHeaders(page);
    const ausente = page.getByRole('table', { name: 'Headers' }).locator('tbody tr').first();
    // Fidelidade ao C, fase 2 (INBOX-24): a nota ganha o título "Expected header missing" e o link para Checks.
    await expect(ausente).toContainText(/^\s*x-hub-signature-256\s*\(not received\)/);
    await expect(ausente).toContainText(
      'Signature absent — the GitHub check expects the X-Hub-Signature-256 header',
    );
    await screenshot(page, '03b-header-ausente');
  });

  test('deve mostrar o segredo mascarado e mantê-lo Quando a URL é editada sem mexer nele', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const dialog = await openEditUrl(page, tokenId);

    await expect(checkedProvider(dialog)).toHaveAccessibleName(/^GitHub\b/);
    await expect(dialog.getByLabel('HMAC secret', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('HMAC secret', { exact: true })).toHaveAttribute(
      'placeholder',
      MASKED,
    );
    await dialog.getByText('Leave blank to keep the current secret').scrollIntoViewIfNeeded();
    await expect(dialog.getByText('Leave blank to keep the current secret')).toBeVisible();
    await screenshot(page, '04-edit-url-segredo-mascarado');
    // Editar a URL sem mexer no segredo: agora pelo cartão Response (o PUT leva a assinatura salva, CA-11).
    const resposta = secao(page, 'Response');
    await resposta.getByRole('textbox', { name: 'Default status code' }).fill('202');
    const put = await salvar(page, tokenId);

    // O mascarado volta como veio: o servidor mantém o segredo, que não sai da tela.
    expect(put['signature']).toEqual({ provider: 'github', secret: MASKED });
    const requestId = await tokens.send(tokenId, github(SECRET));
    await openRequest(page, tokenId, requestId);
    await expect(verificacoes(page)).toContainText(/Signature valid\s*GitHub/);
  });

  test('não deve mostrar selo nem realce de assinatura Quando a URL não verifica', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, github(SECRET));

    await openRequest(page, tokenId, requestId);

    await expect(verificacoes(page)).not.toContainText(/Signature (valid|invalid|absent)/);
    await expect(abrirItem(page, requestId)).toBeVisible();
    await expect(abrirItem(page, requestId)).not.toHaveAccessibleName(
      /signature (valid|invalid|absent)/i,
    );
    await expect(item(page, requestId)).not.toContainText(/GitHub|Mismatch|No signature/);
    await openHeaders(page);
    await expect(headerRow(page, 'x-hub-signature-256')).not.toContainText('Signature ');
  });

  test('deve dizer o que falta, focar o primeiro campo e salvar o genérico Quando "Save signature" é clicado com os obrigatórios vazios', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await openEditUrl(page, tokenId);
    const puts: string[] = [];
    page.on('request', (sent) => {
      if (sent.method() === 'PUT' && sent.url().endsWith(`/token/${tokenId}`)) {
        puts.push(sent.url());
      }
    });

    await escolherProvedor(dialog, 'Generic');
    const header = dialog.getByRole('textbox', { name: 'Signature header' });
    const secret = dialog.getByLabel('HMAC secret', { exact: true });
    const save = botaoSalvar(page);
    await expect(header).toHaveAttribute('required', '');
    await expect(secret).toHaveAttribute('required', '');
    await expect(dialog.getByRole('textbox', { name: 'Prefix' })).not.toHaveAttribute('required');
    await expect(save).toBeEnabled();
    // S12: o que falta fica à vista desde o início, em `status` (hoje só aparecia depois do clique).
    await expect(pendente(dialog)).toHaveText('To save, fill in: Signature header, HMAC secret');
    await expect(pendenteAlerta(dialog)).toHaveCount(0);
    await header.scrollIntoViewIfNeeded();
    await screenshot(page, '08-generico-obrigatorios');

    await save.click();

    // Fidelidade ao C, fase 2 (CHECKS-13): depois do clique, o alerta conta os campos.
    await expect(pendenteAlerta(dialog)).toHaveText(
      '2 fields need attention: Signature header, HMAC secret',
    );
    await expect(header).toBeFocused();
    await expect(dialog.getByText('The header is required.')).toBeVisible();
    await expect(dialog.getByText('The secret is required, up to 256 characters.')).toBeVisible();
    expect(puts).toEqual([]);
    await screenshot(page, '09-generico-o-que-falta');

    await header.fill('X-Signature');
    await expect(resumo(dialog)).toHaveText('1 field needs attention: HMAC secret');
    await dialog.getByRole('textbox', { name: 'Prefix' }).fill('sha256=');
    await expect(anatomy(dialog)).toHaveText(
      'Expected header: X-Signature: sha256=<hex of HMAC-SHA256(body)>',
    );
    await secret.fill(SECRET);
    await expect(resumo(dialog)).toHaveCount(0);
    const put = await submitEdit(page, dialog, tokenId);

    expect(put['signature']).toEqual({
      provider: 'generic',
      secret: SECRET,
      header: 'X-Signature',
      algorithm: 'sha256',
      encoding: 'hex',
      prefix: 'sha256=',
    });
    const requestId = await tokens.send(tokenId, generic(SECRET));
    await openRequest(page, tokenId, requestId);
    await openHeaders(page);
    await expect(headerRow(page, 'x-signature')).toContainText(
      'Signature valid — HMAC-SHA256 of the raw body matched',
    );
  });

  test('deve exigir segredo novo, com aviso, Quando o provedor muda numa URL com segredo salvo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const dialog = await openEditUrl(page, tokenId);

    await escolherProvedor(dialog, 'Shopify');

    // Fidelidade ao C, fase 2 (CHECKS-10): o aviso ganha "Unsaved: switching from … Requests already received keep
    // the result they got on arrival." e mantém a instrução (S11).
    await expect(dialog.getByRole('status').filter({ hasText: 'is not reused' })).toContainText(
      'The saved GitHub secret is not reused for Shopify: paste the Shopify secret.',
    );
    await expect(dialog.getByLabel('HMAC secret', { exact: true })).toHaveAttribute('required', '');
    await expect(dialog.getByLabel('HMAC secret', { exact: true })).not.toHaveAttribute(
      'placeholder',
      MASKED,
    );
    await botaoSalvar(page).click();
    await expect(pendenteAlerta(dialog)).toHaveText('1 field needs attention: HMAC secret');
    await expect(dialog.getByLabel('HMAC secret', { exact: true })).toBeFocused();
    await screenshot(page, '10-troca-de-provedor');
    await dialog.getByLabel('HMAC secret', { exact: true }).fill('shpss_novo');
    const put = await submitEdit(page, dialog, tokenId);

    expect(put['signature']).toEqual({ provider: 'shopify', secret: 'shpss_novo' });
    expect(await tokens.read(tokenId)).toMatchObject({
      signature: { provider: 'shopify', secret: '••••novo' },
    });
  });
});

test.describe('Dado a condição "Signature" no editor de regras', () => {
  test('deve responder 401 à assinatura inválida com a regra criada pela tela e explicar o near miss da válida', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    // Item 14, E6: o editor é a `region "New rule"` com as abas Match e Response (`support/regras.ts`).
    await abrirRegras(page, tokenId);

    const dialog = await novaRegra(page);
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Recusa assinatura');
    await parte(dialog, 'Match');
    // Fidelidade ao C (item 14.1, RULES-17): Signature vira segmentado (`radiogroup "Signature"`).
    await condicao(dialog, 'Signature', 'Invalid');
    await dialog.getByRole('button', { name: 'Add body condition' }).scrollIntoViewIfNeeded();
    await screenshot(page, '05-editor-condicao-signature');
    await parte(dialog, 'Response');
    await dialog.getByRole('spinbutton', { name: 'Status' }).fill('401');
    await dialog.getByRole('textbox', { name: 'Response body' }).fill('{"error":"bad signature"}');
    await salvarRegra(page, dialog, tokenId);

    expect(await getRules(request, tokenId)).toEqual([
      expect.objectContaining({
        name: 'Recusa assinatura',
        match: expect.objectContaining({ signature: 'invalid' }),
      }),
    ]);

    const errada = await request.post(`/${tokenId}`, github('outro-segredo'));
    expect(errada.status()).toBe(401);
    const certa = await request.post(`/${tokenId}`, github(SECRET));
    expect(certa.status()).toBe(200);

    await openRequest(page, tokenId, errada.headers()['x-request-id']);
    await expect(verificacoes(page)).toContainText(
      /Signature invalid\s*the HMAC did not match \(signature mismatch\)/,
    );
    // Fidelidade ao C, fase 2 (INBOX-18): o cartão da regra diz o status.
    await expect(verificacoes(page)).toContainText(/Answered 401 · by rule\s*Recusa assinatura/);
    await screenshot(page, '06-selo-invalida-com-regra-401');

    await openRequest(page, tokenId, certa.headers()['x-request-id']);
    await expect(verificacoes(page)).toContainText(/Signature valid\s*GitHub/);
    // INBOX-18: com uma condição só, a frase fica no cartão e o "Why? (n)" não aparece.
    await expect(verificacoes(page)).toContainText(
      /No rule matched\. The closest is “Recusa assinatura” — expects the signature to be invalid; this one is valid \(signature: expected invalid, got valid\)/,
    );
    await expect(porque(page)).toHaveCount(0);
    await screenshot(page, '07-selo-valida-near-miss');
  });
});
