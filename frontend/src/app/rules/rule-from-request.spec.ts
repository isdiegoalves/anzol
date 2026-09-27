import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import {
  RuleCandidate,
  pathAfterToken,
  ruleCandidates,
  ruleFromCandidates,
  ruleFromRequest,
  volatileHint,
} from './rule-from-request';

const BASE = `http://localhost:8084/${TOKEN_ID}`;

describe('Dado uma mensagem gravada como ponto de partida de uma regra', () => {
  it('deve montar a regra sem superajustar Quando a mensagem é um POST JSON com query (WM-31, CA-6)', () => {
    const request = webhookRequest(1, {
      method: 'POST',
      url: `${BASE}/pedidos?tipo=pix&n=2`,
      query: { tipo: 'pix', n: '2' },
      headers: { 'content-type': ['application/json'], 'x-signature': ['abc'] },
      content: '{"id": 42, "itens": [1, 2], "created_at": 1790512142, "status": "pago"}',
    });

    expect(ruleFromRequest(request)).toEqual({
      name: 'POST /pedidos',
      enabled: true,
      priority: 5,
      match: {
        method: ['POST'],
        path: { equals: '/pedidos' },
        query: { tipo: { equals: 'pix' }, n: { equals: '2' } },
        headers: {},
        body: [
          { jsonPath: { path: '$.itens', equals: [1, 2] } },
          { jsonPath: { path: '$.status', equals: 'pago' } },
        ],
      },
      response: { status: 200, headers: {}, body: '' },
    });
  });

  it('deve sugerir as caixas com id, data e UUID desmarcados e os cabeçalhos também', () => {
    const request = webhookRequest(1, {
      url: `${BASE}/pagamentos?env=prod`,
      query: { env: 'prod' },
      headers: { 'x-tenant': ['acme'] },
      content: JSON.stringify({
        id: 'p2',
        status: 'pago',
        pedido_id: 'x9',
        ref: '550e8400-e29b-41d4-a716-446655440000',
      }),
    });

    expect(
      ruleCandidates(request).map(({ kind, field, checked, hint }) => [kind, field, checked, hint]),
    ).toEqual([
      ['method', 'POST', true, null],
      ['path', '/pagamentos', true, null],
      ['query', 'env', true, null],
      ['header', 'x-tenant', false, null],
      ['body', '$.id', false, 'id'],
      ['body', '$.status', true, null],
      ['body', '$.pedido_id', false, 'id'],
      ['body', '$.ref', false, 'uuid'],
    ]);
  });

  // R2-L3: os cabeçalhos na ordem do painel (L6), x-* primeiro e os de transporte marcados.
  it('deve pôr os x-* primeiro e marcar os cabeçalhos de transporte, por último', () => {
    const request = webhookRequest(1, {
      url: `${BASE}/pagamentos`,
      headers: {
        'content-length': ['17'],
        'x-tenant': ['acme'],
        'content-type': ['application/json'],
        accept: ['*/*'],
        'user-agent': ['curl/8'],
        host: ['localhost'],
      },
      content: '',
    });

    expect(
      ruleCandidates(request)
        .filter(({ kind }) => kind === 'header')
        .map(({ field, transport }) => [field, transport]),
    ).toEqual([
      ['x-tenant', false],
      ['content-type', false],
      ['content-length', true],
      ['accept', true],
      ['user-agent', true],
      ['host', true],
    ]);
  });

  it('deve montar a regra das caixas escolhidas, com o caminho "começa com" e a resposta da folha', () => {
    const request = webhookRequest(1, {
      url: `${BASE}/pagamentos`,
      headers: { 'x-tenant': ['acme'] },
      content: '{"status":"pago"}',
    });
    const escolhidas = ruleCandidates(request).map((c) =>
      c.kind === 'header' ? { ...c, checked: true } : c,
    );

    expect(
      ruleFromCandidates(request, escolhidas, 'prefix', {
        status: 201,
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      }),
    ).toMatchObject({
      match: {
        path: { prefix: '/pagamentos' },
        headers: { 'x-tenant': { equals: 'acme' } },
        body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
      },
      response: { status: 201, body: '{}', headers: { 'Content-Type': 'application/json' } },
    });
  });

  it.each([
    ['id', 'x', 'id'],
    ['pedido_id', 'x', 'id'],
    ['orderId', 'x', 'id'],
    ['created_at', 1, 'timestamp'],
    ['updatedAt', 'x', 'timestamp'],
    ['data', '1790512142', 'timestamp'],
    ['quando', 1790512142000, 'timestamp'],
    ['ref', '550E8400-E29B-41D4-A716-446655440000', 'uuid'],
    ['status', 'pago', null],
    ['valor', 10, null],
  ])('deve reconhecer %s = %j como %s', (nome, valor, esperado) => {
    expect(volatileHint(nome, valor)).toBe(esperado);
  });

  it('deve oferecer o corpo de formulário como texto, desmarcado', () => {
    const request = webhookRequest(1, {
      method: 'PUT',
      url: `${BASE}/form`,
      content: 'nome=Ana&idade=30',
      request: { nome: 'Ana', idade: '30' },
    });

    const texto = ruleCandidates(request).find(({ kind }) => kind === 'bodyText');
    expect(texto).toMatchObject({ value: 'nome=Ana&idade=30', checked: false });
    expect(ruleFromRequest(request).match?.body).toEqual([]);
    expect(
      ruleFromCandidates(request, [{ ...(texto as RuleCandidate), checked: true }], 'equals', {
        status: 200,
        body: '',
        headers: {},
      }).match?.body,
    ).toEqual([{ equals: 'nome=Ana&idade=30' }]);
  });

  it.each([
    ['sem caminho', BASE, '/'],
    ['só a barra', `${BASE}/?a=1`, '/'],
    ['com subcaminho e query', `${BASE}/a/b?x=1`, '/a/b'],
    ['com escape %XX', `${BASE}/caf%C3%A9/a%20b`, '/café/a b'],
    ['com + (não vira espaço)', `${BASE}/a+b`, '/a+b'],
    ['com escape inválido', `${BASE}/100%`, '/100%'],
  ])('deve tirar o caminho após o token %s', (_caso, url, esperado) => {
    expect(pathAfterToken(url, TOKEN_ID)).toBe(esperado);
  });

  it('deve pôr / no caminho e no nome Quando a mensagem chegou na raiz da URL', () => {
    const regra = ruleFromRequest(webhookRequest(1, { method: 'GET', url: BASE, content: '' }));

    expect(regra.name).toBe('GET /');
    expect(regra.match?.path).toEqual({ equals: '/' });
  });

  it('deve comparar o valor como JSON Quando a query tem lista ou objeto (a[]=1)', () => {
    const request = webhookRequest(1, { query: { a: ['1', '2'], o: { k: 'v' }, vazio: '' } });

    expect(ruleFromRequest(request).match?.query).toEqual({
      a: { equals: '["1","2"]' },
      o: { equals: '{"k":"v"}' },
      vazio: { equals: '' },
    });
  });

  it.each([
    ['null', null, {}],
    ['vazia', {}, {}],
  ])('deve deixar a query sem condição Quando a query é %s', (_caso, query, esperado) => {
    expect(ruleFromRequest(webhookRequest(1, { query })).match?.query).toEqual(esperado);
  });

  it.each([
    ['vazio', '', false],
    ['nulo', null, false],
    ['JSON escalar', '10', true],
    ['texto JSON ("x")', '"x"', true],
    ['JSON malformado', '{"a":', true],
    ['texto de exatamente 10 KiB', 'a'.repeat(10240), true],
    ['texto de 10 KiB + 1 byte', 'a'.repeat(10241), false],
    // 5121 × "é" = 10242 bytes em UTF-8, embora sejam só 5121 caracteres.
    ['texto de 10 KiB em bytes UTF-8', 'é'.repeat(5121), false],
  ])('deve oferecer (ou não) o corpo como texto Quando o corpo é %s', (_caso, content, oferece) => {
    const request = webhookRequest(1, { content });
    expect(ruleCandidates(request).some(({ kind }) => kind === 'bodyText')).toBe(oferece);
    expect(ruleFromRequest(request).match?.body).toEqual([]);
  });

  it('deve cortar o nome em 100 caracteres Quando o caminho é longo', () => {
    const regra = ruleFromRequest(webhookRequest(1, { url: `${BASE}/${'x'.repeat(200)}` }));

    expect(regra.name).toHaveLength(100);
    expect(regra.name.startsWith('POST /xxx')).toBe(true);
    expect(regra.match?.path).toEqual({ equals: `/${'x'.repeat(200)}` });
  });
});
