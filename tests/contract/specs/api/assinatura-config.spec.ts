import {
  CHAVES_MENSAGEM, CHAVES_TOKEN, JSON_ACCEPT, enviarEGuardar, expect, listar, test, type Token,
} from '../../support/contrato.js';
import {
  MOTIVO_DIVERGENTE, assinaturaGithub, assinaturaShopify, expect422Assinatura, expectInvalida, expectValida,
  mascarado, postToken, postTokenRegistrando, putToken,
} from '../../support/assinatura.js';

// Configuração `signature` do token (CA-5) e URL sem configuração (CA-8), plano "assinatura-hmac" §1.
// O segredo nunca volta inteiro: `GET`, `POST` e `PUT` devolvem `"••••"` + os 4 últimos. `PUT` com
// `secret` ausente ou igual ao mascarado mantém o segredo atual (a tela reenvia o mascarado ao salvar
// outro campo). Configuração inválida → 422 com a chave sob `signature` (subcampo livre).

const SEGREDO = 'segredo-do-contrato-XYZ9';
const CORPO = '{"acao":"opened","numero":42}';

function assinado(segredo: string, corpo = CORPO) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinaturaGithub(segredo, corpo) },
    data: Buffer.from(corpo),
  } as const;
}

async function lerToken(request: Parameters<typeof postToken>[0], uuid: string): Promise<{ token: Token; texto: string }> {
  const res = await request.get(`/token/${uuid}`, { headers: JSON_ACCEPT });
  expect(res.status()).toBe(200);
  const texto = await res.text();
  return { token: JSON.parse(texto) as Token, texto };
}

test.describe('configuração da assinatura no token (CA-5)', () => {
  test('POST com signature: GET devolve o provedor e o segredo mascarado; o segredo não aparece em resposta nenhuma', async ({ request, tokens }) => {
    const res = await postToken(request, { signature: { provider: 'github', secret: SEGREDO } });
    expect(res.status()).toBe(201);
    const textoPost = await res.text();
    const criado = JSON.parse(textoPost) as Token;
    tokens.registrar(criado.uuid);
    expect(Object.keys(criado).sort()).toEqual(CHAVES_TOKEN);
    expect(textoPost).not.toContain(SEGREDO);
    expect(criado.signature).toMatchObject({ provider: 'github', secret: mascarado(SEGREDO) });

    const { token, texto } = await lerToken(request, criado.uuid);
    expect(texto).not.toContain(SEGREDO);
    expect(token.signature).toMatchObject({ provider: 'github', secret: mascarado(SEGREDO) });
    expect(token.signature!.secret).toBe('••••XYZ9');

    // A mensagem também não carrega o segredo.
    const { msg } = await enviarEGuardar(request, criado.uuid, '', assinado(SEGREDO));
    expectValida(msg.signature, 'github');
    expect(JSON.stringify(msg)).not.toContain(SEGREDO);
  });

  test('genérico: header, algorithm, encoding e prefix voltam como enviados', async ({ tokens, request }) => {
    const criado = await tokens.criar({
      signature: { provider: 'generic', secret: SEGREDO, header: 'X-Webhook-Hmac', algorithm: 'sha512', encoding: 'base64', prefix: 'hmac=' },
    });
    const { token } = await lerToken(request, criado.uuid);
    expect(token.signature).toMatchObject({
      provider: 'generic', secret: mascarado(SEGREDO), header: 'X-Webhook-Hmac', algorithm: 'sha512', encoding: 'base64', prefix: 'hmac=',
    });
  });

  test('stripe e slack: toleranceSeconds volta como enviado', async ({ tokens, request }) => {
    for (const provider of ['stripe', 'slack']) {
      const criado = await tokens.criar({ signature: { provider, secret: SEGREDO, toleranceSeconds: 600 } });
      const { token } = await lerToken(request, criado.uuid);
      expect(token.signature).toMatchObject({ provider, secret: mascarado(SEGREDO), toleranceSeconds: 600 });
    }
  });

  test('segredo de 256 caracteres é aceito', async ({ tokens, request }) => {
    const longo = 'k'.repeat(252) + 'FIM1';
    const criado = await tokens.criar({ signature: { provider: 'github', secret: longo } });
    expect(criado.signature).toMatchObject({ secret: mascarado(longo) });
    const { msg } = await enviarEGuardar(request, criado.uuid, '', assinado(longo));
    expectValida(msg.signature, 'github');
  });

  test('PUT sem secret mantém o segredo: a assinatura seguinte ainda confere', async ({ request, tokens }) => {
    const criado = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const res = await putToken(request, criado.uuid, { default_status: 202, signature: { provider: 'github' } });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.text()).not.toContain(SEGREDO);
    expect(((await res.json()) as Token).signature).toMatchObject({ provider: 'github', secret: mascarado(SEGREDO) });

    const { res: webhook, msg } = await enviarEGuardar(request, criado.uuid, '', assinado(SEGREDO));
    expect(webhook.status()).toBe(202);
    expectValida(msg.signature, 'github');
  });

  test('PUT com o segredo mascarado (o que a tela reenvia) mantém o segredo, mesmo trocando de provedor', async ({ request, tokens }) => {
    const criado = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const res = await putToken(request, criado.uuid, { signature: { provider: 'shopify', secret: criado.signature!.secret } });
    expect(res.status(), await res.text()).toBe(200);
    const { token } = await lerToken(request, criado.uuid);
    expect(token.signature).toMatchObject({ provider: 'shopify', secret: mascarado(SEGREDO) });

    const { msg } = await enviarEGuardar(request, criado.uuid, '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': assinaturaShopify(SEGREDO, CORPO) },
      data: Buffer.from(CORPO),
    });
    expectValida(msg.signature, 'shopify');
  });

  test('PUT com segredo novo troca: o novo confere e o antigo dá signature mismatch', async ({ request, tokens }) => {
    const criado = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const novo = 'segredo-novo-ABCD';
    const res = await putToken(request, criado.uuid, { signature: { provider: 'github', secret: novo } });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.text()).not.toContain(novo);
    const { token } = await lerToken(request, criado.uuid);
    expect(token.signature).toMatchObject({ provider: 'github', secret: mascarado(novo) });

    expectValida((await enviarEGuardar(request, criado.uuid, '', assinado(novo))).msg.signature, 'github');
    expectInvalida((await enviarEGuardar(request, criado.uuid, '', assinado(SEGREDO))).msg.signature, 'github', MOTIVO_DIVERGENTE);
  });

  test('PUT com signature null e PUT sem o campo removem a verificação (como os outros campos do PUT)', async ({ request, tokens }) => {
    const criado = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    expect((await putToken(request, criado.uuid, { signature: null })).status()).toBe(200);
    expect((await lerToken(request, criado.uuid)).token.signature).toBeNull();
    expect((await enviarEGuardar(request, criado.uuid, '', assinado(SEGREDO))).msg.signature).toBeNull();

    expect((await putToken(request, criado.uuid, { signature: { provider: 'github', secret: SEGREDO } })).status()).toBe(200);
    expect((await lerToken(request, criado.uuid)).token.signature).not.toBeNull();
    expect((await putToken(request, criado.uuid, { default_content: 'x' })).status()).toBe(200);
    expect((await lerToken(request, criado.uuid)).token.signature).toBeNull();
  });

  const INVALIDAS: Array<[string, unknown]> = [
    ['provedor desconhecido', { provider: 'paypal', secret: SEGREDO }],
    ['sem provedor', { secret: SEGREDO }],
    ['generic sem header', { provider: 'generic', secret: SEGREDO }],
    ['algoritmo inválido', { provider: 'generic', secret: SEGREDO, header: 'X-Sig', algorithm: 'md5' }],
    ['encoding inválido', { provider: 'generic', secret: SEGREDO, header: 'X-Sig', encoding: 'base32' }],
    ['segredo vazio', { provider: 'github', secret: '' }],
    ['segredo ausente na criação', { provider: 'github' }],
    ['segredo com 257 caracteres', { provider: 'github', secret: 'k'.repeat(257) }],
    ['signature que não é objeto', 'github'],
  ];

  for (const [nome, signature] of INVALIDAS) {
    test(`422 no POST: ${nome}`, async ({ request, tokens }) => {
      const { res, corpo } = await postTokenRegistrando(request, tokens, { signature });
      expect422Assinatura(res, corpo);
      expect(JSON.stringify(corpo)).not.toContain(SEGREDO);
    });
  }

  test('422 no PUT não mexe na configuração salva', async ({ request, tokens }) => {
    const criado = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    for (const [, signature] of INVALIDAS.filter(([n]) => n !== 'segredo vazio' && n !== 'segredo ausente na criação')) {
      const res = await putToken(request, criado.uuid, { signature });
      expect422Assinatura(res, (await res.json().catch(() => ({}))) as Record<string, unknown>);
    }
    const { token } = await lerToken(request, criado.uuid);
    expect(token.signature).toMatchObject({ provider: 'github', secret: mascarado(SEGREDO) });
    expectValida((await enviarEGuardar(request, criado.uuid, '', assinado(SEGREDO))).msg.signature, 'github');
  });
});

test.describe('URL sem configuração (CA-8)', () => {
  test('token com signature null; mensagem com signature null mesmo trazendo header de assinatura; resposta como hoje', async ({ request, tokens }) => {
    const criado = await tokens.criar({ default_status: 201, default_content: 'feito', default_content_type: 'text/plain' });
    expect(Object.keys(criado).sort()).toEqual(CHAVES_TOKEN);
    expect(criado).toHaveProperty('signature', null);
    expect((await lerToken(request, criado.uuid)).token).toHaveProperty('signature', null);

    const { res, msg } = await enviarEGuardar(request, criado.uuid, '/x', assinado(SEGREDO));
    expect(res.status()).toBe(201);
    expect(await res.text()).toBe('feito');
    // Corpo JSON: sem `request`.
    expect(Object.keys(msg).sort()).toEqual(CHAVES_MENSAGEM);
    expect(msg).toHaveProperty('signature', null);
    expect(msg.content).toBe(CORPO);
    expect(msg.headers['x-hub-signature-256']).toEqual([assinaturaGithub(SEGREDO, CORPO)]);

    const { data } = await listar(request, criado.uuid);
    expect(data[0]).toHaveProperty('signature', null);

    // Sem corpo e sem header: idem.
    const { msg: vazia } = await enviarEGuardar(request, criado.uuid, '', { method: 'GET' });
    expect(Object.keys(vazia).sort()).toEqual(CHAVES_MENSAGEM);
    expect(vazia).toHaveProperty('signature', null);
  });
});
