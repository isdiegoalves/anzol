import {
  CHAVES_TOKEN, bugDoLegado, JSON_ACCEPT, UUID, expect, expectContentType, expectDataUtcRecente, expectErroJson,
  test, type Token,
} from '../../support/contrato.js';

test.describe('POST /token', () => {
  test('sem campos: 201 com os padrões e exatamente as chaves do token', async ({ request, tokens }) => {
    const res = await request.post('/token', { headers: { ...JSON_ACCEPT, 'User-Agent': 'contrato/1.0' } });
    expect(res.status()).toBe(201);
    expectContentType(res, 'application/json');
    const token = (await res.json()) as Token;
    tokens.registrar(token.uuid);

    expect(Object.keys(token).sort()).toEqual(CHAVES_TOKEN);
    expect(token.uuid).toMatch(UUID);
    expect(typeof token.ip).toBe('string');
    expect(token.ip.length).toBeGreaterThan(0);
    expect(token).toMatchObject({
      user_agent: 'contrato/1.0',
      default_content: '',
      default_status: 200,
      default_content_type: 'text/plain',
      timeout: 0,
      cors: false,
      retry_after: null,
      auto_cleanup: null,
    });
    expectDataUtcRecente(token.created_at, res);
    expect(token.updated_at).toBe(token.created_at);
  });

  test('com todos os campos em JSON: tipos preservados (status e timeout inteiros)', async ({ tokens }) => {
    const token = await tokens.criar({
      default_content: '{"ok":true} olá',
      default_status: 201,
      default_content_type: 'application/json',
      timeout: 2,
    });
    expect(token).toMatchObject({
      default_content: '{"ok":true} olá',
      default_status: 201,
      default_content_type: 'application/json',
      timeout: 2,
      cors: false,
    });
  });

  test('números em string (como o front manda) viram inteiros', async ({ tokens }) => {
    const token = await tokens.criar({ default_status: '202', timeout: '3' });
    expect(token.default_status).toBe(202);
    expect(token.timeout).toBe(3);
  });

  test('corpo de formulário também cria o token', async ({ request, tokens }) => {
    const res = await request.post('/token', {
      headers: JSON_ACCEPT,
      form: { default_status: '203', timeout: '1', default_content: 'form', default_content_type: 'text/html' },
    });
    expect(res.status()).toBe(201);
    const token = (await res.json()) as Token;
    tokens.registrar(token.uuid);
    expect(token).toMatchObject({ default_status: 203, timeout: 1, default_content: 'form', default_content_type: 'text/html' });
  });

  test('campos na query string também valem', async ({ request, tokens }) => {
    const res = await request.post('/token?default_status=204&default_content=q', { headers: JSON_ACCEPT });
    expect(res.status()).toBe(201);
    const token = (await res.json()) as Token;
    tokens.registrar(token.uuid);
    expect(token).toMatchObject({ default_status: 204, default_content: 'q' });
  });

  test('uuid, cors e campos desconhecidos enviados pelo cliente são ignorados', async ({ tokens }) => {
    const token = await tokens.criar({ uuid: 'meu-id', cors: true, created_at: 'x', extra: 1 });
    expect(token.uuid).toMatch(UUID);
    expect(token.cors).toBe(false);
    expect(token.created_at).not.toBe('x');
    expect(token).not.toHaveProperty('extra');
  });

  test('sem validação de faixa em default_status (999 é aceito na criação)', async ({ tokens }) => {
    const token = await tokens.criar({ default_status: 999 });
    expect(token.default_status).toBe(999);
  });

  test('timeout e content-type vazios: timeout vira 0, content-type fica vazio', async ({ tokens }) => {
    const token = await tokens.criar({ timeout: '', default_content_type: '' });
    expect(token.timeout).toBe(0);
    expect(token.default_content_type).toBe('');
  });
});

test.describe('validação (cliente JSON) → 422 {campo: [mensagem]}', () => {
  const casos: Array<[string, Record<string, unknown>, Record<string, string[]>]> = [
    ['timeout acima de 10', { timeout: 11 }, { timeout: ['The timeout may not be greater than 10.'] }],
    ['timeout "11" em string', { timeout: '11' }, { timeout: ['The timeout may not be greater than 10.'] }],
    ['timeout negativo', { timeout: -1 }, { timeout: ['The timeout must be at least 0.'] }],
    ['timeout não inteiro', { timeout: 'abc' }, { timeout: ['The timeout must be an integer.'] }],
    ['timeout fracionário', { timeout: 1.5 }, { timeout: ['The timeout must be an integer.'] }],
    ['timeout null', { timeout: null }, { timeout: ['The timeout must be an integer.'] }],
    ['default_status não inteiro', { default_status: 'abc' }, { default_status: ['The default status must be an integer.'] }],
    ['default_content número', { default_content: 123 }, { default_content: ['The default content must be a string.'] }],
    ['default_content lista', { default_content: ['a'] }, { default_content: ['The default content must be a string.'] }],
    ['default_content null', { default_content: null }, { default_content: ['The default content must be a string.'] }],
    ['default_content_type número', { default_content_type: 5 }, { default_content_type: ['The default content type must be a string.'] }],
    [
      'vários campos de uma vez',
      { timeout: 11, default_status: 'x', default_content: 1, default_content_type: 2 },
      {
        default_content: ['The default content must be a string.'],
        default_content_type: ['The default content type must be a string.'],
        default_status: ['The default status must be an integer.'],
        timeout: ['The timeout may not be greater than 10.'],
      },
    ],
  ];

  for (const [nome, corpo, erros] of casos) {
    test(`POST /token: ${nome}`, async ({ request }) => {
      const res = await request.post('/token', { data: corpo, headers: JSON_ACCEPT });
      expect(res.status()).toBe(422);
      expectContentType(res, 'application/json');
      expect(await res.json()).toEqual(erros);
    });
  }

  test('default_status maior que um inteiro de 64 bits → 422', async ({ request, tokens }) => {
    // Literal cru: em JS 99999999999999999999 viraria 1e20 antes de sair.
    const res = await request.post('/token', {
      data: Buffer.from('{"default_status": 99999999999999999999}'),
      headers: { ...JSON_ACCEPT, 'Content-Type': 'application/json' },
    });
    if (res.status() === 201) tokens.registrar((await res.json()).uuid);
    expect(res.status()).toBe(422);
    expect(await res.json()).toEqual({ default_status: ['The default status must be an integer.'] });
  });

  test('limites aceitos: timeout 0 e 10', async ({ tokens }) => {
    expect((await tokens.criar({ timeout: 0 })).timeout).toBe(0);
    expect((await tokens.criar({ timeout: 10 })).timeout).toBe(10);
  });

  test('validação por formulário e por query string', async ({ request }) => {
    const form = await request.post('/token', { form: { timeout: '11' }, headers: JSON_ACCEPT });
    expect(form.status()).toBe(422);
    expect(await form.json()).toEqual({ timeout: ['The timeout may not be greater than 10.'] });
    const query = await request.post('/token?timeout=11', { headers: JSON_ACCEPT });
    expect(query.status()).toBe(422);
  });

  test('"cliente JSON" também é X-Requested-With e o Accept do AngularJS', async ({ request }) => {
    const xhr = await request.post('/token', { data: { timeout: 11 }, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    expect(xhr.status()).toBe(422);
    expect(await xhr.json()).toEqual({ timeout: ['The timeout may not be greater than 10.'] });
    const angular = await request.post('/token', { data: { timeout: 11 }, headers: { Accept: 'application/json, text/plain, */*' } });
    expect(angular.status()).toBe(422);
  });

  test('PUT /token/{id} valida com as mesmas regras', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_content: 'antes' });
    const res = await request.put(`/token/${token.uuid}`, { data: { timeout: 99 }, headers: JSON_ACCEPT });
    expect(res.status()).toBe(422);
    expect(await res.json()).toEqual({ timeout: ['The timeout may not be greater than 10.'] });
    const depois = await (await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).json();
    expect(depois.default_content).toBe('antes');
  });
});

test.describe('GET /token/{id}', () => {
  test('devolve o token como foi criado', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_content: 'c', default_status: 201, default_content_type: 'text/html', timeout: 1 });
    const res = await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT });
    expect(res.status()).toBe(200);
    expectContentType(res, 'application/json');
    expect(await res.json()).toEqual(token);
  });
});

test.describe('PUT /token/{id}', () => {
  test('substitui a configuração; campo ausente volta ao padrão; cors, ip, user_agent e datas ficam', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_content: 'x', default_status: 201, default_content_type: 'application/xml', timeout: 1 });
    const toggle = await request.put(`/token/${token.uuid}/cors/toggle`, { headers: JSON_ACCEPT });
    expect(await toggle.json()).toEqual({ enabled: true });

    const res = await request.put(`/token/${token.uuid}`, { data: { default_content: 'novo' }, headers: JSON_ACCEPT });
    expect(res.status()).toBe(200);
    expectContentType(res, 'application/json');
    const editado = (await res.json()) as Token;
    expect(editado).toEqual({
      ...token,
      default_content: 'novo',
      default_status: 200,
      default_content_type: 'text/plain',
      timeout: 0,
      cors: true,
    });
    // updated_at não é atualizado pela edição.
    expect(editado.updated_at).toBe(token.updated_at);

    const lido = await (await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).json();
    expect(lido).toEqual(editado);
  });

  test('aceita formulário e converte números', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const res = await request.put(`/token/${token.uuid}`, {
      form: { default_status: '204', timeout: '2', default_content_type: 'text/csv', default_content: 'a,b' },
      headers: JSON_ACCEPT,
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ default_status: 204, timeout: 2, default_content_type: 'text/csv', default_content: 'a,b' });
  });
});

test.describe('DELETE /token/{id}', () => {
  test('204 sem corpo e, depois, 410 em toda a API do token', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const res = await request.delete(`/token/${token.uuid}`, { headers: JSON_ACCEPT });
    expect(res.status()).toBe(204);
    expect((await res.body()).length).toBe(0);

    await expectErroJson(await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT }), 410, 'Token not found');
    await expectErroJson(await request.get(`/token/${token.uuid}/requests`, { headers: JSON_ACCEPT }), 410, 'Token not found');
    await expectErroJson(await request.put(`/token/${token.uuid}`, { data: {}, headers: JSON_ACCEPT }), 410, 'Token not found');
    await expectErroJson(await request.put(`/token/${token.uuid}/cors/toggle`, { headers: JSON_ACCEPT }), 410, 'Token not found');
    await expectErroJson(await request.delete(`/token/${token.uuid}`, { headers: JSON_ACCEPT }), 410, 'Token not found');
    await expectErroJson(await request.post(`/${token.uuid}`, { headers: JSON_ACCEPT }), 410, 'Token not found');
  });
});

test.describe('PUT /token/{id}/cors/toggle', () => {
  test('primeira chamada liga: 200 {enabled: true} e o token passa a ter cors: true', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const res = await request.put(`/token/${token.uuid}/cors/toggle`, { headers: JSON_ACCEPT });
    expect(res.status()).toBe(200);
    expectContentType(res, 'application/json');
    expect(await res.json()).toEqual({ enabled: true });
    const lido = await (await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).json();
    expect(lido.cors).toBe(true);
  });

  test('segunda chamada desliga', async ({ request, tokens }) => {
    // No app atual, `isset($token->cors)` num atributo mágico (Entity sem __isset) é sempre
    // falso, então o toggle sempre grava true: não há como desligar o CORS. Defeito acidental
    // (o front mostra "CORS disabled." quando enabled é false, caminho hoje inalcançável).
    // Nota: o PUT /token/{id} também preserva cors, então nenhum endpoint desliga.
    bugDoLegado('toggle de CORS nunca desliga no app atual (isset em propriedade mágica)');
    const token = await tokens.criar();
    await request.put(`/token/${token.uuid}/cors/toggle`, { headers: JSON_ACCEPT });
    const res = await request.put(`/token/${token.uuid}/cors/toggle`, { headers: JSON_ACCEPT });
    expect(await res.json()).toEqual({ enabled: false });
  });
});
