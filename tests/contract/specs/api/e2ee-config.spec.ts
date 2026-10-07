import { CHAVES_TOKEN, type Token } from '../../support/contrato.js';
import { AUDIENCIA, foraDaCurva, parEc, politica } from '../../support/e2ee.js';
import { comSegredo, expect, http, novoSegredo, test } from '../../support/privacidade.js';

// Bloco `e2ee` da URL (plano "e2ee-lab", R0). Objeto ou `null`, no `POST /token` e no `PUT /token/{id}` como o
// `schema`: ausente no `PUT` desliga. Exige segredo de leitura na URL (o texto aberto só sai com acesso). Só chaves
// públicas de assinatura em `trusted_signers`: com `d`, fora da curva, sem `kid`, de outra curva ou de outro
// algoritmo → 422 em `e2ee.trusted_signers.<n>`.

test.describe('e2ee no POST e no PUT /token', () => {
  test('URL protegida com e2ee: 201 com o bloco e os padrões, só a pública, e o GET igual', async ({ urls }) => {
    const remetente = await parEc('remetente-sig-1');
    const { uuid, segredo, token } = await urls.proteger({ e2ee: politica([remetente.publica]) });

    expect(Object.keys(token).sort()).toEqual(CHAVES_TOKEN);
    const e2ee = token.e2ee as Record<string, any>;
    expect(e2ee).toMatchObject({ path: '$.payload', required: true, audience: AUDIENCIA, max_age_seconds: 43_200 });
    expect(e2ee.bindings).toEqual({ jti: '$.eventId', evt: '$.tipoEvento.nome', app: { path: '$.servico.nome', ignore_case: true } });
    expect(e2ee.trusted_signers).toHaveLength(1);
    expect(e2ee.trusted_signers[0]).toMatchObject({ kty: 'EC', crv: 'P-256', kid: 'remetente-sig-1' });
    expect(e2ee.trusted_signers[0]).not.toHaveProperty('d');

    const lido = await http('GET', `/token/${uuid}`, { headers: comSegredo(segredo) });
    expect(lido.json<Token>().e2ee).toEqual(e2ee);
  });

  test('URL sem e2ee: e2ee null', async ({ urls }) => {
    expect(await urls.abrir()).toHaveProperty('e2ee', null);
  });

  test('e2ee sem segredo de leitura → 422 em e2ee, e nada é criado', async () => {
    const remetente = await parEc('sig');
    const res = await http('POST', '/token', { corpo: { e2ee: politica([remetente.publica]) } });
    expect(res.status, res.texto).toBe(422);
    expect(Object.keys(res.json<object>())).toEqual(['e2ee']);
  });

  test('PUT que remove o segredo de leitura com e2ee ligado → 422', async ({ urls }) => {
    const remetente = await parEc('sig');
    const e2ee = politica([remetente.publica]);
    const { uuid, segredo } = await urls.proteger({ e2ee });

    const res = await http('PUT', `/token/${uuid}`, { headers: comSegredo(segredo), corpo: { e2ee, read_secret: null } });
    expect(res.status, res.texto).toBe(422);
    expect(res.json<object>()).toHaveProperty('e2ee');
    expect((await http('GET', `/token/${uuid}`, { headers: comSegredo(segredo) })).json<Token>().protected).toBe(true);
  });

  test('PUT sem e2ee desliga a decifra', async ({ urls }) => {
    const remetente = await parEc('sig');
    const { uuid, segredo } = await urls.proteger({ e2ee: politica([remetente.publica]) });

    const res = await http('PUT', `/token/${uuid}`, { headers: comSegredo(segredo), corpo: {} });
    expect(res.status, res.texto).toBe(200);
    expect(res.json<Token>().e2ee).toBeNull();
  });

  test('JWK de remetente externo (gerada fora do Anzol) é aceita como está', async ({ urls }) => {
    const remetente = await parEc('insomnia-webcrypto-1');
    const { token } = await urls.proteger({ e2ee: politica([{ ...remetente.publica, alg: 'ES256', use: 'sig' }]) });
    expect((token.e2ee as any).trusted_signers[0]).toMatchObject({ kid: 'insomnia-webcrypto-1', x: remetente.publica.x, y: remetente.publica.y });
  });
});

test.describe('e2ee inválido → 422', () => {
  async function recusado(e2ee: unknown): Promise<Record<string, string[]>> {
    const res = await http('POST', '/token', { corpo: { read_secret: novoSegredo(), e2ee } });
    expect(res.status, res.texto).toBe(422);
    return res.json<Record<string, string[]>>();
  }

  test('signatário com a parte privada d', async () => {
    const remetente = await parEc('sig');
    expect(await recusado(politica([remetente.privada]))).toHaveProperty(['e2ee.trusted_signers.0']);
  });

  test('signatário com o ponto fora da curva', async () => {
    const remetente = await parEc('sig');
    expect(await recusado(politica([foraDaCurva(remetente.publica)]))).toHaveProperty(['e2ee.trusted_signers.0']);
  });

  test('signatário P-384, sem kid, com alg HS256 ou use enc', async () => {
    const p384 = await parEc('p384', 'P-384');
    const base = (await parEc('sig')).publica;
    const { kid: _, ...semKid } = base;
    const erros = await recusado(politica([p384.publica, semKid, { ...base, alg: 'HS256' }, { ...base, use: 'enc' }]));
    for (const i of [0, 1, 2, 3]) expect(erros).toHaveProperty([`e2ee.trusted_signers.${i}`]);
  });

  test('kid repetido entre os signatários', async () => {
    const a = await parEc('repetido');
    const b = await parEc('repetido');
    expect(await recusado(politica([a.publica, b.publica]))).toHaveProperty(['e2ee.trusted_signers']);
  });

  test('path com filtro, bindings ausente, audience vazia, max_age_seconds fora da faixa', async () => {
    const remetente = await parEc('sig');
    const erros = await recusado(politica([remetente.publica], {
      path: '$.itens[?(@.a)]', bindings: null, audience: '', max_age_seconds: 30,
    }));
    for (const campo of ['e2ee.path', 'e2ee.bindings', 'e2ee.audience', 'e2ee.max_age_seconds']) expect(erros).toHaveProperty([campo]);
  });

  test('e2ee que não é objeto', async () => {
    expect(await recusado([1, 2])).toHaveProperty(['e2ee']);
  });
});
