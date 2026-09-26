import type { APIRequestContext } from '@playwright/test';
import { JSON_ACCEPT, UUID, enviarEGuardar, expect, expectContentType, test } from '../../support/contrato.js';
import { salvarRegras, type MatchRegra, type Regra } from '../../support/regras.js';

// Regras de resposta no webhook (CA-1, CA-2, CA-3): a regra ativa que casa com a requisição
// responde com o status, os cabeçalhos e o corpo dela; entre várias, vence a de menor
// `priority` e, no empate, a primeira da lista. Nenhuma casando, a URL responde exatamente como
// hoje. Os testes usam regex ancorada (`^…$`) para não depender de "casa em parte" × "casa tudo".

/** Os 4 cabeçalhos de CORS do token ligado (os mesmos de `webhook.spec.ts`). */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, PATCH, POST, OPTIONS',
  'access-control-allow-headers': 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range',
  'access-control-expose-headers': 'Content-Length,Content-Range',
};

/** Padrão do token, distinto de qualquer resposta de regra. */
const PADRAO = { default_status: 200, default_content: 'padrao', default_content_type: 'text/plain' };
const RESPOSTA_DA_REGRA = { status: 203, body: 'regra' };

interface Pedido {
  caminho: string;
  method?: string;
  headers?: Record<string, string>;
  corpo?: string;
}

async function responder(request: APIRequestContext, tokenId: string, pedido: Pedido): Promise<{ status: number; corpo: string }> {
  const res = await request.fetch(`/${tokenId}${pedido.caminho}`, {
    method: pedido.method ?? 'GET',
    headers: pedido.headers,
    data: pedido.corpo === undefined ? undefined : Buffer.from(pedido.corpo),
  });
  return { status: res.status(), corpo: await res.text() };
}

const json = (corpo: string): Pick<Pedido, 'method' | 'headers' | 'corpo'> =>
  ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, corpo });
const texto = (corpo: string): Pick<Pedido, 'method' | 'headers' | 'corpo'> =>
  ({ method: 'POST', headers: { 'Content-Type': 'text/plain' }, corpo });

test.describe('regras no webhook: resposta da regra', () => {
  test('método + caminho: status, cabeçalhos e corpo da regra; a mensagem é gravada como sempre', async ({ request, tokens }) => {
    const token = await tokens.criar(PADRAO);
    await salvarRegras(request, token.uuid, [{
      name: 'Pagamento criado',
      match: { method: ['POST'], path: { equals: '/pagamentos' } },
      response: { status: 201, headers: { 'Content-Type': 'application/json', 'X-Mock': 'sim' }, body: '{"id":"pg_1","ok":true}' },
    }]);

    const { res, msg } = await enviarEGuardar(request, token.uuid, '/pagamentos', json('{"valor":10}'));
    expect(res.status()).toBe(201);
    expectContentType(res, 'application/json');
    expect(res.headers()['x-mock']).toBe('sim');
    expect(await res.text()).toBe('{"id":"pg_1","ok":true}');
    // A URL continua identificando a mensagem gravada.
    expect(res.headers()['x-request-id']).toMatch(UUID);
    expect(res.headers()['x-token-id']).toBe(token.uuid);
    expect(msg.method).toBe('POST');
    expect(msg.content).toBe('{"valor":10}');

    // Outro método ou outro caminho: a resposta padrão.
    expect(await responder(request, token.uuid, { caminho: '/pagamentos', method: 'GET' })).toEqual({ status: 200, corpo: 'padrao' });
    expect(await responder(request, token.uuid, { caminho: '/outra', ...json('{}') })).toEqual({ status: 200, corpo: 'padrao' });
  });

  test('status da regra vale mesmo em caminho que hoje define o status (/404)', async ({ request, tokens }) => {
    const token = await tokens.criar(PADRAO);
    await salvarRegras(request, token.uuid, [{ name: 'n', match: { path: { equals: '/404' } }, response: { status: 200, body: 'achei' } }]);
    expect(await responder(request, token.uuid, { caminho: '/404' })).toEqual({ status: 200, corpo: 'achei' });
  });

  test('nenhuma regra casa: a resposta padrão de hoje (status, corpo, Content-Type, timeout, Retry-After, CORS, status pelo caminho)', async ({ request, tokens }) => {
    const token = await tokens.criar({ ...PADRAO, default_status: 202, timeout: 1, retry_after: 30 });
    await request.put(`/token/${token.uuid}/cors/toggle`, { headers: JSON_ACCEPT });
    await salvarRegras(request, token.uuid, [
      { name: 'só POST /outra', match: { method: ['POST'], path: { equals: '/outra' } }, response: RESPOSTA_DA_REGRA },
    ]);

    const inicio = Date.now();
    const res = await request.get(`/${token.uuid}/qualquer`, { headers: { Origin: 'http://exemplo.test' } });
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(1000);
    expect(res.status()).toBe(202);
    expect(await res.text()).toBe('padrao');
    expectContentType(res, 'text/plain; charset=UTF-8');
    expect(res.headers()['retry-after']).toBe('30');
    expect(res.headers()).toMatchObject(CORS);
    expect(res.headers()['x-request-id']).toMatch(UUID);

    const porCaminho = await request.post(`/${token.uuid}/404`, { headers: { Origin: 'http://exemplo.test' } });
    expect(porCaminho.status()).toBe(404);
    expect(porCaminho.headers()['retry-after']).toBe('30');
    expect(porCaminho.headers()).toMatchObject(CORS);
  });

  test('PUT [] tira as regras: volta a resposta padrão', async ({ request, tokens }) => {
    const token = await tokens.criar(PADRAO);
    await salvarRegras(request, token.uuid, [{ name: 'tudo', response: RESPOSTA_DA_REGRA }]);
    expect(await responder(request, token.uuid, { caminho: '/a' })).toEqual({ status: 203, corpo: 'regra' });
    await salvarRegras(request, token.uuid, []);
    expect(await responder(request, token.uuid, { caminho: '/a' })).toEqual({ status: 200, corpo: 'padrao' });
  });

  test('regra sem match casa qualquer requisição; padrões da resposta: 200 e corpo vazio', async ({ request, tokens }) => {
    const token = await tokens.criar({ ...PADRAO, default_status: 202 });
    await salvarRegras(request, token.uuid, [{ name: 'qualquer' }]);
    for (const pedido of [{ caminho: '' }, { caminho: '/a/b?c=d', ...json('{"x":1}') }, { caminho: '/z', method: 'DELETE' }]) {
      expect(await responder(request, token.uuid, pedido)).toEqual({ status: 200, corpo: '' });
    }
  });
});

test.describe('regras no webhook: prioridade e ativação', () => {
  const casaTudo = (name: string, extra: Partial<Regra> = {}): Regra =>
    ({ name, match: { path: { prefix: '/' } }, response: { status: 200, body: name }, ...extra });

  test('menor priority vence, qualquer que seja a posição na lista', async ({ request, tokens }) => {
    const token = await tokens.criar(PADRAO);
    await salvarRegras(request, token.uuid, [casaTudo('p9', { priority: 9 }), casaTudo('p5'), casaTudo('p1', { priority: 1 }), casaTudo('p3', { priority: 3 })]);
    expect((await responder(request, token.uuid, { caminho: '/a' })).corpo).toBe('p1');
  });

  test('empate de priority: vence a primeira da lista', async ({ request, tokens }) => {
    const token = await tokens.criar(PADRAO);
    await salvarRegras(request, token.uuid, [casaTudo('segunda-p5'), casaTudo('primeira-p3', { priority: 3 }), casaTudo('terceira-p3', { priority: 3 })]);
    expect((await responder(request, token.uuid, { caminho: '/a' })).corpo).toBe('primeira-p3');
  });

  test('regra de prioridade melhor que não casa não atrapalha', async ({ request, tokens }) => {
    const token = await tokens.criar(PADRAO);
    await salvarRegras(request, token.uuid, [
      { name: 'p1-outro-caminho', priority: 1, match: { path: { equals: '/b' } }, response: { body: 'p1' } },
      casaTudo('p5'),
    ]);
    expect((await responder(request, token.uuid, { caminho: '/a' })).corpo).toBe('p5');
    expect((await responder(request, token.uuid, { caminho: '/b' })).corpo).toBe('p1');
  });

  test('regra desativada não responde, mesmo com a melhor prioridade', async ({ request, tokens }) => {
    const token = await tokens.criar(PADRAO);
    await salvarRegras(request, token.uuid, [casaTudo('desativada', { priority: 1, enabled: false }), casaTudo('ativa', { priority: 9 })]);
    expect((await responder(request, token.uuid, { caminho: '/a' })).corpo).toBe('ativa');
  });

  test('só regras desativadas: resposta padrão', async ({ request, tokens }) => {
    const token = await tokens.criar(PADRAO);
    await salvarRegras(request, token.uuid, [casaTudo('a', { enabled: false }), casaTudo('b', { enabled: false })]);
    expect(await responder(request, token.uuid, { caminho: '/a' })).toEqual({ status: 200, corpo: 'padrao' });
  });
});

test.describe('regras no webhook: cada condição casa e deixa de casar', () => {
  // [nome, match, pedido que casa, pedido que não casa]
  const casos: Array<[string, MatchRegra, Pedido, Pedido]> = [
    // Método
    ['method: lista de métodos', { method: ['POST', 'PUT'] }, { caminho: '/a', method: 'PUT' }, { caminho: '/a', method: 'GET' }],
    ['method vazio = qualquer', { method: [], path: { equals: '/x' } }, { caminho: '/x', method: 'DELETE' }, { caminho: '/y', method: 'DELETE' }],
    // Caminho (depois do token)
    ['path equals', { path: { equals: '/pagamentos' } }, { caminho: '/pagamentos' }, { caminho: '/pagamentos/1' }],
    ['path equals ignora a query', { path: { equals: '/p' } }, { caminho: '/p?x=1' }, { caminho: '/p/x?x=1' }],
    ['path equals "/": URL sem caminho', { path: { equals: '/' } }, { caminho: '' }, { caminho: '/a' }],
    ['path prefix', { path: { prefix: '/api/' } }, { caminho: '/api/v1/itens' }, { caminho: '/outra/api/' }],
    ['path regex', { path: { regex: '^/itens/[0-9]+$' } }, { caminho: '/itens/42' }, { caminho: '/itens/abc' }],
    // Query
    ['query equals', { query: { tipo: { equals: 'pix' } } }, { caminho: '?tipo=pix' }, { caminho: '?tipo=boleto' }],
    ['query contains', { query: { tipo: { contains: 'ix' } } }, { caminho: '/a?tipo=pix' }, { caminho: '/a?tipo=boleto' }],
    ['query regex', { query: { tipo: { regex: '^p[a-z]x$' } } }, { caminho: '?tipo=pix' }, { caminho: '?tipo=px' }],
    ['query present: true', { query: { tipo: { present: true } } }, { caminho: '?tipo=x' }, { caminho: '?outro=x' }],
    ['query present: false', { query: { tipo: { present: false } } }, { caminho: '?outro=x' }, { caminho: '?tipo=x' }],
    // Cabeçalhos (nome sem distinção de caixa)
    ['header equals', { headers: { 'X-Canal': { equals: 'web-01' } } }, { caminho: '', headers: { 'x-canal': 'web-01' } }, { caminho: '', headers: { 'x-canal': 'web-02' } }],
    ['header contains', { headers: { 'X-Canal': { contains: 'eb-0' } } }, { caminho: '', headers: { 'X-CANAL': 'web-01' } }, { caminho: '', headers: { 'X-Canal': 'mobile' } }],
    ['header regex', { headers: { 'x-canal': { regex: '^web-[0-9]+$' } } }, { caminho: '', headers: { 'X-Canal': 'web-01' } }, { caminho: '', headers: { 'X-Canal': 'web-x' } }],
    ['header present: true', { headers: { 'X-Signature': { present: true } } }, { caminho: '', headers: { 'x-signature': 'abc' } }, { caminho: '' }],
    ['header present: false', { headers: { 'X-Signature': { present: false } } }, { caminho: '' }, { caminho: '', headers: { 'x-signature': 'abc' } }],
    // Corpo
    ['body equals', { body: [{ equals: 'pedido-123' }] }, { caminho: '', ...texto('pedido-123') }, { caminho: '', ...texto('pedido-1234') }],
    ['body contains', { body: [{ contains: 'pedido' }] }, { caminho: '', ...texto('novo pedido aqui') }, { caminho: '', ...texto('nova compra') }],
    ['body regex', { body: [{ regex: '^pedido-[0-9]+$' }] }, { caminho: '', ...texto('pedido-123') }, { caminho: '', ...texto('pedido-abc') }],
    ['body jsonPath existe', { body: [{ jsonPath: { path: '$.pedido.id' } }] }, { caminho: '', ...json('{"pedido":{"id":1}}') }, { caminho: '', ...json('{"pedido":{}}') }],
    ['body jsonPath igual', { body: [{ jsonPath: { path: '$.status', equals: 'pago' } }] }, { caminho: '', ...json('{"status":"pago","v":1}') }, { caminho: '', ...json('{"status":"pendente"}') }],
    ['body jsonPath com corpo que não é JSON', { body: [{ jsonPath: { path: '$.status' } }] }, { caminho: '', ...json('{"status":null}') }, { caminho: '', ...texto('status=pago') }],
    ['body equalToJson ignora a ordem das chaves e o espaçamento', { body: [{ equalToJson: { a: 1, b: { c: [1, 2], d: 'x' } } }] },
      { caminho: '', ...json('{ "b": { "d": "x", "c": [1, 2] }, "a": 1 }') }, { caminho: '', ...json('{"a":2,"b":{"c":[1,2],"d":"x"}}') }],
    ['body equalToJson: chave a mais não casa', { body: [{ equalToJson: { a: 1 } }] }, { caminho: '', ...json('{"a":1}') }, { caminho: '', ...json('{"a":1,"b":2}') }],
    ['body equalToJson com corpo que não é JSON', { body: [{ equalToJson: { a: 1 } }] }, { caminho: '', ...json('{"a":1}') }, { caminho: '', ...json('{"a":1') }],
    // Todas em E
    ['todas as condições em E',
      { method: ['POST'], path: { equals: '/pagamentos' }, query: { tipo: { equals: 'pix' } }, headers: { 'X-Signature': { present: true } }, body: [{ jsonPath: { path: '$.status', equals: 'pago' } }, { contains: 'pedido' }] },
      { caminho: '/pagamentos?tipo=pix', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': 's' }, corpo: '{"status":"pago","pedido":7}' },
      { caminho: '/pagamentos?tipo=pix', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': 's' }, corpo: '{"status":"pago","compra":7}' }],
  ];

  for (const [nome, match, casa, naoCasa] of casos) {
    test(nome, async ({ request, tokens }) => {
      const token = await tokens.criar(PADRAO);
      await salvarRegras(request, token.uuid, [{ name: nome, match, response: RESPOSTA_DA_REGRA }]);
      expect(await responder(request, token.uuid, casa), `casa: ${JSON.stringify(casa)}`).toEqual({ status: 203, corpo: 'regra' });
      expect(await responder(request, token.uuid, naoCasa), `não casa: ${JSON.stringify(naoCasa)}`).toEqual({ status: 200, corpo: 'padrao' });
    });
  }
});
