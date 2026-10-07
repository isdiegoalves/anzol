import { DATA_HORA, type Token } from '../../support/contrato.js';
import { comSegredo, expect, http, test } from '../../support/privacidade.js';

// Chaves de cifra da URL (plano "e2ee-lab", R1). `POST /token/{id}/keys` (`{"kid"?}`) gera um par EC P-256 no
// servidor e devolve só a pública; até 2 por URL (rotação v1/v2), 422 em `keys` acima disso e em `kid` repetido ou
// fora de `[A-Za-z0-9._-]{1,64}`. `DELETE /token/{id}/keys/{kid}` → 204 (404 sem a chave). `GET
// /token/{id}/jwks.json` é público, mesmo na URL protegida: só as públicas, com `use=enc` e `alg=ECDH-ES`.

interface Chave {
  kid: string;
  created_at: string;
  jwk: Record<string, unknown>;
}

test.describe('chaves de cifra e JWKS', () => {
  test('gera sem kid: 201 com a pública, kid enc-<data>-<hex>, e aparece no token', async ({ urls }) => {
    const { uuid, segredo } = await urls.proteger();
    const res = await http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: {} });
    expect(res.status, res.texto).toBe(201);
    const chave = res.json<Chave>();
    expect(chave.kid).toMatch(/^enc-\d{8}-[0-9a-f]{4}$/);
    expect(chave.created_at).toMatch(DATA_HORA);
    expect(chave.jwk).toMatchObject({ kty: 'EC', crv: 'P-256', use: 'enc', alg: 'ECDH-ES', kid: chave.kid });
    expect(chave.jwk).not.toHaveProperty('d');

    const token = (await http('GET', `/token/${uuid}`, { headers: comSegredo(segredo) })).json<Token>();
    expect(token.e2ee_keys).toEqual([chave]);
  });

  test('URL sem chaves: e2ee_keys vazio e JWKS vazio', async ({ urls }) => {
    const token = await urls.abrir();
    expect(token.e2ee_keys).toEqual([]);
    expect((await http('GET', `/token/${token.uuid}/jwks.json`)).json()).toEqual({ keys: [] });
  });

  test('JWKS da URL protegida responde sem segredo, só com as públicas, na ordem de criação', async ({ urls }) => {
    const { uuid, segredo } = await urls.proteger();
    for (const kid of ['enc-v1', 'enc-v2']) {
      expect((await http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: { kid } })).status).toBe(201);
    }
    const res = await http('GET', `/token/${uuid}/jwks.json`);
    expect(res.status).toBe(200);
    const { keys } = res.json<{ keys: Record<string, unknown>[] }>();
    expect(keys.map((k) => k.kid)).toEqual(['enc-v1', 'enc-v2']);
    for (const k of keys) expect(k).not.toHaveProperty('d');
  });

  test('terceira chave → 422 em keys; kid repetido ou inválido → 422 em kid', async ({ urls }) => {
    const { uuid, segredo } = await urls.proteger();
    const gerar = (kid: string) => http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: { kid } });
    expect((await gerar('enc-v1')).status).toBe(201);
    const repetido = await gerar('enc-v1');
    expect(repetido.status).toBe(422);
    expect(repetido.json<object>()).toHaveProperty('kid');
    const invalido = await gerar('enc v1/2');
    expect(invalido.status).toBe(422);
    expect(invalido.json<object>()).toHaveProperty('kid');
    expect((await gerar('enc-v2')).status).toBe(201);
    const terceira = await gerar('enc-v3');
    expect(terceira.status).toBe(422);
    expect(terceira.json<object>()).toHaveProperty('keys');
  });

  test('apagar: 204 e sai do JWKS; de novo, 404', async ({ urls }) => {
    const { uuid, segredo } = await urls.proteger();
    await http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: { kid: 'enc-v1' } });
    expect((await http('DELETE', `/token/${uuid}/keys/enc-v1`, { headers: comSegredo(segredo) })).status).toBe(204);
    expect((await http('DELETE', `/token/${uuid}/keys/enc-v1`, { headers: comSegredo(segredo) })).status).toBe(404);
    expect((await http('GET', `/token/${uuid}/jwks.json`)).json()).toEqual({ keys: [] });
  });

  test('gerar e apagar sem segredo na URL protegida → 401', async ({ urls }) => {
    const { uuid } = await urls.proteger();
    expect((await http('POST', `/token/${uuid}/keys`, { corpo: {} })).status).toBe(401);
    expect((await http('DELETE', `/token/${uuid}/keys/x`)).status).toBe(401);
  });

  test('PUT da configuração mantém as chaves', async ({ urls }) => {
    const { uuid, segredo } = await urls.proteger();
    await http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: { kid: 'enc-v1' } });
    const res = await http('PUT', `/token/${uuid}`, { headers: comSegredo(segredo), corpo: { default_status: 201 } });
    expect(res.json<Token>().e2ee_keys.map((k) => k.kid)).toEqual(['enc-v1']);
  });

  test('JWKS de URL inexistente → 410', async ({ urls }) => {
    const token = await urls.abrir();
    await http('DELETE', `/token/${token.uuid}`);
    expect((await http('GET', `/token/${token.uuid}/jwks.json`)).status).toBe(410);
  });
});
