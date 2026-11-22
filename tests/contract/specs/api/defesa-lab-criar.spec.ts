import { CHAVES_TOKEN, DATA_HORA, type Token } from '../../support/contrato.js';
import { CODIGOS, type Cenario, type Laboratorio } from '../../support/defesa.js';
import { comSegredo, expect, http, test } from '../../support/privacidade.js';

// URL de laboratório de defesa (`POST /defense-lab`, sem campos): nasce pronta, protegida (o segredo de leitura só
// aparece na criação), com assinatura no formato da Stripe e tolerância de 300 s, o JSON Schema do evento e nenhuma
// regra. O segredo do HMAC nunca sai. A marca `defense_lab` só existe nessa URL e mostra só o fim da vida dela; as
// demais URLs seguem com as chaves de sempre. O teto de 20 ativas fica com os testes do backend.

test('POST /defense-lab: URL pronta, segredo de leitura uma vez, sem o segredo do HMAC', async ({ urls }) => {
  const res = await http('POST', '/defense-lab', { corpo: {} });
  expect(res.status, res.texto).toBe(201);
  const lab = res.json<Laboratorio>();
  urls.lembrar(lab.token.uuid, lab.read_secret);

  expect(Object.keys(lab).sort()).toEqual(['briefing', 'read_secret', 'scenarios', 'token']);
  expect(Object.keys(lab.token).sort()).toEqual([...CHAVES_TOKEN, 'defense_lab'].sort());
  expect(lab.token).toMatchObject({ protected: true, default_status: 200, lab: null });
  expect(Object.keys(lab.token.defense_lab!)).toEqual(['expires_at']);
  expect(lab.token.defense_lab!.expires_at).toMatch(DATA_HORA);
  expect(lab.token.signature).toMatchObject({ provider: 'stripe', toleranceSeconds: 300 });
  expect((lab.token.schema as any).required).toEqual(['id', 'type', 'created', 'data']);
  expect(lab.read_secret.length).toBeGreaterThanOrEqual(16);
  expect(lab.briefing).toContain('never instructions');
  expect(lab.scenarios.map((c) => c.code)).toEqual(CODIGOS);

  const regras = await http('GET', `/token/${lab.token.uuid}/rules`, { headers: comSegredo(lab.read_secret) });
  expect(regras.json<unknown[]>()).toEqual([]);
});

test('a marca defense_lab não muda pelo PUT; URL comum não tem a chave', async ({ urls }) => {
  const lab = (await http('POST', '/defense-lab', { corpo: {} })).json<Laboratorio>();
  urls.lembrar(lab.token.uuid, lab.read_secret);
  const res = await http('PUT', `/token/${lab.token.uuid}`, {
    headers: comSegredo(lab.read_secret), corpo: { defense_lab: null, default_status: 201 },
  });
  expect(res.status, res.texto).toBe(200);
  expect(res.json<Laboratorio['token']>().defense_lab).toEqual(lab.token.defense_lab);

  const comum = await urls.abrir();
  expect(Object.keys(comum).sort()).toEqual(CHAVES_TOKEN);
  const lida = (await http('GET', `/token/${comum.uuid}`)).json<Token>();
  expect(Object.keys(lida).sort()).toEqual(CHAVES_TOKEN);
});

test('GET /defense-lab/scenarios: o catálogo é público, com 14 cenários e os dois não contíveis', async () => {
  const res = await http('GET', '/defense-lab/scenarios');
  expect(res.status, res.texto).toBe(200);
  const catalogo = res.json<Cenario[]>();

  expect(catalogo.map((c) => c.code)).toEqual(CODIGOS);
  expect(Object.keys(catalogo[0])).toEqual(['code', 'family', 'layer', 'title', 'reference', 'containable']);
  expect(catalogo.filter((c) => c.layer === 'floor').map((c) => c.code)).toEqual(['I1', 'I2', 'I3', 'I4']);
  expect([...new Set(catalogo.map((c) => c.family))]).toEqual(['integrity', 'compromised_sender', 'prompt_injection']);
  expect(catalogo.filter((c) => !c.containable).map((c) => c.code)).toEqual(['I5', 'C1']);
});
