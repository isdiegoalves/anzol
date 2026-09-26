import { enviarEGuardar, expect, httpCru, buscarMensagem, listar, test } from '../../support/contrato.js';
import {
  MOTIVO_DIVERGENTE, MOTIVO_MALFORMADO, agoraEmSegundos, assinaturaGithub, assinaturaShopify, assinaturaStripe,
  cabecalhosSlack, expectForaDaTolerancia, expectInvalida, expectValida, hmac, motivoAusente,
  type Algoritmo, type Codificacao, type ConfigAssinatura, type Provedor,
} from '../../support/assinatura.js';

// Verificação de assinatura HMAC por provedor (CA-1 a CA-4 do plano "assinatura-hmac", §1).
// A URL guarda `signature: {provider, secret, …}`; cada mensagem gravada traz
// `signature: {provider, valid, reason}`, com `reason` null quando válida. A verificação não muda a
// resposta do webhook (sem regras, é a padrão do token). O teste assina com `node:crypto` sobre os
// mesmos bytes que envia; `reason` é casada pelo conteúdo (ver `support/assinatura.ts`).

const SEGREDO = 'whsec_contrato_8f3a1c9e2b7d';
const CORPO = '{"id":"evt_1","tipo":"pagamento","valor":100}';
const CORPO_ALTERADO = '{"id":"evt_1","tipo":"pagamento","valor":999}';

interface CasoProvedor {
  provider: Provedor;
  /** Configuração sem o segredo. */
  config: ConfigAssinatura;
  /** Nome do header de assinatura, como aparece na frase de ausência. */
  cabecalho: string;
  assinar(segredo: string, corpo: Buffer | string): Record<string, string>;
  /** Header presente mas fora do formato do provedor. */
  malformado(): Record<string, string>;
  /** Headers que vão junto quando só o de assinatura falta (Slack: o timestamp). */
  semAssinatura?(): Record<string, string>;
}

const PROVEDORES: CasoProvedor[] = [
  {
    provider: 'stripe',
    config: { provider: 'stripe' },
    cabecalho: 'Stripe-Signature',
    assinar: (s, c) => ({ 'Stripe-Signature': assinaturaStripe(s, c).header }),
    malformado: () => ({ 'Stripe-Signature': 'isto-nao-e-uma-assinatura-stripe' }),
  },
  {
    provider: 'github',
    config: { provider: 'github' },
    cabecalho: 'X-Hub-Signature-256',
    assinar: (s, c) => ({ 'X-Hub-Signature-256': assinaturaGithub(s, c) }),
    // Sem o prefixo `sha256=`.
    malformado: () => ({ 'X-Hub-Signature-256': hmac('sha256', SEGREDO, Buffer.from(CORPO)) }),
  },
  {
    provider: 'shopify',
    config: { provider: 'shopify' },
    cabecalho: 'X-Shopify-Hmac-Sha256',
    assinar: (s, c) => ({ 'X-Shopify-Hmac-Sha256': assinaturaShopify(s, c) }),
    malformado: () => ({ 'X-Shopify-Hmac-Sha256': '%%%not*base64%%%' }),
  },
  {
    provider: 'slack',
    config: { provider: 'slack' },
    cabecalho: 'X-Slack-Signature',
    assinar: (s, c) => cabecalhosSlack(s, c),
    // Sem o prefixo `v0=`.
    malformado: () => ({ 'X-Slack-Signature': 'abc123', 'X-Slack-Request-Timestamp': String(agoraEmSegundos()) }),
    semAssinatura: () => ({ 'X-Slack-Request-Timestamp': String(agoraEmSegundos()) }),
  },
  {
    provider: 'generic',
    // Só o header: algoritmo sha256 e encoding hex por padrão.
    config: { provider: 'generic', header: 'X-Assinatura' },
    cabecalho: 'X-Assinatura',
    assinar: (s, c) => ({ 'X-Assinatura': hmac('sha256', s, Buffer.isBuffer(c) ? c : Buffer.from(c)) }),
    // Encoding hex com caracteres fora de [0-9a-f].
    malformado: () => ({ 'X-Assinatura': 'zz-isto-nao-e-hex' }),
  },
];

function post(corpo: Buffer | string, headers: Record<string, string>, tipo = 'application/json') {
  return {
    method: 'POST',
    headers: { 'Content-Type': tipo, ...headers },
    data: Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo),
  } as const;
}

test.describe('assinatura por provedor (CA-1)', () => {
  for (const p of PROVEDORES) {
    test.describe(p.provider, () => {
      test('assinatura válida → {provider, valid: true, reason: null}, no GET e na listagem; resposta padrão', async ({ request, tokens }) => {
        const token = await tokens.criar({ default_status: 203, default_content: 'padrao', signature: { ...p.config, secret: SEGREDO } });
        const { res, msg } = await enviarEGuardar(request, token.uuid, '/evento', post(CORPO, p.assinar(SEGREDO, CORPO)));
        expect(res.status()).toBe(203);
        expect(await res.text()).toBe('padrao');
        expectValida(msg.signature, p.provider);
        expect(msg.content).toBe(CORPO);

        const { data } = await listar(request, token.uuid);
        expect(data).toHaveLength(1);
        expectValida(data[0].signature, p.provider);
      });

      test('corpo alterado → invalid, signature mismatch; a resposta continua a padrão', async ({ request, tokens }) => {
        const token = await tokens.criar({ default_status: 203, signature: { ...p.config, secret: SEGREDO } });
        const { res, msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO_ALTERADO, p.assinar(SEGREDO, CORPO)));
        expect(res.status()).toBe(203);
        expectInvalida(msg.signature, p.provider, MOTIVO_DIVERGENTE);
      });

      test('segredo errado → invalid, signature mismatch', async ({ request, tokens }) => {
        const token = await tokens.criar({ signature: { ...p.config, secret: SEGREDO } });
        const { msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO, p.assinar('outro-segredo-qualquer', CORPO)));
        expectInvalida(msg.signature, p.provider, MOTIVO_DIVERGENTE);
      });

      test(`header ausente → invalid, "header ${p.cabecalho} absent"`, async ({ request, tokens }) => {
        const token = await tokens.criar({ signature: { ...p.config, secret: SEGREDO } });
        const { res, msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO, p.semAssinatura?.() ?? {}));
        expect(res.status()).toBe(200);
        expectInvalida(msg.signature, p.provider, motivoAusente(p.cabecalho));
      });

      test('header malformado → invalid, malformed header', async ({ request, tokens }) => {
        const token = await tokens.criar({ signature: { ...p.config, secret: SEGREDO } });
        const { msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO, p.malformado()));
        expectInvalida(msg.signature, p.provider, MOTIVO_MALFORMADO);
      });
    });
  }

  test('cada mensagem é verificada por si: válida, inválida e ausente na mesma URL', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const { msg: boa } = await enviarEGuardar(request, token.uuid, '', post(CORPO, { 'X-Hub-Signature-256': assinaturaGithub(SEGREDO, CORPO) }));
    const { msg: ruim } = await enviarEGuardar(request, token.uuid, '', post(CORPO_ALTERADO, { 'X-Hub-Signature-256': assinaturaGithub(SEGREDO, CORPO) }));
    const { msg: sem } = await enviarEGuardar(request, token.uuid, '', post(CORPO, {}));
    expectValida((await buscarMensagem(request, token.uuid, boa.uuid)).signature, 'github');
    expectInvalida((await buscarMensagem(request, token.uuid, ruim.uuid)).signature, 'github', MOTIVO_DIVERGENTE);
    expectInvalida((await buscarMensagem(request, token.uuid, sem.uuid)).signature, 'github', motivoAusente('X-Hub-Signature-256'));
  });
});

test.describe('timestamp e vários v1 (CA-2)', () => {
  const IDADE = 412;

  test('stripe: timestamp 412 s atrás com assinatura certa → timestamp outside tolerance (412 s)', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'stripe', secret: SEGREDO } });
    const { header } = assinaturaStripe(SEGREDO, CORPO, agoraEmSegundos() - IDADE);
    const { msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO, { 'Stripe-Signature': header }));
    expectForaDaTolerancia(msg.signature, IDADE);
    expect(msg.signature!.provider).toBe('stripe');
  });

  test('stripe: toleranceSeconds 600 aceita o mesmo timestamp de 412 s', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'stripe', secret: SEGREDO, toleranceSeconds: 600 } });
    const { header } = assinaturaStripe(SEGREDO, CORPO, agoraEmSegundos() - IDADE);
    const { msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO, { 'Stripe-Signature': header }));
    expectValida(msg.signature, 'stripe');
  });

  test('stripe: vários v1 — basta um conferir (o certo pode vir depois de um errado)', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'stripe', secret: SEGREDO } });
    const { t, v1 } = assinaturaStripe(SEGREDO, CORPO);
    const errado = assinaturaStripe('segredo-antigo-rotacionado', CORPO, t).v1;
    const { msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO, { 'Stripe-Signature': `t=${t},v1=${errado},v1=${v1}` }));
    expectValida(msg.signature, 'stripe');
  });

  test('stripe: vários v1, nenhum confere (e v0 é ignorado) → signature mismatch', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'stripe', secret: SEGREDO } });
    const { t, v1 } = assinaturaStripe(SEGREDO, CORPO);
    const errado1 = assinaturaStripe('errado-1', CORPO, t).v1;
    const errado2 = assinaturaStripe('errado-2', CORPO, t).v1;
    // O v0 leva a assinatura certa, mas só v1 conta.
    const { msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO, { 'Stripe-Signature': `t=${t},v0=${v1},v1=${errado1},v1=${errado2}` }));
    expectInvalida(msg.signature, 'stripe', MOTIVO_DIVERGENTE);
  });

  test('slack: timestamp 412 s atrás com assinatura certa → timestamp outside tolerance (412 s)', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'slack', secret: SEGREDO } });
    const { msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO, cabecalhosSlack(SEGREDO, CORPO, agoraEmSegundos() - IDADE)));
    expectForaDaTolerancia(msg.signature, IDADE);
    expect(msg.signature!.provider).toBe('slack');
  });

  test('slack: toleranceSeconds 600 aceita o mesmo timestamp de 412 s', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'slack', secret: SEGREDO, toleranceSeconds: 600 } });
    const { msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO, cabecalhosSlack(SEGREDO, CORPO, agoraEmSegundos() - IDADE)));
    expectValida(msg.signature, 'slack');
  });
});

test.describe('genérico: algoritmo × encoding × prefixo (CA-3)', () => {
  const ALGORITMOS: Algoritmo[] = ['sha1', 'sha256', 'sha512'];
  const CODIFICACOES: Codificacao[] = ['hex', 'base64'];
  const PREFIXOS: Array<string | undefined> = [undefined, 'hmac='];

  for (const algorithm of ALGORITMOS) {
    for (const encoding of CODIFICACOES) {
      for (const prefix of PREFIXOS) {
        const nome = `${algorithm} ${encoding} ${prefix ? `com prefixo "${prefix}"` : 'sem prefixo'}`;
        test(`${nome}: válida confere e corpo alterado dá signature mismatch`, async ({ request, tokens }) => {
          const config: ConfigAssinatura = { provider: 'generic', secret: SEGREDO, header: 'X-Webhook-Hmac', algorithm, encoding };
          if (prefix) config.prefix = prefix;
          const token = await tokens.criar({ signature: config });
          const assinatura = (prefix ?? '') + hmac(algorithm, SEGREDO, Buffer.from(CORPO), encoding);

          const { msg: valida } = await enviarEGuardar(request, token.uuid, '', post(CORPO, { 'X-Webhook-Hmac': assinatura }));
          expectValida(valida.signature, 'generic');

          const { msg: alterada } = await enviarEGuardar(request, token.uuid, '', post(CORPO_ALTERADO, { 'X-Webhook-Hmac': assinatura }));
          expectInvalida(alterada.signature, 'generic', MOTIVO_DIVERGENTE);
        });
      }
    }
  }

  test('com prefixo configurado, header sem o prefixo → malformed header', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'generic', secret: SEGREDO, header: 'X-Webhook-Hmac', prefix: 'hmac=' } });
    const { msg } = await enviarEGuardar(request, token.uuid, '', post(CORPO, { 'X-Webhook-Hmac': hmac('sha256', SEGREDO, Buffer.from(CORPO)) }));
    expectInvalida(msg.signature, 'generic', MOTIVO_MALFORMADO);
  });

  test('o header configurado é procurado sem distinção de caixa; ausente → "header <nome> absent"', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'generic', secret: SEGREDO, header: 'X-Webhook-Hmac' } });
    const assinatura = hmac('sha256', SEGREDO, Buffer.from(CORPO));
    const { msg: minusculo } = await enviarEGuardar(request, token.uuid, '', post(CORPO, { 'x-webhook-hmac': assinatura }));
    expectValida(minusculo.signature, 'generic');
    // Assinatura certa, mas em outro header.
    const { msg: outro } = await enviarEGuardar(request, token.uuid, '', post(CORPO, { 'X-Hub-Signature-256': `sha256=${assinatura}` }));
    expectInvalida(outro.signature, 'generic', motivoAusente('X-Webhook-Hmac'));
  });
});

test.describe('bytes crus (CA-4)', () => {
  // A verificação usa o corpo como chegou, antes de qualquer decodificação: o `content` gravado é
  // texto (UTF-8 inválido vira U+FFFD) e formulário/multipart são decodificados em `request`.
  const INVALIDO = Buffer.from([0x7b, 0xff, 0xfe, 0x00, 0x41, 0xc3, 0x28, 0x80, 0xe2, 0x82, 0x7d]);
  const JSON_ESQUISITO = Buffer.from('{ "b" : 1,\n  "a":"\\u00e7\\/x",  "c": 1.50 }\r\n', 'utf8');

  test('corpo com UTF-8 inválido assinado (github) → válida', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const { res, msg } = await enviarEGuardar(request, token.uuid, '', post(INVALIDO, { 'X-Hub-Signature-256': assinaturaGithub(SEGREDO, INVALIDO) }, 'application/octet-stream'));
    expect(res.status()).toBe(200);
    expectValida(msg.signature, 'github');
  });

  test('corpo com UTF-8 inválido assinado (stripe, `{t}.{corpo}`) → válida', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'stripe', secret: SEGREDO } });
    const { msg } = await enviarEGuardar(request, token.uuid, '', post(INVALIDO, { 'Stripe-Signature': assinaturaStripe(SEGREDO, INVALIDO).header }, 'application/octet-stream'));
    expectValida(msg.signature, 'stripe');
  });

  test('JSON com espaços, escapes e CRLF no fim: assinado byte a byte (slack) → válida', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'slack', secret: SEGREDO } });
    const { msg } = await enviarEGuardar(request, token.uuid, '', post(JSON_ESQUISITO, cabecalhosSlack(SEGREDO, JSON_ESQUISITO)));
    expectValida(msg.signature, 'slack');
  });

  test('multipart com campo de texto e arquivo binário assinado (github) → válida, e request com o campo', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const fronteira = 'XyZassinatura';
    const corpo = Buffer.concat([
      Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="campo"\r\n\r\nvalor\r\n`),
      Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="arq"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from([0x00, 0xff, 0xfe, 0x0d, 0x0a, 0x80]),
      Buffer.from(`\r\n--${fronteira}--\r\n`),
    ]);
    const { res, msg } = await enviarEGuardar(request, token.uuid, '', post(corpo, { 'X-Hub-Signature-256': assinaturaGithub(SEGREDO, corpo) }, `multipart/form-data; boundary=${fronteira}`));
    expect(res.status()).toBe(200);
    expectValida(msg.signature, 'github');
    expect(msg.request).toMatchObject({ campo: 'valor' });
  });

  test('formulário urlencoded assinado (shopify) → válida sobre os bytes, não sobre os campos decodificados', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'shopify', secret: SEGREDO } });
    const corpo = Buffer.from('b=%41%42&a=1+2&c=%C3%A7&a=3');
    const { msg } = await enviarEGuardar(request, token.uuid, '', post(corpo, { 'X-Shopify-Hmac-Sha256': assinaturaShopify(SEGREDO, corpo) }, 'application/x-www-form-urlencoded'));
    expectValida(msg.signature, 'shopify');
    expect(msg.request).toMatchObject({ b: 'AB' });
  });

  test('Transfer-Encoding chunked: assinatura sobre o corpo, sem o enquadramento dos pedaços (socket cru)', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const partes = ['{"id":"evt_1",', '"valor":100}'];
    const corpo = partes.join('');
    const enquadrado = partes.map((p) => `${Buffer.byteLength(p).toString(16)}\r\n${p}\r\n`).join('') + '0\r\n\r\n';
    const res = await httpCru([
      `POST /${token.uuid} HTTP/1.1`,
      'Content-Type: application/json',
      'Transfer-Encoding: chunked',
      `X-Hub-Signature-256: ${assinaturaGithub(SEGREDO, corpo)}`,
    ], enquadrado);
    expect(res.status).toBe(200);
    const msg = await buscarMensagem(request, token.uuid, res.headers['x-request-id']!);
    expect(msg.content).toBe(corpo);
    expectValida(msg.signature, 'github');
  });
});
