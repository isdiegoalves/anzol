import { randomUUID } from 'node:crypto';
import { enviarEGuardar, expect, expectContentType, expectErroJson, JSON_ACCEPT, test } from '../../support/contrato.js';
import { erros422 } from '../../support/regras.js';
import { chamarEspera, esperar } from '../../support/espera.js';

// Validação de `POST /token/{id}/requests/wait` (CA-5): `match` pelo mesmo parser das regras (422 com
// as chaves `match.<campo>…`, como o `rules/test`); `after` (inteiro ≥ 0), `count` (1..100) e
// `timeout` (0..300000) com a chave do próprio campo; token inexistente ou apagado → 410. O 422 tem
// o formato das regras: `{chave: [mensagem]}`, mensagem com a forma do Laravel (maiúscula no início,
// ponto no fim). Um 422 responde na hora, sem esperar o prazo pedido.

const FORMA_LARAVEL = /^[A-Z].*\.$/;

async function expect422(
  request: Parameters<typeof chamarEspera>[0],
  tokenId: string,
  corpo: Record<string, unknown>,
  chave: RegExp,
): Promise<Record<string, string[]>> {
  const { res, ms } = await chamarEspera(request, tokenId, { timeout: 20_000, ...corpo });
  const descricao = JSON.stringify(corpo);
  expect(res.status(), `${descricao}: ${(await res.text()).slice(0, 300)}`).toBe(422);
  expectContentType(res, 'application/json');
  expect(ms, `${descricao}: o 422 não espera o prazo`).toBeLessThan(5_000);
  const erros = await erros422(res);
  const chaves = Object.keys(erros);
  expect(chaves.some((k) => chave.test(k)), `${descricao}: nenhuma chave de ${JSON.stringify(erros)} casa ${chave}`).toBe(true);
  for (const k of chaves) {
    expect(Array.isArray(erros[k]) && erros[k].length > 0, `${descricao}: ${k} → ${JSON.stringify(erros[k])}`).toBe(true);
    for (const msg of erros[k]) expect(msg, `${descricao}: ${k}`).toMatch(FORMA_LARAVEL);
  }
  return erros;
}

test.describe('wait-for: validação (CA-5)', () => {
  test('match com regex inválida → 422 com exatamente match.path.regex, como o rules/test', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const erros = await expect422(request, token.uuid, { match: { path: { regex: '([a-z' } } }, /^match\.path\.regex$/);
    expect(erros).toEqual({ 'match.path.regex': ['The regex is invalid.'] });
  });

  test('match inválido pelo parser das regras → 422 com a chave sob match', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await expect422(request, token.uuid, { match: { method: 'POST' } }, /^match\.method\b/);
    await expect422(request, token.uuid, { match: { headers: { 'X-A': {} } } }, /^match\.headers\b/);
    await expect422(request, token.uuid, { match: { headers: { 'X-A': { equals: 'a', contains: 'b' } } } }, /^match\.headers\b/);
    await expect422(request, token.uuid, { match: { query: { tipo: { regex: '(' } } } }, /^match\.query\b/);
    await expect422(request, token.uuid, { match: { body: [{ regex: '[' }] } }, /^match\.body\b/);
    await expect422(request, token.uuid, { match: { body: { contains: 'x' } } }, /^match\.body\b/);
    await expect422(request, token.uuid, { match: { signature: 'talvez' } }, /^match\.signature$/);
    await expect422(request, token.uuid, { match: 'qualquer' }, /^match$/);
    await expect422(request, token.uuid, { match: 42 }, /^match$/);
  });

  test('count fora de 1..100 ou não inteiro → 422 em count', async ({ request, tokens }) => {
    const token = await tokens.criar();
    for (const count of [0, 101, -1, 1.5, 'abc', true]) {
      await expect422(request, token.uuid, { count }, /^count$/);
    }
  });

  test('timeout fora de 0..300000 ou não inteiro → 422 em timeout', async ({ request, tokens }) => {
    const token = await tokens.criar();
    for (const timeout of [-1, 300_001, 1.5, 'abc', true]) {
      await expect422(request, token.uuid, { timeout }, /^timeout$/);
    }
  });

  test('after negativo ou não inteiro → 422 em after', async ({ request, tokens }) => {
    const token = await tokens.criar();
    for (const after of [-1, 1.5, 'abc', true]) {
      await expect422(request, token.uuid, { after }, /^after$/);
    }
  });

  test('os limites valem: count 1 e 100, timeout 0 e 300000, after 0', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '/a', { method: 'POST' });

    // Histórico casando: o prazo máximo é aceito e a resposta vem na hora.
    const maximo = await esperar(request, token.uuid, { count: 1, timeout: 300_000, after: 0 });
    expect(maximo.ms).toBeLessThan(3_000);
    expect(maximo.resultado.matched).toBe(true);
    expect(maximo.resultado.requests.map((m) => m.uuid)).toEqual([msg.uuid]);

    const cem = await esperar(request, token.uuid, { count: 100, timeout: 0 });
    expect(cem.resultado).toMatchObject({ matched: false, count: 1 });
  });

  test('um 422 não mexe nas mensagens da URL', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await enviarEGuardar(request, token.uuid, '/a', { method: 'POST' });
    await expect422(request, token.uuid, { count: 0 }, /^count$/);
    const { resultado } = await esperar(request, token.uuid, { timeout: 0 });
    expect(resultado.count).toBe(1);
  });
});

test.describe('wait-for: token inexistente (CA-5)', () => {
  test('token que nunca existiu → 410 Token not found', async ({ request }) => {
    const { res } = await chamarEspera(request, randomUUID(), { match: {}, timeout: 1_000 });
    await expectErroJson(res, 410, 'Token not found');
  });

  test('token apagado → 410 Token not found', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await enviarEGuardar(request, token.uuid, '/a', { method: 'POST' });
    await request.delete(`/token/${token.uuid}/request`, { headers: JSON_ACCEPT });
    expect((await request.delete(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).status()).toBe(204);
    const { res } = await chamarEspera(request, token.uuid, { timeout: 0 });
    await expectErroJson(res, 410, 'Token not found');
  });
});
