import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { pathAfterToken, ruleFromRequest } from './rule-from-request';

const BASE = `http://localhost:8084/${TOKEN_ID}`;

describe('Dado uma mensagem gravada como ponto de partida de uma regra', () => {
  it('deve montar a regra do Anexo C Quando a mensagem é um POST JSON com query', () => {
    const request = webhookRequest(1, {
      method: 'POST',
      url: `${BASE}/pedidos?tipo=pix&n=2`,
      query: { tipo: 'pix', n: '2' },
      headers: { 'content-type': ['application/json'], 'x-signature': ['abc'] },
      content: '{"id": 42, "itens": [1, 2]}',
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
        body: [{ equalToJson: { id: 42, itens: [1, 2] } }],
      },
      response: { status: 200, headers: {}, body: '' },
    });
  });

  it('deve casar o corpo com equals Quando a mensagem é um formulário', () => {
    const request = webhookRequest(1, {
      method: 'PUT',
      url: `${BASE}/form`,
      content: 'nome=Ana&idade=30',
      request: { nome: 'Ana', idade: '30' },
    });

    expect(ruleFromRequest(request).match?.body).toEqual([{ equals: 'nome=Ana&idade=30' }]);
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
    ['vazio', '', [{ equals: '' }]],
    ['nulo', null, [{ equals: '' }]],
    ['JSON escalar', '10', [{ equalToJson: 10 }]],
    ['texto JSON ("x")', '"x"', [{ equalToJson: '"x"' }]],
    ['JSON malformado', '{"a":', [{ equals: '{"a":' }]],
    ['texto de exatamente 10 KiB', 'a'.repeat(10240), [{ equals: 'a'.repeat(10240) }]],
    ['texto de 10 KiB + 1 byte', 'a'.repeat(10241), []],
    // 5121 × "é" = 10242 bytes em UTF-8, embora sejam só 5121 caracteres.
    ['texto de 10 KiB em bytes UTF-8', 'é'.repeat(5121), []],
  ])('deve montar a condição de corpo Quando o corpo é %s', (_caso, content, esperado) => {
    expect(ruleFromRequest(webhookRequest(1, { content })).match?.body).toEqual(esperado);
  });

  it('deve cortar o nome em 100 caracteres Quando o caminho é longo', () => {
    const regra = ruleFromRequest(webhookRequest(1, { url: `${BASE}/${'x'.repeat(200)}` }));

    expect(regra.name).toHaveLength(100);
    expect(regra.name.startsWith('POST /xxx')).toBe(true);
    expect(regra.match?.path).toEqual({ equals: `/${'x'.repeat(200)}` });
  });
});
