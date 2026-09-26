import { JSON_ACCEPT, expect, expectErroJson, listar, test } from '../../support/contrato.js';

const LIMITE = 500;

test('limite de 500 mensagens por URL: a 501ª recebe 410 e não é gravada', async ({ request, tokens }) => {
  test.setTimeout(300_000);
  const token = await tokens.criar();

  // Envia em lotes para não afogar o servidor (e não brigar com os outros workers).
  const lote = 10;
  for (let i = 0; i < LIMITE; i += lote) {
    const respostas = await Promise.all(
      Array.from({ length: Math.min(lote, LIMITE - i) }, () => request.get(`/${token.uuid}`)),
    );
    for (const r of respostas) expect(r.status()).toBe(200);
  }
  expect((await listar(request, token.uuid, 'per_page=1')).total).toBe(LIMITE);

  await expectErroJson(
    await request.post(`/${token.uuid}`, { headers: JSON_ACCEPT }), 410, 'Too many requests, please create a new URL/token',
  );
  expect((await request.get(`/${token.uuid}/201`)).status()).toBe(410);
  expect((await listar(request, token.uuid, 'per_page=1')).total).toBe(LIMITE);

  // Apagar uma mensagem abre espaço para outra.
  const [primeira] = (await listar(request, token.uuid, 'per_page=1')).data;
  await request.delete(`/token/${token.uuid}/request/${primeira!.uuid}`, { headers: JSON_ACCEPT });
  expect((await request.get(`/${token.uuid}`)).status()).toBe(200);
  expect((await request.get(`/${token.uuid}`)).status()).toBe(410);
});
