import { comSegredo, expect, http, test } from '../../support/privacidade.js';

// Rodada de cenários numa URL de laboratório E2EE (`POST /token/{id}/e2ee-lab/run`, `{"scenarios"?: [códigos]}`): o
// servidor gera os vetores com as chaves e o remetente de teste da URL, entrega cada um pela captura real (HMAC,
// decifra e regras) e compara status, estado e motivo com o esperado. O relatório nunca traz o texto aberto, só se o
// `data` aberto é igual ao enviado (`data_matches`). `GET /e2ee-lab/scenarios` lista o catálogo de 27 cenários.

interface Resultado {
  code: string;
  expected: { status: number; state: string; reason: string | null };
  actual: { status: number; state: string | null; reason: string | null; kid: string | null; data_matches: boolean | null };
  ok: boolean;
  request_id: string;
}

interface Relatorio {
  total: number;
  matched: number;
  results: Resultado[];
}

async function laboratorio(urls: any): Promise<{ uuid: string; segredo: string }> {
  const res = await http('POST', '/e2ee-lab', { corpo: {} });
  expect(res.status, res.texto).toBe(201);
  const lab = res.json<{ token: { uuid: string }; read_secret: string }>();
  urls.lembrar(lab.token.uuid, lab.read_secret);
  return { uuid: lab.token.uuid, segredo: lab.read_secret };
}

test('todos os cenários: os 27 conferem, com os status do laboratório, e nada aberto no relatório', async ({ urls }) => {
  const { uuid, segredo } = await laboratorio(urls);
  const res = await http('POST', `/token/${uuid}/e2ee-lab/run`, { headers: comSegredo(segredo), corpo: {} });
  expect(res.status, res.texto.slice(0, 300)).toBe(200);
  const relatorio = res.json<Relatorio>();

  expect(relatorio.results.filter((r) => !r.ok)).toEqual([]);
  expect(relatorio).toMatchObject({ total: 27, matched: 27 });
  const por = Object.fromEntries(relatorio.results.map((r) => [r.code, r]));
  expect(por.P1.actual).toMatchObject({ status: 202, state: 'valid', data_matches: true });
  expect(por.P3b.actual.data_matches).toBe(true);
  expect(por.N4.actual).toMatchObject({ status: 500, state: 'unknown_kid' });
  expect(por.N7a.actual).toMatchObject({ status: 401, reason: 'hmac_failed' });
  expect(por.N3.actual).toMatchObject({ status: 400, reason: 'downgrade' });
  expect(res.texto).not.toContain('"decrypted"');

  const msg = (await http('GET', `/token/${uuid}/request/${por.P3.request_id}`, { headers: comSegredo(segredo) })).json<any>();
  expect(msg.decryption).toMatchObject({ state: 'valid', signature_kid: 'lab-sig-1' });
});

test('URL comum → 422 em lab; código desconhecido → 422 na posição; sem segredo → 401', async ({ urls }) => {
  const comum = await urls.abrir();
  const naoLab = await http('POST', `/token/${comum.uuid}/e2ee-lab/run`, { corpo: {} });
  expect(naoLab.status).toBe(422);
  expect(naoLab.json<object>()).toHaveProperty('lab');

  const { uuid, segredo } = await laboratorio(urls);
  const desconhecido = await http('POST', `/token/${uuid}/e2ee-lab/run`, { headers: comSegredo(segredo), corpo: { scenarios: ['P1', 'Z9'] } });
  expect(desconhecido.status).toBe(422);
  expect(desconhecido.json<object>()).toHaveProperty(['scenarios.1']);
  expect((await http('POST', `/token/${uuid}/e2ee-lab/run`, { corpo: {} })).status).toBe(401);
});

test('catálogo: 27 cenários com o esperado da política padrão', async () => {
  const res = await http('GET', '/e2ee-lab/scenarios');
  expect(res.status).toBe(200);
  const catalogo = res.json<{ code: string; expected: { status: number; state: string; reason: string | null } }[]>();
  expect(catalogo).toHaveLength(27);
  const por = Object.fromEntries(catalogo.map((c) => [c.code, c.expected]));
  expect(por.P5).toMatchObject({ status: 202, state: 'valid' });
  expect(por.Xe).toMatchObject({ status: 400, reason: 'evt_mismatch' });
  expect(por.N7b).toMatchObject({ status: 401, reason: 'hmac_failed' });
});
