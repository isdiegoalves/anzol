import { clearTranslations, loadTranslations } from '@angular/localize';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { CapturedRequest } from '../requests/webhook-request';
import { CheckResult, checksOf, pipelineOf, routeOf } from './pipeline';

/** Só o que o selo mostra, para a tabela caber numa linha por caso. */
const brief = ({ state, tone, title, detail }: CheckResult) => ({ state, tone, title, detail });

describe('Dado a assinatura gravada na mensagem', () => {
  it.each([
    [
      'válida',
      { provider: 'stripe', valid: true, reason: null },
      { state: 'valid', tone: 'ok', title: 'Signature valid', detail: 'Stripe' },
    ],
    [
      'inválida por HMAC diferente (mismatch)',
      { provider: 'github', valid: false, reason: 'signature mismatch' },
      {
        state: 'invalid',
        tone: 'bad',
        title: 'Signature invalid',
        detail: 'the HMAC did not match (signature mismatch)',
      },
    ],
    [
      'inválida por timestamp velho (stale)',
      { provider: 'stripe', valid: false, reason: 'timestamp outside tolerance (412 s)' },
      {
        state: 'stale',
        tone: 'bad',
        title: 'Signature invalid',
        detail:
          'the HMAC matched, but the timestamp is 412 s from now, outside the tolerance (timestamp outside tolerance)',
      },
    ],
    [
      'ausente (o header exigido não veio)',
      { provider: 'stripe', valid: false, reason: 'header Stripe-Signature absent' },
      {
        state: 'absent',
        tone: 'bad',
        title: 'Signature absent',
        detail: 'header Stripe-Signature absent',
      },
    ],
    [
      'nula (a URL não verificava)',
      null,
      {
        state: 'unchecked',
        tone: 'none',
        title: 'Signature not checked',
        detail: 'This URL did not verify signatures',
      },
    ],
  ] as const)('deve dar o selo certo Quando está %s', (_caso, signature, esperado) => {
    const request = webhookRequest(1, { signature });

    expect(brief(pipelineOf(request).signature)).toEqual(esperado);
  });
});

describe('Dado o schema gravado na mensagem', () => {
  it.each([
    [
      'válido',
      { valid: true, errors: [] },
      { state: 'valid', tone: 'ok', title: 'Schema valid', detail: 'Body matches the schema' },
    ],
    [
      'inválido com dois erros',
      {
        valid: false,
        errors: [
          { path: '/amount', message: 'must be integer' },
          { path: '', message: 'must have required property id' },
        ],
      },
      {
        state: 'invalid',
        tone: 'bad',
        title: 'Schema invalid',
        detail: '/amount must be integer (+1 more)',
      },
    ],
    [
      'inválido na raiz',
      { valid: false, errors: [{ path: '', message: 'body is not JSON' }] },
      { state: 'invalid', tone: 'bad', title: 'Schema invalid', detail: '(root) body is not JSON' },
    ],
    [
      'nulo (a URL não validava)',
      null,
      {
        state: 'unchecked',
        tone: 'none',
        title: 'Schema not checked',
        detail: 'This URL did not validate a schema',
      },
    ],
  ] as const)('deve dar o selo certo Quando está %s', (_caso, schema, esperado) => {
    const request = webhookRequest(1, {
      schema: schema && { valid: schema.valid, errors: [...schema.errors] },
    });

    expect(brief(pipelineOf(request).schema)).toEqual(esperado);
  });
});

describe('Dado a regra que respondeu a mensagem', () => {
  it.each([
    [
      'uma regra respondeu',
      { rule: { id: 'r1', name: 'Pagamento pix' }, near_miss: null },
      {
        state: 'answered',
        tone: 'ok',
        title: 'Answered 200 · by rule',
        detail: 'Pagamento pix',
      },
    ],
    [
      'nenhuma casou e uma chegou perto (near miss), com as verificações em ordem',
      {
        rule: null,
        near_miss: {
          id: 'r2',
          name: 'Refund queued',
          failed: ['method: expected POST, got GET', 'header x-signature: absent'],
          conditions: ['match.method', 'match.headers.X-Signature'],
        },
      },
      {
        state: 'near-miss',
        tone: 'none',
        title: 'Answered 200 · default response',
        detail:
          'No rule matched. The closest is “Refund queued” — method: expected POST, got GET (+1 more)',
      },
    ],
    [
      'nenhuma regra (a resposta padrão respondeu)',
      { rule: null, near_miss: null },
      {
        state: 'default',
        tone: 'none',
        title: 'Answered 200 · default response',
        detail: 'No rule answered',
      },
    ],
  ] as const)('deve dar o selo certo Quando %s', (_caso, campos, esperado) => {
    const near = campos.near_miss && {
      ...campos.near_miss,
      failed: [...campos.near_miss.failed],
      conditions: [...campos.near_miss.conditions],
    };
    const request = webhookRequest(1, {
      rule: campos.rule,
      near_miss: near,
      response: { status: 200 },
    });

    expect(brief(pipelineOf(request).rule)).toEqual(esperado);
  });

  it.each([
    [
      'a assinatura falhou',
      { signature: { provider: 'github', valid: false, reason: 'signature mismatch' } },
    ],
    ['o schema falhou', { schema: { valid: false, errors: [{ path: '/id', message: 'x' }] } }],
    [
      'a decifra falhou',
      {
        decryption: {
          state: 'invalid',
          kid: null,
          signature_kid: null,
          reason: 'aud_mismatch',
          jti: null,
          duplicate_of: null,
        },
      },
    ],
  ] as const)('deve pôr o near miss em âmbar só Quando %s', (_caso, campos) => {
    const request = webhookRequest(1, {
      ...structuredClone(campos),
      near_miss: {
        id: 'r2',
        name: 'x',
        failed: ['method: expected POST, got GET'],
        conditions: [],
      },
      response: { status: 202 },
    } as Partial<CapturedRequest>);

    expect(pipelineOf(request).rule.tone).toBe('near');
  });

  it('deve dizer em pt-BR que nenhuma regra casou e qual chegou mais perto, com o estado em palavras', () => {
    loadTranslations(translations);
    try {
      const request = webhookRequest(1, {
        signature: { provider: 'generic', valid: true, reason: null },
        near_miss: {
          id: 'r2',
          name: 'signature: invalid → 401',
          failed: ['signature: expected invalid, got valid'],
          conditions: ['match.signature'],
        },
        response: { status: 202 },
      });

      expect(pipelineOf(request).rule.detail).toBe(
        'Nenhuma regra casou. A mais próxima é “signature: invalid → 401” — pede assinatura inválida; esta veio válida (signature: expected invalid, got valid)',
      );
    } finally {
      clearTranslations();
    }
  });

  it('deve pôr a condição no cartão Quando só uma falhou (near miss sem conditions, formato antigo)', () => {
    const request = webhookRequest(1, {
      near_miss: { id: 'r2', name: 'Só GET', failed: ['method: expected GET, got POST'] },
    });

    // INBOX-18: com uma condição só, a frase dela vai no cartão (o "Why? (n)" sai).
    expect(pipelineOf(request).rule.detail).toBe(
      'No rule matched. The closest is “Só GET” — method: expected GET, got POST',
    );
  });
});

describe('Dado uma mensagem gravada antes das verificações (sem os campos)', () => {
  it('deve dizer que a mensagem é de antes, sem selo de sucesso nem de falha', () => {
    const request = webhookRequest(1);

    expect(checksOf(request).map(brief)).toEqual([
      {
        state: 'unchecked',
        tone: 'none',
        title: 'Signature not checked',
        detail: 'Received before signature checks',
      },
      {
        state: 'unchecked',
        tone: 'none',
        title: 'Schema not checked',
        detail: 'Received before schema checks',
      },
      {
        state: 'default',
        tone: 'none',
        title: 'Default response',
        detail: 'Received before rules',
      },
    ]);
  });
});

describe('Dado a mensagem do link só-leitura (sem token_id, com [redacted] na url)', () => {
  const shared: CapturedRequest = {
    ...webhookRequest(1, {
      method: 'PUT',
      url: 'http://localhost:8084/[redacted]/pedidos/7?x=1',
      signature: { provider: 'github', valid: true, reason: null },
    }),
  };
  delete shared.token_id;

  it('deve tirar a rota da url tratando [redacted] como o segmento da URL e dar os selos', () => {
    const pipeline = pipelineOf(shared);

    expect(pipeline.method).toBe('PUT');
    expect(pipeline.route).toBe('/pedidos/7?x=1');
    expect(pipeline.signature.title).toBe('Signature valid');
    expect(pipeline.signatureHeaders).toEqual({ state: 'valid', rows: new Map(), missing: null });
  });
});

describe('Dado a url gravada da mensagem', () => {
  it.each([
    [`http://localhost:8084/${TOKEN_ID}`, '/'],
    [`http://localhost:8084/${TOKEN_ID}/`, '/'],
    [`http://localhost:8084/${TOKEN_ID}?x=1&y=2`, '/?x=1&y=2'],
    [`http://localhost:8084/${TOKEN_ID}/a/b?x=1`, '/a/b?x=1'],
    ['http://localhost:8084/[redacted]/a', '/a'],
    ['http://localhost:8084/%5Bredacted%5D/a?b=%5B1%5D', '/a?b=%5B1%5D'],
    ['https://webhook.example:443/[redacted]', '/'],
  ])('deve dar a rota depois do segmento da URL: %s → %s', (url, rota) => {
    expect(routeOf(url)).toBe(rota);
  });
});

describe('Dado a URL da mensagem com assinatura genérica', () => {
  it('deve ligar o selo às linhas do header configurado Quando a URL é conhecida', () => {
    const request = webhookRequest(1, {
      headers: { 'x-sig': ['abc'] },
      signature: { provider: 'generic', valid: false, reason: 'signature mismatch' },
    });
    const url = token({
      signature: { provider: 'generic', header: 'X-Sig', algorithm: 'sha256', secret: '••••1234' },
    });

    expect([...(pipelineOf(request, { token: url }).signatureHeaders?.rows.keys() ?? [])]).toEqual([
      'x-sig',
    ]);
  });
});

// Fase 2 (INBOX-13): o selo da lista diz o que houve em poucas palavras; INBOX-18: o cartão do
// detalhe diz o status da regra, o dialeto do schema e a idade da assinatura Stripe.
describe('Dado a resposta gravada na mensagem (C3, E-06; B2, UX-02)', () => {
  it.each([
    [
      { status: 404 },
      'Answered 404 · by rule',
      '404 · Tudo o resto',
      'Answered by rule · 404: Tudo o resto',
    ],
    [
      { fault: 'connection_reset' },
      'Network fault · Connection reset',
      '— · Connection reset',
      'Network fault by rule: Connection reset: Tudo o resto',
    ],
    [
      { fault: 'falha_nova' },
      'Network fault · falha_nova',
      '— · falha_nova',
      'Network fault by rule: falha_nova: Tudo o resto',
    ],
    [null, 'Answered by rule', '— · not recorded', 'Answer not recorded, by rule Tudo o resto'],
    [
      undefined,
      'Answered by rule',
      '— · not recorded',
      'Answer not recorded, by rule Tudo o resto',
    ],
  ])('deve mostrar %j, da regra, como "%s" / "%s"', (response, title, short, spoken) => {
    const request = webhookRequest(1, {
      rule: { id: 'r9', name: 'Tudo o resto' },
      ...(response !== undefined && { response }),
    });
    const rule = pipelineOf(request).rule;

    expect([rule.title, rule.short, rule.spoken]).toEqual([title, short, spoken]);
  });

  it.each([
    [
      { status: 429 },
      'Answered 429 · default response',
      '429 · Default response',
      'Default response · 429',
    ],
    [
      { status: 500 },
      'Answered 500 · default response',
      '500 · Default response',
      'Default response · 500',
    ],
    [null, 'Default response', '— · not recorded', 'Answer not recorded'],
  ])('deve mostrar %j, da resposta padrão, como "%s" / "%s"', (response, title, short, spoken) => {
    const rule = pipelineOf(webhookRequest(1, { rule: null, response })).rule;

    expect([rule.title, rule.short, rule.spoken]).toEqual([title, short, spoken]);
    // Neutro de 2xx a 5xx: o status não muda o tom.
    expect([rule.state, rule.tone]).toEqual(['default', 'none']);
  });

  it('deve dar o tom de erro só à falha de rede', () => {
    const fault = pipelineOf(
      webhookRequest(1, {
        rule: { id: 'r', name: 'Derruba' },
        response: { fault: 'empty_response' },
      }),
    ).rule;

    expect([fault.state, fault.tone, fault.short]).toEqual(['fault', 'bad', '— · Empty response']);
  });
});

describe('Dado o selo curto da lista e o cartão do detalhe (INBOX-13/18)', () => {
  const short = (request: CapturedRequest, kind: 'signature' | 'schema' | 'rule') =>
    pipelineOf(request)[kind].short;

  it.each([
    [{ provider: 'github', valid: true, reason: null }, 'GitHub'],
    [{ provider: 'github', valid: false, reason: 'signature mismatch' }, 'Mismatch'],
    [{ provider: 'generic', valid: false, reason: 'malformed header' }, 'Malformed'],
    [
      { provider: 'stripe', valid: false, reason: 'timestamp outside tolerance (412 s)' },
      'Stale timestamp',
    ],
    [
      { provider: 'github', valid: false, reason: 'header X-Hub-Signature-256 absent' },
      'No signature',
    ],
  ] as const)('deve dizer %j como "%s" na assinatura', (signature, esperado) => {
    expect(short(webhookRequest(1, { signature: { ...signature } }), 'signature')).toBe(esperado);
  });

  describe('Dado a tela em pt-BR', () => {
    beforeEach(() => loadTranslations(translations));
    afterEach(() => clearTranslations());

    it.each([
      ['signature mismatch', 'Não confere'],
      ['malformed header', 'Fora do formato'],
    ])('deve dizer "%s" como "%s" na assinatura', (reason, esperado) => {
      const signature = { provider: 'generic' as const, valid: false, reason };
      expect(short(webhookRequest(1, { signature }), 'signature')).toBe(esperado);
    });

    it.each([
      ['signature mismatch', 'o HMAC não bateu (signature mismatch)'],
      [
        'header X-Hub-Signature-256 absent',
        'faltou o cabeçalho X-Hub-Signature-256 (header X-Hub-Signature-256 absent)',
      ],
      ['malformed header', 'o cabeçalho não está no formato esperado (malformed header)'],
      [
        'timestamp outside tolerance (412 s)',
        'o HMAC bateu, mas o timestamp está a 412 s de agora, fora da tolerância (timestamp outside tolerance)',
      ],
      ['motivo novo', 'motivo novo'],
    ])(
      'deve explicar "%s" no cartão, com o motivo do servidor entre parênteses',
      (reason, esperado) => {
        const signature = { provider: 'github' as const, valid: false, reason };
        expect(pipelineOf(webhookRequest(1, { signature })).signature.detail).toBe(esperado);
      },
    );
  });

  it.each([
    [{ valid: true, errors: [] }, 'Schema'],
    [{ valid: false, errors: [{ path: '/a', message: 'x' }] }, '1 schema error'],
    [
      {
        valid: false,
        errors: [
          { path: '', message: 'must have required property id' },
          { path: '', message: 'must have required property nome' },
        ],
      },
      '2 schema errors',
    ],
    [{ valid: false, errors: [{ path: '', message: 'body is not JSON' }] }, 'Not JSON'],
  ] as const)('deve dizer %j como "%s" no schema', (schema, esperado) => {
    const request = webhookRequest(1, {
      schema: { valid: schema.valid, errors: [...schema.errors] },
    });
    expect(short(request, 'schema')).toBe(esperado);
  });

  // C3 (E-06): o status é o que a mensagem gravou, e não o que a regra responde hoje.
  it('deve dizer o status gravado da regra que respondeu no selo e no título do cartão', () => {
    const request = webhookRequest(1, {
      rule: { id: 'r1', name: 'Pix' },
      response: { status: 201 },
    });
    const rule = pipelineOf(request).rule;

    expect([rule.title, rule.detail, rule.short]).toEqual([
      'Answered 201 · by rule',
      'Pix',
      '201 · Pix',
    ]);
    // Near miss: quem respondeu foi a resposta padrão, e o selo diz o status dela.
    expect(
      short(
        webhookRequest(2, {
          near_miss: { id: 'r2', name: 'x', failed: ['a', 'b'] },
          response: { status: 429 },
        }),
        'rule',
      ),
    ).toBe('429 · Default response');
  });

  it('deve dizer o dialeto do $schema da URL no cartão do schema válido', () => {
    const request = webhookRequest(1, { schema: { valid: true, errors: [] } });
    const url = token({
      schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
    });

    expect(pipelineOf(request, { token: url }).schema.detail).toBe(
      'Body matches the schema · 2020-12',
    );
  });

  it('deve dizer quantos segundos antes da chegada a assinatura Stripe foi feita', () => {
    const request = webhookRequest(1, {
      created_at: '2026-09-27 10:00:05',
      headers: { 'stripe-signature': [`t=${Date.UTC(2026, 8, 27, 10, 0, 0) / 1000},v1=abc`] },
      signature: { provider: 'stripe', valid: true, reason: null },
    });

    expect(pipelineOf(request).signature.detail).toBe('Stripe · signed 5 s before arrival');
  });
});
