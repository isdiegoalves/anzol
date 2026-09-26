import {
  JSON_ACCEPT, UUID, bugDoLegado, buscarMensagem, espera, expect, expectContentType, expectErroJson, test,
} from '../../support/contrato.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, PATCH, POST, OPTIONS',
  'access-control-allow-headers': 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range',
  'access-control-expose-headers': 'Content-Length,Content-Range',
};

test.describe('webhook /{token}: métodos', () => {
  for (const metodo of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    test(`${metodo} responde com o padrão do token e grava a mensagem`, async ({ request, tokens }) => {
      const token = await tokens.criar({ default_content: 'resposta' });
      const res = await request.fetch(`/${token.uuid}`, { method: metodo });
      expect(res.status()).toBe(200);
      expectContentType(res, 'text/plain; charset=UTF-8');
      expect(res.headers()['x-token-id']).toBe(token.uuid);
      const id = res.headers()['x-request-id'];
      expect(id).toMatch(UUID);
      expect(await res.text()).toBe(metodo === 'HEAD' ? '' : 'resposta');

      const msg = await buscarMensagem(request, token.uuid, id!);
      expect(msg.method).toBe(metodo);
      expect(msg.uuid).toBe(id);
      expect(msg.token_id).toBe(token.uuid);
    });
  }
});

test.describe('webhook: resposta configurada no token', () => {
  test('corpo, status e content-type do token; application/json sem charset', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_content: '{"olá":"mundo"}', default_status: 201, default_content_type: 'application/json' });
    const res = await request.post(`/${token.uuid}`);
    expect(res.status()).toBe(201);
    expectContentType(res, 'application/json');
    expect(await res.text()).toBe('{"olá":"mundo"}');
  });

  const tipos: Array<[string, string]> = [
    ['text/plain', 'text/plain; charset=UTF-8'],
    ['text/html', 'text/html; charset=UTF-8'],
    ['TEXT/PLAIN', 'text/plain; charset=UTF-8'],
    ['text/csv;foo=bar', 'text/csv; foo=bar; charset=UTF-8'],
    ['text/plain; charset=iso-8859-1', 'text/plain; charset=iso-8859-1'],
    ['application/json', 'application/json'],
    ['application/json; charset=utf-8', 'application/json; charset=utf-8'],
    ['application/xml', 'application/xml'],
    // nginx `charset utf-8` acrescenta charset aos charset_types padrão (inclui application/javascript).
    ['application/javascript', 'application/javascript; charset=utf-8'],
    ['application/rss+xml', 'application/rss+xml; charset=utf-8'],
    ['image/png', 'image/png'],
    ['lixo', 'lixo'],
  ];
  for (const [configurado, esperado] of tipos) {
    test(`content-type "${configurado}" → "${esperado}"`, async ({ request, tokens }) => {
      const token = await tokens.criar({ default_content_type: configurado, default_content: 'c' });
      const res = await request.post(`/${token.uuid}`);
      expectContentType(res, esperado);
    });
  }

  test('content-type vazio: resposta sem Content-Type', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_content_type: '', default_content: 'c' });
    const res = await request.get(`/${token.uuid}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toBe('');
    expect(await res.text()).toBe('c');
  });

  test('status 204: corpo vazio', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_status: 204, default_content: 'ignorado' });
    const res = await request.post(`/${token.uuid}`);
    expect(res.status()).toBe(204);
    expect((await res.body()).length).toBe(0);
    expect(res.headers()['x-request-id']).toMatch(UUID);
  });

  test('timeout de 1 s: a resposta leva pelo menos 1 s', async ({ request, tokens }) => {
    const token = await tokens.criar({ timeout: 1 });
    const inicio = Date.now();
    const res = await request.get(`/${token.uuid}`);
    expect(res.status()).toBe(200);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(1000);
  });

  test('timeout de 2 s: a mensagem é gravada depois da espera', async ({ request, tokens }) => {
    const token = await tokens.criar({ timeout: 2 });
    const inicio = Date.now();
    const res = await request.get(`/${token.uuid}`);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(2000);
    const msg = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
    const gravada = Date.parse(msg.created_at.replace(' ', 'T') + 'Z');
    const criado = Date.parse(token.created_at.replace(' ', 'T') + 'Z');
    expect(gravada - criado).toBeGreaterThanOrEqual(2000);
  });
});

test.describe('webhook: status pelo caminho', () => {
  const casos: Array<[string, number]> = [
    ['/404', 404],
    ['/201', 201],
    ['/599', 599],
    ['/500/', 500],
    ['/404/extra', 404],
    ['/600', 202],
    ['/20', 202],
    ['/abc/def?x=1', 202],
    ['/a/b/c/', 202],
  ];
  for (const [caminho, status] of casos) {
    test(`${caminho} → ${status} (padrão do token é 202) e grava`, async ({ request, tokens }) => {
      const token = await tokens.criar({ default_status: 202, default_content: 'corpo' });
      const res = await request.post(`/${token.uuid}${caminho}`);
      expect(res.status()).toBe(status);
      expectContentType(res, 'text/plain; charset=UTF-8');
      expect(await res.text()).toBe('corpo');
      expect(res.headers()['x-token-id']).toBe(token.uuid);
      const msg = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
      expect(new URL(msg.url).pathname).toBe(`/${token.uuid}${caminho.split('?')[0].replace(/\/$/, '')}`);
    });
  }

  test('segmento com mais de 3 dígitos (/12345) usa o padrão do token', async ({ request, tokens }) => {
    // No app atual o preg_match('/[1-5][0-9][0-9]/') não é ancorado: casa "123" dentro de
    // "12345" e usa o segmento inteiro como status → InvalidArgumentException → 500 (a mensagem
    // já foi gravada). A rota declara statusCode = [1-5][0-9][0-9]; o 500 é acidental.
    bugDoLegado('segmento /12345 derruba o app atual com 500');
    const token = await tokens.criar({ default_status: 202 });
    const res = await request.post(`/${token.uuid}/12345`);
    expect(res.status()).toBe(202);
  });

  test('status padrão fora da faixa HTTP (999) não derruba o webhook', async ({ request, tokens }) => {
    // O app atual aceita default_status 999 na criação e responde 500 no webhook
    // (Symfony rejeita o status). Crash acidental: o contrato só exige que não seja 500.
    bugDoLegado('default_status fora de 100–599 derruba o webhook do app atual com 500');
    const token = await tokens.criar({ default_status: 999 });
    const res = await request.post(`/${token.uuid}`);
    expect(res.status()).not.toBe(500);
  });
});

test.describe('webhook: CORS', () => {
  test('desligado: nenhum cabeçalho Access-Control-*', async ({ request, tokens }) => {
    const token = await tokens.criar();
    for (const metodo of ['OPTIONS', 'POST']) {
      const res = await request.fetch(`/${token.uuid}`, {
        method: metodo,
        headers: { Origin: 'http://exemplo.test', 'Access-Control-Request-Method': 'POST' },
      });
      expect(res.status()).toBe(200);
      for (const nome of Object.keys(CORS)) expect(res.headers()[nome]).toBeUndefined();
    }
  });

  test('ligado: os 4 cabeçalhos em todo método, inclusive no preflight e com status pelo caminho', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_content: 'x' });
    await request.put(`/token/${token.uuid}/cors/toggle`, { headers: JSON_ACCEPT });
    for (const [metodo, caminho] of [['OPTIONS', ''], ['GET', ''], ['POST', '/404'], ['DELETE', '/a/b']]) {
      const res = await request.fetch(`/${token.uuid}${caminho}`, {
        method: metodo,
        headers: { Origin: 'http://exemplo.test', 'Access-Control-Request-Method': 'POST' },
      });
      expect(res.status()).toBe(caminho === '/404' ? 404 : 200);
      expect(res.headers()).toMatchObject(CORS);
      expect(res.headers()['x-request-id']).toMatch(UUID);
    }
  });
});

test.describe('webhook: token inexistente e limites de transporte', () => {
  const inexistente = '00000000-0000-4000-8000-000000000000';

  test('cliente JSON: 410 com envelope de erro', async ({ request }) => {
    await expectErroJson(await request.get(`/${inexistente}`, { headers: JSON_ACCEPT }), 410, 'Token not found');
    await expectErroJson(await request.post(`/${inexistente}/404`, { headers: JSON_ACCEPT }), 410, 'Token not found');
  });

  test('cliente comum: 410 (corpo HTML fora do contrato)', async ({ request }) => {
    expect((await request.get(`/${inexistente}`)).status()).toBe(410);
    expect((await request.post(`/${inexistente}/a/b`, { data: 'x' })).status()).toBe(410);
  });

  test('corpo de exatamente 1 MiB é aceito e gravado inteiro', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const corpo = 'a'.repeat(1024 * 1024);
    const res = await request.post(`/${token.uuid}`, { data: corpo, headers: { 'Content-Type': 'text/plain' } });
    expect(res.status()).toBe(200);
    const msg = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
    expect(msg.content.length).toBe(corpo.length);
  });

  test('corpo acima de 1 MiB: 413 e nada é gravado', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const res = await request.post(`/${token.uuid}`, { data: 'a'.repeat(1024 * 1024 + 1), headers: { 'Content-Type': 'text/plain' } });
    expect(res.status()).toBe(413);
    await espera(200);
    const lista = await (await request.get(`/token/${token.uuid}/requests`, { headers: JSON_ACCEPT })).json();
    expect(lista.total).toBe(0);
  });
});
