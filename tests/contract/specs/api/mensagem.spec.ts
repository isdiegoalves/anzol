import {
  BASE_URL, CHAVES_MENSAGEM, JSON_ACCEPT, UUID, bugDoLegado, buscarMensagem, enviarEGuardar, expect,
  expectContentType, expectDataUtcRecente, expectErroJson, httpCru, listar, test,
} from '../../support/contrato.js';

const HOST = new URL(BASE_URL);

test.describe('mensagem gravada: forma', () => {
  test('GET simples: chaves, tipos, url, hostname, datas e cabeçalhos vazios de corpo', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { res, msg } = await enviarEGuardar(request, token.uuid, '', { method: 'GET', headers: { 'User-Agent': 'contrato/ua' } });

    expect(Object.keys(msg).sort()).toEqual([...CHAVES_MENSAGEM, 'request'].sort());
    expect(msg.uuid).toBe(res.headers()['x-request-id']);
    expect(msg.token_id).toBe(token.uuid);
    expect(typeof msg.ip).toBe('string');
    expect(msg.ip.length).toBeGreaterThan(0);
    expect(msg.hostname).toBe(HOST.hostname);
    expect(msg.method).toBe('GET');
    expect(msg.user_agent).toBe('contrato/ua');
    expect(msg.content).toBe('');
    expect(msg.query).toBeNull();
    expect(msg.request).toBeNull();
    expect(msg.url).toBe(`${HOST.origin}/${token.uuid}`);
    expectDataUtcRecente(msg.created_at, res);
    expect(msg.updated_at).toBe(msg.created_at);

    // Cabeçalhos: nome em minúsculas → lista de valores.
    for (const [nome, valores] of Object.entries(msg.headers)) {
      expect(nome).toBe(nome.toLowerCase());
      expect(Array.isArray(valores)).toBe(true);
    }
    expect(msg.headers['host']).toEqual([HOST.host]);
    expect(msg.headers['user-agent']).toEqual(['contrato/ua']);
    // Sem corpo, content-type e content-length aparecem mesmo assim, com valor vazio.
    expect(msg.headers['content-type']).toEqual(['']);
    expect(msg.headers['content-length']).toEqual(['']);
  });

  test('JSON com query: corpo cru, query como objeto e SEM a chave request', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const corpo = '{"k":"v","n":1}';
    const { msg } = await enviarEGuardar(request, token.uuid, '?a=1&b[]=2', {
      method: 'POST', data: Buffer.from(corpo), headers: { 'Content-Type': 'application/json' },
    });
    expect(msg.content).toBe(corpo);
    expect(msg.query).toEqual({ a: '1', b: ['2'] });
    expect(msg).not.toHaveProperty('request');
    expect(Object.keys(msg).sort()).toEqual(CHAVES_MENSAGEM);
    expect(msg.headers['content-type']).toEqual(['application/json']);
    expect(msg.headers['content-length']).toEqual([String(corpo.length)]);
    expect(msg.url).toBe(`${HOST.origin}/${token.uuid}?a=1&b%5B%5D=2`);
  });

  for (const tipo of ['application/json; charset=utf-8', 'application/vnd.api+json', 'text/json']) {
    test(`"${tipo}" conta como JSON: sem a chave request`, async ({ request, tokens }) => {
      const token = await tokens.criar();
      const { msg } = await enviarEGuardar(request, token.uuid, '', { method: 'POST', data: Buffer.from('{"x":1}'), headers: { 'Content-Type': tipo } });
      expect(msg).not.toHaveProperty('request');
      expect(msg.content).toBe('{"x":1}');
    });
  }

  test('JSON inválido é gravado cru, sem a chave request', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { res, msg } = await enviarEGuardar(request, token.uuid, '', {
      method: 'POST', data: Buffer.from('nao eh json {'), headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(200);
    expect(msg.content).toBe('nao eh json {');
    expect(msg).not.toHaveProperty('request');
  });

  test('corpo cru text/plain: content com o corpo, request null', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const corpo = 'olá ✓ \u0000 fim\nlinha 2';
    const { msg } = await enviarEGuardar(request, token.uuid, '', { method: 'POST', data: Buffer.from(corpo), headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    expect(msg.content).toBe(corpo);
    expect(msg.request).toBeNull();
    expect(msg.query).toBeNull();
  });

  test('formulário: request com os campos (sintaxe de array do PHP), query separada, content cru', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const corpo = 'f1=a&f2[]=b&f2[]=c&x=2&m[k]=v';
    const { msg } = await enviarEGuardar(request, token.uuid, '/abc?x=1&q=z', {
      method: 'POST', data: Buffer.from(corpo), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(msg.request).toEqual({ f1: 'a', f2: ['b', 'c'], x: '2', m: { k: 'v' } });
    expect(msg.query).toEqual({ q: 'z', x: '1' });
    expect(msg.content).toBe(corpo);
    expect(msg.url).toBe(`${HOST.origin}/${token.uuid}/abc?q=z&x=1`);
  });

  for (const metodo of ['PUT', 'PATCH', 'DELETE']) {
    test(`formulário em ${metodo} também preenche request`, async ({ request, tokens }) => {
      const token = await tokens.criar();
      const { msg } = await enviarEGuardar(request, token.uuid, '', {
        method: metodo, data: Buffer.from('a=1'), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      expect(msg.request).toEqual({ a: '1' });
      expect(msg.content).toBe('a=1');
    });
  }

  test('multipart: request só com os campos de texto, arquivos descartados, content vazio', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '', {
      method: 'POST',
      multipart: { campo: 'valor', arq: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('conteudo') } },
    });
    expect(msg.request).toEqual({ campo: 'valor' });
    expect(msg.content).toBe('');
    expect(msg.headers['content-type']![0]).toMatch(/^multipart\/form-data; boundary=/);
  });

  test('query: último valor repetido vence, "+" é espaço, chave sem valor é "", arrays do PHP; url reordenada', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid,
      '?z=1&a=2&a=3&sp=a%20b&plus=a+b&e=&flag&arr[x]=1&arr[y]=2&%C3%A7=%C3%A3', { method: 'GET' });
    expect(msg.query).toEqual({ z: '1', a: '3', sp: 'a b', plus: 'a b', e: '', flag: '', arr: { x: '1', y: '2' }, 'ç': 'ã' });
    // A url guarda a query normalizada: pares ordenados pela chave, re-codificados (%20, %5B%5D).
    expect(msg.url).toBe(
      `${HOST.origin}/${token.uuid}?a=2&a=3&arr%5Bx%5D=1&arr%5By%5D=2&e=&flag&plus=a%20b&sp=a%20b&z=1&%C3%A7=%C3%A3`,
    );
  });

  test('caminho extra: barra final some da url', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '/a/b/c/?x=1', { method: 'GET' });
    expect(msg.url).toBe(`${HOST.origin}/${token.uuid}/a/b/c?x=1`);
  });

  test('cabeçalho com underscore é gravado com hífen (#160)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '', { method: 'GET', headers: { X_Custom_Under: 'v1' } });
    expect(msg.headers['x-custom-under']).toEqual(['v1']);
    expect(msg.headers).not.toHaveProperty('x_custom_under');
  });

  test('HTTP cru: cabeçalho repetido fica com o último valor; valor vazio vira [""]; sem User-Agent → null', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const res = await httpCru([
      `GET /${token.uuid}/cru HTTP/1.1`,
      'X-Dup: a',
      'X-Dup: b',
      'X-Mixed_Case-Under: Val',
      'X-Vazio:',
    ]);
    expect(res.status).toBe(200);
    const msg = await buscarMensagem(request, token.uuid, res.headers['x-request-id']!);
    expect(msg.headers['x-dup']).toEqual(['b']);
    expect(msg.headers['x-mixed-case-under']).toEqual(['Val']);
    expect(msg.headers['x-vazio']).toEqual(['']);
    expect(msg.user_agent).toBeNull();
    expect(msg.headers).not.toHaveProperty('user-agent');
  });

  test('X-Forwarded-* não altera ip, hostname nem url', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg: direto } = await enviarEGuardar(request, token.uuid, '', { method: 'GET' });
    const { msg } = await enviarEGuardar(request, token.uuid, '', {
      method: 'GET',
      headers: { 'X-Forwarded-For': '10.1.2.3', 'X-Forwarded-Host': 'outro.test', 'X-Forwarded-Proto': 'https' },
    });
    expect(msg.ip).toBe(direto.ip);
    expect(msg.hostname).toBe(HOST.hostname);
    expect(msg.url).toBe(`${HOST.origin}/${token.uuid}`);
    expect(msg.headers['x-forwarded-for']).toEqual(['10.1.2.3']);
  });

  test('corpo binário (UTF-8 inválido) é aceito', async ({ request, tokens }) => {
    // No app atual json_encode falha com UTF-8 inválido: grava "" na hash (a mensagem vira
    // fantasma: conta no total, some da listagem) e o broadcast estoura em 500. Acidental.
    bugDoLegado('corpo com UTF-8 inválido derruba o webhook do app atual com 500');
    const token = await tokens.criar();
    const res = await request.post(`/${token.uuid}`, {
      data: Buffer.from([0xff, 0xfe, 0x00, 0x41]), headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(res.status()).toBe(200);
  });
});

test.describe('GET /token/{id}/request/{rid}', () => {
  test('igual ao item da listagem', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { res, msg } = await enviarEGuardar(request, token.uuid, '?q=1', { method: 'POST', form: { a: 'b' } });
    const unico = await request.get(`/token/${token.uuid}/request/${msg.uuid}`, { headers: JSON_ACCEPT });
    expectContentType(unico, 'application/json');
    expect(res.status()).toBe(200);
    const lista = await listar(request, token.uuid);
    expect(lista.data).toEqual([msg]);
  });

  test('mensagem de outro token: 404', async ({ request, tokens }) => {
    const a = await tokens.criar();
    const b = await tokens.criar();
    const { msg } = await enviarEGuardar(request, a.uuid, '', { method: 'GET' });
    await expectErroJson(await request.get(`/token/${b.uuid}/request/${msg.uuid}`, { headers: JSON_ACCEPT }), 404, 'Request not found');
  });
});

test.describe('GET /token/{id}/request/{rid}/raw', () => {
  const casos: Array<[string, string | undefined, string, string]> = [
    ['application/json exato', 'application/json', '{"a":1}', 'application/json'],
    ['JSON com charset', 'application/json; charset=utf-8', '{"a":1}', 'text/plain; charset=UTF-8'],
    ['+json', 'application/vnd.api+json', '{"a":1}', 'text/plain; charset=UTF-8'],
    ['texto', 'text/plain', 'corpo cru', 'text/plain; charset=UTF-8'],
    ['formulário', 'application/x-www-form-urlencoded', 'a=1&b=2', 'text/plain; charset=UTF-8'],
  ];
  for (const [nome, tipo, corpo, esperado] of casos) {
    test(`${nome} → ${esperado}`, async ({ request, tokens }) => {
      const token = await tokens.criar();
      const { msg } = await enviarEGuardar(request, token.uuid, '', { method: 'POST', data: Buffer.from(corpo), headers: { 'Content-Type': tipo! } });
      const res = await request.get(`/token/${token.uuid}/request/${msg.uuid}/raw`);
      expect(res.status()).toBe(200);
      expectContentType(res, esperado);
      expect(await res.text()).toBe(corpo);
    });
  }

  test('GET sem corpo → corpo vazio em text/plain', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '', { method: 'GET' });
    const res = await request.get(`/token/${token.uuid}/request/${msg.uuid}/raw`);
    expect(res.status()).toBe(200);
    expectContentType(res, 'text/plain; charset=UTF-8');
    expect(await res.text()).toBe('');
  });
});

test.describe('DELETE de mensagens', () => {
  test('uma: {status: true}; depois 404 ao ler e ao apagar de novo; total diminui', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '', { method: 'GET' });
    await enviarEGuardar(request, token.uuid, '', { method: 'GET' });

    const res = await request.delete(`/token/${token.uuid}/request/${msg.uuid}`, { headers: JSON_ACCEPT });
    expect(res.status()).toBe(200);
    expectContentType(res, 'application/json');
    expect(await res.json()).toEqual({ status: true });

    await expectErroJson(await request.get(`/token/${token.uuid}/request/${msg.uuid}`, { headers: JSON_ACCEPT }), 404, 'Request not found');
    await expectErroJson(await request.delete(`/token/${token.uuid}/request/${msg.uuid}`, { headers: JSON_ACCEPT }), 404, 'Request not found');
    expect((await listar(request, token.uuid)).total).toBe(1);
  });

  test('todas: {status: true}; de novo, sem nada: {status: false}; o token continua', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await enviarEGuardar(request, token.uuid, '', { method: 'GET' });
    await enviarEGuardar(request, token.uuid, '', { method: 'POST' });

    const res = await request.delete(`/token/${token.uuid}/request`, { headers: JSON_ACCEPT });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: true });
    const vazio = await request.delete(`/token/${token.uuid}/request`, { headers: JSON_ACCEPT });
    expect(vazio.status()).toBe(200);
    expect(await vazio.json()).toEqual({ status: false });

    const lista = await listar(request, token.uuid);
    expect(lista.total).toBe(0);
    expect(lista.data).toEqual([]);
    expect((await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).status()).toBe(200);
  });

  test('uuid da mensagem nos cabeçalhos bate com a gravada', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const res = await request.post(`/${token.uuid}`);
    expect(res.headers()['x-request-id']).toMatch(UUID);
    const lista = await listar(request, token.uuid);
    expect(lista.data.map((m) => m.uuid)).toEqual([res.headers()['x-request-id']]);
  });
});
