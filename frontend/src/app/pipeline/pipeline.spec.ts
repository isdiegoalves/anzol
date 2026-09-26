import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
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
      { state: 'invalid', tone: 'bad', title: 'Signature invalid', detail: 'signature mismatch' },
    ],
    [
      'inválida por timestamp velho (stale)',
      { provider: 'stripe', valid: false, reason: 'timestamp outside tolerance (412 s)' },
      {
        state: 'stale',
        tone: 'bad',
        title: 'Signature invalid',
        detail: 'timestamp outside tolerance (412 s)',
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
      { state: 'answered', tone: 'ok', title: 'Answered by rule', detail: 'Pagamento pix' },
    ],
    [
      'nenhuma casou e uma chegou perto (near miss)',
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
        tone: 'near',
        title: 'No rule matched',
        detail: 'Closest: Refund queued (2 conditions failed)',
      },
    ],
    [
      'nenhuma regra (a resposta padrão respondeu)',
      { rule: null, near_miss: null },
      { state: 'default', tone: 'none', title: 'Default response', detail: 'No rule answered' },
    ],
  ] as const)('deve dar o selo certo Quando %s', (_caso, campos, esperado) => {
    const near = campos.near_miss && {
      ...campos.near_miss,
      failed: [...campos.near_miss.failed],
      conditions: [...campos.near_miss.conditions],
    };
    const request = webhookRequest(1, { rule: campos.rule, near_miss: near });

    expect(brief(pipelineOf(request).rule)).toEqual(esperado);
  });

  it('deve contar "1 condition" no singular Quando só uma condição falhou (near miss sem conditions, formato antigo)', () => {
    const request = webhookRequest(1, {
      near_miss: { id: 'r2', name: 'Só GET', failed: ['method: expected GET, got POST'] },
    });

    expect(pipelineOf(request).rule.detail).toBe('Closest: Só GET (1 condition failed)');
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
