import { randomUUID } from 'node:crypto';
import { JSON_ACCEPT, enviarEGuardar, expect, expectContentType, expectErroJson, listar, test } from '../../support/contrato.js';
import { erros422 } from '../../support/regras.js';
import { buscar, chamarBusca } from '../../support/busca.js';

// Validação de `POST /token/{id}/requests/search` (CA-4, plano "busca-filtro-diff" §1): 422 JSON no
// formato das regras (`{chave: [mensagem]}`, mensagem com a forma do Laravel) para `text` com mais de
// 200 caracteres, `per_page` fora de 1..100, `page` menor que 1 e `match` inválido (o parser e as chaves
// `match.<campo>` do `rules/test`); token inexistente ou apagado → 410 `Token not found`.

const FORMA_LARAVEL = /^[A-Z].*\.$/s;

async function expect422(
  request: Parameters<typeof chamarBusca>[0],
  tokenId: string,
  corpo: Record<string, unknown>,
  chave: RegExp,
): Promise<Record<string, string[]>> {
  const res = await chamarBusca(request, tokenId, corpo);
  const descricao = JSON.stringify(corpo).slice(0, 120);
  expect(res.status(), `${descricao}: ${(await res.text()).slice(0, 300)}`).toBe(422);
  expectContentType(res, 'application/json');
  const erros = await erros422(res);
  const chaves = Object.keys(erros);
  expect(chaves.some((k) => chave.test(k)), `${descricao}: nenhuma chave de ${JSON.stringify(erros)} casa ${chave}`).toBe(true);
  for (const k of chaves) {
    expect(Array.isArray(erros[k]) && erros[k].length > 0, `${descricao}: ${k} → ${JSON.stringify(erros[k])}`).toBe(true);
    for (const msg of erros[k]) expect(msg, `${descricao}: ${k}`).toMatch(FORMA_LARAVEL);
  }
  return erros;
}

test.describe('busca: validação (CA-4)', () => {
  test('text com mais de 200 caracteres → 422 em text; 200 é aceito', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await expect422(request, t, { text: 'a'.repeat(201) }, /^text$/);
    await expect422(request, t, { text: 'x'.repeat(1_000) }, /^text$/);
    expect(await buscar(request, t, { text: 'a'.repeat(200) })).toMatchObject({ data: [], total: 0 });
  });

  test('per_page fora de 1..100 ou não inteiro → 422 em per_page; 1 e 100 são aceitos', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const perPage of [0, 101, -1, 1_000, 1.5, 'abc', true]) {
      await expect422(request, t, { per_page: perPage }, /^per_page$/);
    }
    expect((await buscar(request, t, { per_page: 1 })).per_page).toBe(1);
    expect((await buscar(request, t, { per_page: 100 })).per_page).toBe(100);
  });

  test('page menor que 1 ou não inteiro → 422 em page; 1 e páginas além do fim são aceitas', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const page of [0, -1, 1.5, 'abc', true]) {
      await expect422(request, t, { page }, /^page$/);
    }
    expect((await buscar(request, t, { page: 1 })).current_page).toBe(1);
    expect(await buscar(request, t, { page: 99, per_page: 10 })).toMatchObject({ data: [], current_page: 99, is_last_page: true });
  });

  test('match com regex inválida → 422 com exatamente match.path.regex, como o rules/test', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const erros = await expect422(request, t, { match: { path: { regex: '([a-z' } } }, /^match\.path\.regex$/);
    expect(erros).toEqual({ 'match.path.regex': ['The regex is invalid.'] });
  });

  test('match inválido pelo parser das regras → 422 com a chave sob match', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await expect422(request, t, { match: { method: 'POST' } }, /^match\.method\b/);
    await expect422(request, t, { match: { headers: { 'X-A': {} } } }, /^match\.headers\b/);
    await expect422(request, t, { match: { headers: { 'X-A': { equals: 'a', contains: 'b' } } } }, /^match\.headers\b/);
    await expect422(request, t, { match: { query: { tipo: { regex: '(' } } } }, /^match\.query\b/);
    await expect422(request, t, { match: { body: [{ regex: '[' }] } }, /^match\.body\b/);
    await expect422(request, t, { match: { body: { contains: 'x' } } }, /^match\.body\b/);
    await expect422(request, t, { match: { signature: 'talvez' } }, /^match\.signature$/);
    await expect422(request, t, { match: { schema: 'talvez' } }, /^match\.schema$/);
    await expect422(request, t, { match: 'qualquer' }, /^match$/);
    await expect422(request, t, { match: 42 }, /^match$/);
  });

  test('um 422 não mexe nas mensagens da URL', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { msg } = await enviarEGuardar(request, t, '/a', { method: 'POST' });
    await expect422(request, t, { per_page: 0 }, /^per_page$/);
    await expect422(request, t, { match: { path: { regex: '(' } } }, /^match\.path\.regex$/);
    expect((await listar(request, t)).data.map((m) => m.uuid)).toEqual([msg.uuid]);
  });
});

test.describe('busca: token inexistente (CA-4)', () => {
  test('token que nunca existiu → 410 Token not found', async ({ request }) => {
    await expectErroJson(await chamarBusca(request, randomUUID(), { text: 'x' }), 410, 'Token not found');
    await expectErroJson(await chamarBusca(request, randomUUID(), {}), 410, 'Token not found');
  });

  test('token apagado → 410 Token not found', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await enviarEGuardar(request, t, '/a', { method: 'POST' });
    await request.delete(`/token/${t}/request`, { headers: JSON_ACCEPT });
    expect((await request.delete(`/token/${t}`, { headers: JSON_ACCEPT })).status()).toBe(204);
    await expectErroJson(await chamarBusca(request, t, { match: { method: ['POST'] } }), 410, 'Token not found');
  });
});
