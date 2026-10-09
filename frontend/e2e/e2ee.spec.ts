import { generateKeyPairSync } from 'node:crypto';
import { APIRequestContext, Locator, Page } from '@playwright/test';
import { abrirChecks, salvar } from './support/checks';
import { envelopeCifrado, politica, signatario } from './support/e2ee';
import { expect, test } from './support/fixtures';
import { abrirItem, detalhes, verificacoes } from './support/inbox';
import { abrirRegras, condicao, novaRegra, parte, salvarRegra } from './support/regras';
import { seedStorage } from './support/storage';

// Decifra de atributo (plano e2ee-lab, R5): o cartão "E2EE decryption" de Checks (política e chaves), o cartão da
// decifra e a aba "Decrypted" no detalhe, e a condição "Decryption" no editor de regras. A decifra exige segredo de
// leitura na URL, então toda URL daqui nasce protegida.

const SEGREDO = 'segredo-do-e2e';
const COM_SEGREDO = { 'X-Anzol-Secret': SEGREDO };

/** Destranca a URL no navegador (cookie de acesso, como a tela de desbloqueio faz). */
async function destrancar(page: Page, tokenId: string): Promise<void> {
  await seedStorage(page, { hideTutorial: 'true' });
  const resposta = await page.request.post(`/token/${tokenId}/unlock`, {
    data: { secret: SEGREDO },
  });
  expect(resposta.ok()).toBe(true);
}

async function lerUrl(api: APIRequestContext, tokenId: string) {
  const resposta = await api.get(`/token/${tokenId}`, { headers: COM_SEGREDO });
  expect(resposta.status()).toBe(200);
  return (await resposta.json()) as Record<string, unknown>;
}

/** Gera uma chave de cifra pela API e devolve a JWK pública. */
async function gerarChave(api: APIRequestContext, tokenId: string, kid: string) {
  const resposta = await api.post(`/token/${tokenId}/keys`, {
    headers: COM_SEGREDO,
    data: { kid },
  });
  expect(resposta.status()).toBe(201);
  return ((await resposta.json()) as { jwk: Record<string, unknown> }).jwk;
}

const chaves = (cartao: Locator) =>
  cartao.getByRole('region', { name: 'Encryption keys' }).getByRole('listitem');

test.describe('Dado o cartão "E2EE decryption" de Checks', () => {
  test('deve salvar a política pela tela, gerar e apagar chaves e manter a política ao salvar outro cartão', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ read_secret: SEGREDO });
    const remetente = signatario('sig-e2e');
    await destrancar(page, tokenId);
    const cartao = await abrirChecks(page, tokenId, 'E2EE decryption');

    await cartao.getByRole('switch', { name: 'Decrypt an attribute of each request' }).click();
    await expect(cartao.getByText(/^To save, fill in: Encrypted attribute/)).toBeVisible();
    await cartao.getByRole('textbox', { name: 'Encrypted attribute' }).fill('$.payload');
    await cartao.getByRole('textbox', { name: 'Audience (aud)' }).fill('anzol-lab');
    await cartao.getByRole('textbox', { name: 'jti', exact: true }).fill('$.eventId');
    await cartao.getByRole('textbox', { name: 'evt', exact: true }).fill('$.tipoEvento.nome');
    await cartao.getByRole('textbox', { name: 'app', exact: true }).fill('$.servico.nome');
    await cartao.getByRole('checkbox', { name: 'Ignore case in app' }).check();
    await cartao
      .getByRole('textbox', { name: 'Trusted signers' })
      .fill(JSON.stringify([remetente.publica]));
    const enviado = await salvar(page, tokenId);

    expect(enviado['e2ee']).toEqual(politica([remetente.publica]));
    expect((await lerUrl(request, tokenId))['e2ee']).toEqual(politica([remetente.publica]));
    await expect(cartao.getByText('On · $.payload')).toBeVisible();

    // Chaves: gravadas na hora, fora do rascunho.
    await cartao.getByRole('textbox', { name: 'Key ID (kid)' }).fill('enc-e2e-1');
    await cartao.getByRole('button', { name: 'Generate key' }).click();
    await expect(chaves(cartao)).toHaveCount(1);
    await expect(chaves(cartao).first()).toContainText('enc-e2e-1');
    await cartao.getByRole('button', { name: 'Generate key' }).click();
    await expect(chaves(cartao)).toHaveCount(2);
    await expect(chaves(cartao).nth(1)).toContainText(/enc-\d{8}-[0-9a-f]{4}/);
    const gerar = cartao.getByRole('button', { name: 'Generate key' });
    await expect(gerar).toHaveAttribute('aria-disabled', 'true');
    await expect(gerar).toHaveAccessibleDescription(
      'This URL already has 2 keys. Delete the old one before generating another.',
    );

    const jwks = (await (await request.get(`/token/${tokenId}/jwks.json`)).json()) as {
      keys: Record<string, unknown>[];
    };
    expect(jwks.keys.map((key) => key['kid'])).toEqual(['enc-e2e-1', expect.any(String)]);
    expect(jwks.keys.every((key) => !('d' in key))).toBe(true);
    await expect(cartao.getByRole('link', { name: 'Public JWKS' })).toHaveAttribute(
      'href',
      new RegExp(`/token/${tokenId}/jwks\\.json$`),
    );

    await cartao.getByRole('button', { name: 'Copy public key enc-e2e-1' }).click();
    const copiada = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(copiada).toEqual(jwks.keys[0]);

    await cartao.getByRole('button', { name: 'Delete key enc-e2e-1' }).click();
    const confirmar = page.getByRole('dialog', { name: 'Delete key enc-e2e-1?' });
    await confirmar.getByRole('button', { name: 'Delete key' }).click();
    await expect(confirmar).toBeHidden();
    await expect(chaves(cartao)).toHaveCount(1);
    await expect(chaves(cartao).first()).not.toContainText('enc-e2e-1');
    await expect(gerar).not.toHaveAttribute('aria-disabled', 'true');

    // CA-11: salvar outro cartão manda a política salva junto (o PUT troca a configuração inteira).
    await page.getByRole('textbox', { name: 'Default status code' }).fill('202');
    const outro = await salvar(page, tokenId);

    expect(outro['e2ee']).toEqual(politica([remetente.publica]));
    expect(await lerUrl(request, tokenId)).toMatchObject({
      default_status: 202,
      e2ee: politica([remetente.publica]),
    });
  });

  test('deve avisar que falta o segredo de leitura e mostrar a recusa do servidor Quando a URL está aberta', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, { hideTutorial: 'true' });
    const cartao = await abrirChecks(page, tokenId, 'E2EE decryption');

    await cartao.getByRole('switch', { name: 'Decrypt an attribute of each request' }).click();
    await expect(cartao.getByText(/^This URL has no read secret/)).toBeVisible();
    await cartao.getByRole('textbox', { name: 'Encrypted attribute' }).fill('$.payload');
    await cartao.getByRole('textbox', { name: 'Audience (aud)' }).fill('anzol-lab');
    for (const claim of ['jti', 'evt', 'app']) {
      await cartao.getByRole('textbox', { name: claim, exact: true }).fill(`$.${claim}`);
    }
    await cartao
      .getByRole('textbox', { name: 'Trusted signers' })
      .fill(JSON.stringify([signatario('sig-e2e').publica]));
    const put = page.waitForResponse(
      (resposta) =>
        resposta.request().method() === 'PUT' && resposta.url().endsWith(`/token/${tokenId}`),
    );
    await page.getByRole('button', { name: /^Save changes\b/ }).click();

    expect((await put).status()).toBe(422);
    await expect(cartao.getByText(/^The e2ee requires a read secret/)).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Unsaved changes' })
        .getByRole('alert')
        .filter({ hasText: '1 field needs attention: E2EE decryption' }),
    ).toBeVisible();
  });
});

test.describe('Dado uma mensagem com o atributo cifrado', () => {
  test('deve mostrar a decifra válida com o atributo aberto, também na que chega ao vivo, e as que falharam com o motivo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ read_secret: SEGREDO });
    const remetente = signatario('sig-e2e');
    const destino = await gerarChave(request, tokenId, 'enc-e2e');
    const configurada = await request.put(`/token/${tokenId}`, {
      headers: COM_SEGREDO,
      data: { e2ee: politica([remetente.publica]) },
    });
    expect(configurada.status()).toBe(200);
    const antiga = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: envelopeCifrado(signatario('sig-intruso'), destino, 'n-1', { cpf: '000' }),
    });

    await destrancar(page, tokenId);
    const stream = page.waitForResponse((resposta) =>
      resposta.url().endsWith(`/token/${tokenId}/stream`),
    );
    await page.goto(`/#/${tokenId}/${antiga}/1`);
    await expect(detalhes(page)).toContainText(antiga);
    expect((await stream).status()).toBe(200);
    await expect(verificacoes(page)).toContainText(
      /Decryption invalid\s*the JWS kid is not a trusted signer \(signer_unknown\)/,
    );
    await expect(page.getByRole('tab', { name: 'Decrypted' })).toHaveCount(0);

    // Chega pelo SSE, que nunca traz o atributo aberto: a tela busca a mensagem na API.
    const corpo = envelopeCifrado(remetente, destino, 'n-2', {
      cpf: '123.456.789-09',
      nome: 'Ana',
    });
    const viva = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: corpo,
    });
    await abrirItem(page, viva).click();
    await expect(detalhes(page)).toContainText(viva);
    await expect(verificacoes(page)).toContainText(/Decrypted\s*key enc-e2e · signed by sig-e2e/);
    await expect(verificacoes(page)).toContainText('jti: n-2');
    await page.getByRole('tab', { name: 'Decrypted' }).click();
    const aberto = page.getByRole('region', { name: 'Decrypted attribute' });
    await expect(aberto).toContainText('"cpf": "123.456.789-09"');
    await expect(aberto).toContainText('"nome": "Ana"');

    // A reentrega do mesmo jti continua válida e aponta a primeira.
    const repetida = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: corpo,
    });
    await abrirItem(page, repetida).click();
    await expect(verificacoes(page)).toContainText('Decrypted · repeated jti');
    await verificacoes(page)
      .getByRole('link', { name: `First request with this jti: #${viva.slice(0, 8)}` })
      .click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${viva}/1`));

    const outra = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const desconhecida = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: envelopeCifrado(
        remetente,
        { ...outra.publicKey.export({ format: 'jwk' }), kid: 'enc-sumida' },
        'n-3',
        {},
      ),
    });
    await abrirItem(page, desconhecida).click();
    await expect(verificacoes(page)).toContainText(
      /Unknown encryption key\s*The JWE kid enc-sumida is not one of this URL's keys/,
    );
  });

  test('deve dizer em pt-BR o selo e o motivo da decifra inválida, com o código no nome, e abrir a aba "Decifrado" pelo cartão', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ read_secret: SEGREDO });
    const remetente = signatario('sig-e2e');
    const destino = await gerarChave(request, tokenId, 'enc-e2e');
    const configurada = await request.put(`/token/${tokenId}`, {
      headers: COM_SEGREDO,
      data: { e2ee: politica([remetente.publica]) },
    });
    expect(configurada.status()).toBe(200);
    const recusada = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: envelopeCifrado(signatario('sig-intruso'), destino, 'n-1', { cpf: '000' }),
    });
    const decifrada = await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: envelopeCifrado(remetente, destino, 'n-2', { cpf: '123' }),
    });
    await seedStorage(page, { hideTutorial: 'true', language: '"pt-BR"' });
    const destrancada = await page.request.post(`/token/${tokenId}/unlock`, {
      data: { secret: SEGREDO },
    });
    expect(destrancada.ok()).toBe(true);

    await page.goto(`/#/${tokenId}/${recusada}/1`);
    const cartoes = page.getByRole('group', { name: 'Verificações desta requisição' });
    // O `abrirItem` procura a lista pelo nome em inglês.
    const itemDa = (uuid: string) =>
      page.locator('.item').getByRole('button', { name: new RegExp(`#${uuid.substring(0, 5)}`) });
    const item = itemDa(recusada);
    await expect(item).toContainText('Signatário desconhecido');
    await expect(item).toHaveAccessibleName(/Decifra inválida: .*\(signer_unknown\)/);
    await expect(cartoes).toContainText(
      /Decifra inválida\s*o JWS diz ter sido assinado por uma chave de assinatura que não está nos signatários confiáveis desta URL \(signer_unknown\)/,
    );
    await expect(cartoes).toContainText('Signatários confiáveis desta URL: sig-e2e');
    await expect(cartoes).toContainText('Chave de assinatura do remetente: sig-intruso');

    await itemDa(decifrada).click();
    await cartoes.getByRole('button', { name: /^Decifrada/ }).click();
    await expect(page.getByRole('tab', { name: 'Decifrado', selected: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Atributo decifrado' })).toContainText(
      '"cpf": "123"',
    );
  });

  test('deve recusar em pt-BR desligar a decifra e a Privacidade no mesmo salvar, e a URL segue protegida', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ read_secret: SEGREDO });
    const remetente = signatario('sig-e2e');
    const destino = await gerarChave(request, tokenId, 'enc-e2e');
    const configurada = await request.put(`/token/${tokenId}`, {
      headers: COM_SEGREDO,
      data: { e2ee: politica([remetente.publica]) },
    });
    expect(configurada.status()).toBe(200);
    await tokens.send(tokenId, {
      headers: { 'Content-Type': 'application/json' },
      data: envelopeCifrado(remetente, destino, 'n-1', { cpf: '000' }),
    });
    await seedStorage(page, { hideTutorial: 'true', language: '"pt-BR"' });
    const destrancada = await page.request.post(`/token/${tokenId}/unlock`, {
      data: { secret: SEGREDO },
    });
    expect(destrancada.ok()).toBe(true);

    await page.goto(`/#/${tokenId}/checks`);
    const decifra = page.getByRole('region', { name: 'Decifra E2EE' });
    const privacidade = page.getByRole('region', { name: 'Privacidade' });
    await decifra.getByRole('button', { name: 'Desligar' }).click();
    await privacidade.getByRole('switch', { name: 'Exigir um segredo para ver esta URL' }).click();
    await expect(
      privacidade.getByText(/Requisições decifradas guardam o valor decifrado/),
    ).toBeVisible();
    const put = page.waitForResponse(
      (resposta) =>
        resposta.request().method() === 'PUT' && resposta.url().endsWith(`/token/${tokenId}`),
    );
    await page.getByRole('button', { name: /^Salvar alterações\b/ }).click();

    expect((await put).status()).toBe(422);
    const recusa =
      'O servidor recusou: há requisições decifradas nesta URL. Apague-as antes de remover o segredo, ou mantenha o segredo.';
    await expect(privacidade.getByText(recusa)).toBeVisible();
    await expect(decifra.getByText(recusa)).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Exigir um segredo para ver esta URL' }),
    ).toBeVisible();
    expect(await lerUrl(request, tokenId)).toMatchObject({ protected: true });
  });
});

test.describe('Dado a condição "Decryption" no editor de regras', () => {
  test('deve gravar match.decryption pela tela', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create({ read_secret: SEGREDO });
    await destrancar(page, tokenId);
    await abrirRegras(page, tokenId);

    const regiao = await novaRegra(page);
    await regiao.getByRole('textbox', { name: 'Name', exact: true }).fill('Chave desconhecida');
    await parte(regiao, 'Match');
    await expect(regiao.getByText('Never matches: this URL does not decrypt.')).toHaveCount(0);
    await condicao(regiao, 'Decryption', 'Unknown key');
    await expect(regiao.getByText('Never matches: this URL does not decrypt.')).toBeVisible();
    await parte(regiao, 'Response');
    await regiao.getByRole('spinbutton', { name: 'Status' }).fill('500');
    await salvarRegra(page, regiao, tokenId);

    const gravadas = (await (
      await request.get(`/token/${tokenId}/rules`, { headers: COM_SEGREDO })
    ).json()) as { name: string; match: Record<string, unknown> }[];
    expect(gravadas).toEqual([
      expect.objectContaining({
        name: 'Chave desconhecida',
        match: expect.objectContaining({ decryption: 'unknown_kid' }),
      }),
    ]);
  });
});
