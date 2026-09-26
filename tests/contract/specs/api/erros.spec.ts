import { JSON_ACCEPT, expect, expectContentType, expectErroJson, test } from '../../support/contrato.js';

const TOKEN = '00000000-0000-4000-8000-000000000000';
const MSG = '11111111-1111-4111-8111-111111111111';

const ROTAS_DO_TOKEN: Array<[string, string]> = [
  ['GET', `/token/${TOKEN}`],
  ['PUT', `/token/${TOKEN}`],
  ['DELETE', `/token/${TOKEN}`],
  ['PUT', `/token/${TOKEN}/cors/toggle`],
  ['GET', `/token/${TOKEN}/requests`],
  ['GET', `/token/${TOKEN}/request/${MSG}`],
  ['GET', `/token/${TOKEN}/request/${MSG}/raw`],
  ['DELETE', `/token/${TOKEN}/request/${MSG}`],
  ['DELETE', `/token/${TOKEN}/request`],
  ['GET', `/${TOKEN}`],
  ['PATCH', `/${TOKEN}/404/x`],
];

test.describe('erros para cliente JSON: {success: false, error: {message, id}}', () => {
  for (const [metodo, caminho] of ROTAS_DO_TOKEN) {
    test(`token inexistente: ${metodo} ${caminho.replace(TOKEN, '{token}').replace(MSG, '{rid}')} → 410`, async ({ request }) => {
      await expectErroJson(await request.fetch(caminho, { method: metodo, headers: JSON_ACCEPT }), 410, 'Token not found');
    });
  }

  for (const [metodo, sufixo] of [['GET', ''], ['GET', '/raw'], ['DELETE', '']]) {
    test(`mensagem inexistente: ${metodo} /token/{id}/request/{rid}${sufixo} → 404`, async ({ request, tokens }) => {
      const token = await tokens.criar();
      await expectErroJson(
        await request.fetch(`/token/${token.uuid}/request/${MSG}${sufixo}`, { method: metodo, headers: JSON_ACCEPT }),
        404, 'Request not found',
      );
    });
  }

  test('rota inexistente → 404 com mensagem vazia', async ({ request, tokens }) => {
    const token = await tokens.criar();
    for (const caminho of ['/nao-existe', '/token/abc', `/token/${token.uuid}/request/nao-uuid`]) {
      await expectErroJson(await request.get(caminho, { headers: JSON_ACCEPT }), 404, '');
    }
  });

  test('método não permitido → 405 com mensagem vazia', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await expectErroJson(await request.get('/token', { headers: JSON_ACCEPT }), 405, '');
    await expectErroJson(await request.post(`/token/${token.uuid}`, { headers: JSON_ACCEPT }), 405, '');
    await expectErroJson(await request.delete(`/token/${token.uuid}/requests`, { headers: JSON_ACCEPT }), 405, '');
  });

  test('método não permitido em qualquer rota da API → 405 com o envelope', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const rotas: Array<[string, string]> = [
      ['PATCH', `/token/${token.uuid}/cors/toggle`],
      ['GET', `/token/${token.uuid}/cors/toggle`],
      ['PATCH', `/token/${TOKEN}/cors/toggle`],
      ['PATCH', '/token'],
      ['PUT', '/token'],
      ['PATCH', `/token/${token.uuid}`],
      ['POST', `/token/${token.uuid}/requests`],
      ['PATCH', `/token/${token.uuid}/request/${MSG}`],
      ['POST', `/token/${token.uuid}/request/${MSG}/raw`],
    ];
    for (const [metodo, caminho] of rotas) {
      await expectErroJson(await request.fetch(caminho, { method: metodo, headers: JSON_ACCEPT }), 405, '');
    }
  });

  test('corpo acima de 1 MiB numa rota da API → 413 e nada muda (a página vem do servidor, sem envelope)', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_content: 'antes' });
    const grande = `{"default_content":"${'a'.repeat(1024 * 1024)}"}`;
    const headers = { ...JSON_ACCEPT, 'Content-Type': 'application/json' };
    expect((await request.post('/token', { data: Buffer.from(grande), headers })).status()).toBe(413);
    expect((await request.put(`/token/${token.uuid}`, { data: Buffer.from(grande), headers })).status()).toBe(413);
    const depois = await (await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).json();
    expect(depois.default_content).toBe('antes');
  });

  test('"cliente JSON" também é X-Requested-With, Content-Type JSON e o Accept do AngularJS', async ({ request }) => {
    const variantes: Array<Record<string, string>> = [
      { 'X-Requested-With': 'XMLHttpRequest' },
      { 'Content-Type': 'application/json' },
      { Accept: 'application/json, text/plain, */*' },
    ];
    for (const headers of variantes) {
      await expectErroJson(await request.get(`/token/${TOKEN}`, { headers }), 410, 'Token not found');
    }
  });
});

test.describe('erros para cliente comum (HTML): só o status está no contrato', () => {
  for (const [metodo, caminho] of ROTAS_DO_TOKEN) {
    test(`token inexistente: ${metodo} ${caminho.replace(TOKEN, '{token}').replace(MSG, '{rid}')} → 410`, async ({ request }) => {
      const res = await request.fetch(caminho, { method: metodo, headers: { Accept: 'text/html' } });
      expect(res.status()).toBe(410);
    });
  }

  test('mensagem inexistente → 404; rota inexistente → 404; método errado → 405', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const html = { headers: { Accept: 'text/html' } };
    expect((await request.get(`/token/${token.uuid}/request/${MSG}`, html)).status()).toBe(404);
    expect((await request.get('/nao-existe', html)).status()).toBe(404);
    expect((await request.get('/token', html)).status()).toBe(405);
  });
});

test('GET / serve a página do app (HTML)', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  expectContentType(res, 'text/html; charset=UTF-8');
});
