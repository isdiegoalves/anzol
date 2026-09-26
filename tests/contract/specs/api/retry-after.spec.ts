import type { APIRequestContext } from '@playwright/test';
import { JSON_ACCEPT, expect, expectContentType, test, type Token } from '../../support/contrato.js';

// `retry_after` por URL (plano de features, item 01): segundos (inteiro >= 0) ou data HTTP no
// formato IMF-fixdate (RFC 9110 §5.6.7 e §10.2.3). Preenchido, toda resposta do webhook leva
// `Retry-After` com o valor; nulo, nenhuma leva.

const DATA_HTTP = 'Wed, 21 Oct 2026 07:28:00 GMT';
const MENSAGEM = 'The retry after must be a number of seconds or an HTTP date.';

async function lerToken(request: APIRequestContext, uuid: string): Promise<Token> {
  const res = await request.get(`/token/${uuid}`, { headers: JSON_ACCEPT });
  expect(res.status()).toBe(200);
  return (await res.json()) as Token;
}

test.describe('retry_after no token', () => {
  const aceitos: Array<[string, unknown, number | string | null]> = [
    ['segundos como número', 120, 120],
    ['zero', 0, 0],
    ['segundos em string de dígitos (como o front manda) viram número', '120', 120],
    ['data HTTP IMF-fixdate fica como foi enviada', DATA_HTTP, DATA_HTTP],
    ['null explícito', null, null],
    ['string vazia vale como ausente', '', null],
  ];
  for (const [nome, enviado, esperado] of aceitos) {
    test(`POST /token aceita: ${nome}`, async ({ request, tokens }) => {
      const token = await tokens.criar({ retry_after: enviado });
      expect(token.retry_after).toBe(esperado);
      expect((await lerToken(request, token.uuid)).retry_after).toBe(esperado);
    });
  }

  test('ausente na criação: null', async ({ tokens }) => {
    expect((await tokens.criar()).retry_after).toBeNull();
  });

  test('formulário e query string também valem', async ({ request, tokens }) => {
    const form = await request.post('/token', { form: { retry_after: '30' }, headers: JSON_ACCEPT });
    expect(form.status()).toBe(201);
    const porForm = (await form.json()) as Token;
    tokens.registrar(porForm.uuid);
    expect(porForm.retry_after).toBe(30);

    const query = await request.post(`/token?retry_after=${encodeURIComponent(DATA_HTTP)}`, { headers: JSON_ACCEPT });
    expect(query.status()).toBe(201);
    const porQuery = (await query.json()) as Token;
    tokens.registrar(porQuery.uuid);
    expect(porQuery.retry_after).toBe(DATA_HTTP);
  });

  const recusados: Array<[string, unknown]> = [
    ['texto', 'abc'],
    ['negativo', -1],
    ['negativo em string', '-1'],
    ['fracionário', 1.5],
    ['fracionário em string', '1.5'],
    ['booleano', true],
    ['lista', [120]],
    ['data ISO 8601', '2026-10-21T07:28:00Z'],
    ['data HTTP com fuso que não é GMT', 'Wed, 21 Oct 2026 07:28:00 UTC'],
    ['data HTTP obsoleta (RFC 850)', 'Wednesday, 21-Oct-26 07:28:00 GMT'],
    ['data HTTP com dia inexistente', 'Wed, 32 Oct 2026 07:28:00 GMT'],
    ['data HTTP com dia da semana errado', 'Mon, 21 Oct 2026 07:28:00 GMT'],
  ];
  for (const [nome, valor] of recusados) {
    test(`POST /token recusa ${nome} → 422`, async ({ request, tokens }) => {
      const res = await request.post('/token', { data: { retry_after: valor }, headers: JSON_ACCEPT });
      if (res.status() === 201) tokens.registrar((await res.json()).uuid);
      expect(res.status()).toBe(422);
      expectContentType(res, 'application/json');
      expect(await res.json()).toEqual({ retry_after: [MENSAGEM] });
    });
  }

  test('erro junto com o de outro campo', async ({ request }) => {
    const res = await request.post('/token', { data: { retry_after: 'x', timeout: 11 }, headers: JSON_ACCEPT });
    expect(res.status()).toBe(422);
    expect(await res.json()).toEqual({
      retry_after: [MENSAGEM],
      timeout: ['The timeout may not be greater than 10.'],
    });
  });

  test('PUT troca o valor, PUT sem o campo volta a null e PUT inválido → 422 sem alterar', async ({ request, tokens }) => {
    const token = await tokens.criar({ retry_after: 120 });

    const trocado = await request.put(`/token/${token.uuid}`, { data: { retry_after: DATA_HTTP }, headers: JSON_ACCEPT });
    expect(trocado.status()).toBe(200);
    expect(((await trocado.json()) as Token).retry_after).toBe(DATA_HTTP);

    const invalido = await request.put(`/token/${token.uuid}`, { data: { retry_after: 'depois' }, headers: JSON_ACCEPT });
    expect(invalido.status()).toBe(422);
    expect(await invalido.json()).toEqual({ retry_after: [MENSAGEM] });
    expect((await lerToken(request, token.uuid)).retry_after).toBe(DATA_HTTP);

    const semCampo = await request.put(`/token/${token.uuid}`, { data: { default_content: 'x' }, headers: JSON_ACCEPT });
    expect(semCampo.status()).toBe(200);
    expect(((await semCampo.json()) as Token).retry_after).toBeNull();
    expect((await lerToken(request, token.uuid)).retry_after).toBeNull();
  });
});

test.describe('Retry-After na resposta do webhook', () => {
  test('segundos: GET, POST, PUT, PATCH, DELETE, HEAD e OPTIONS levam o cabeçalho', async ({ request, tokens }) => {
    const token = await tokens.criar({ retry_after: 120 });
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const res = await request.fetch(`/${token.uuid}`, { method });
      expect(res.status(), method).toBe(200);
      expect(res.headers()['retry-after'], method).toBe('120');
    }
  });

  test('zero segundos: Retry-After: 0', async ({ request, tokens }) => {
    const token = await tokens.criar({ retry_after: '0' });
    expect((await request.get(`/${token.uuid}`)).headers()['retry-after']).toBe('0');
  });

  test('data HTTP: o cabeçalho leva a data exatamente como configurada', async ({ request, tokens }) => {
    const token = await tokens.criar({ retry_after: DATA_HTTP });
    expect((await request.get(`/${token.uuid}/503`)).headers()['retry-after']).toBe(DATA_HTTP);
  });

  test('qualquer status: padrão do token e pelo caminho (429, 503, 301, 204, 304, 404)', async ({ request, tokens }) => {
    const token = await tokens.criar({ retry_after: 60, default_status: 429 });
    const padrao = await request.get(`/${token.uuid}`);
    expect(padrao.status()).toBe(429);
    expect(padrao.headers()['retry-after']).toBe('60');
    for (const status of [503, 301, 204, 304, 404]) {
      const res = await request.get(`/${token.uuid}/${status}`, { maxRedirects: 0 });
      expect(res.status()).toBe(status);
      expect(res.headers()['retry-after'], `status ${status}`).toBe('60');
    }
  });

  test('com CORS ligado: os 4 cabeçalhos de CORS e o Retry-After, inclusive no preflight', async ({ request, tokens }) => {
    const token = await tokens.criar({ retry_after: 5 });
    await request.put(`/token/${token.uuid}/cors/toggle`, { headers: JSON_ACCEPT });
    const preflight = await request.fetch(`/${token.uuid}`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://exemplo.test', 'Access-Control-Request-Method': 'POST' },
    });
    for (const res of [preflight, await request.post(`/${token.uuid}/503`)]) {
      expect(res.headers()['access-control-allow-origin']).toBe('*');
      expect(res.headers()['retry-after']).toBe('5');
    }
  });

  test('editar pelo PUT muda a próxima resposta; PUT sem o campo tira o cabeçalho', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect((await request.get(`/${token.uuid}/429`)).headers()).not.toHaveProperty('retry-after');

    await request.put(`/token/${token.uuid}`, { data: { retry_after: 30 }, headers: JSON_ACCEPT });
    expect((await request.get(`/${token.uuid}/429`)).headers()['retry-after']).toBe('30');

    await request.put(`/token/${token.uuid}`, { data: {}, headers: JSON_ACCEPT });
    expect((await request.get(`/${token.uuid}/429`)).headers()).not.toHaveProperty('retry-after');
  });

  test('sem retry_after nenhuma resposta tem o cabeçalho (429, 503, CORS, OPTIONS)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await request.put(`/token/${token.uuid}/cors/toggle`, { headers: JSON_ACCEPT });
    const respostas = [
      await request.get(`/${token.uuid}`),
      await request.get(`/${token.uuid}/429`),
      await request.post(`/${token.uuid}/503`),
      await request.fetch(`/${token.uuid}`, { method: 'OPTIONS' }),
      await request.head(`/${token.uuid}`),
    ];
    for (const res of respostas) expect(res.headers()).not.toHaveProperty('retry-after');
  });
});
