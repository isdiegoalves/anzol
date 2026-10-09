import { randomUUID } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import {
  DATA_HORA, JSON_ACCEPT, enviarEGuardar, expect, expectContentType, expectErroJson, listar, test, type Mensagem,
} from '../../support/contrato.js';
import { assinaturaGithub, assinaturaStripe, agoraEmSegundos, putToken } from '../../support/assinatura.js';
import { envelope, parEc, politica, selar } from '../../support/e2ee.js';
import { salvarRegras } from '../../support/regras.js';
import {
  ERRO_HOST, capturar, comSegredo, expect401Protegida, expect403, http, httpCruCompleto, test as testDePrivacidade,
} from '../../support/privacidade.js';

// Item 14, B2 (§1 "API dos extras de backend"): `GET /token/{id}/stats?window=N` agrega as `evaluated = min(window,
// total)` mensagens mais novas da URL para Checks › Health e Insights. Nada é gravado.
// - `window`: inteiro de 1 a 500, padrão 500; inválido → 422 `{"window": ["The window must be an integer between 1 and
//   500."]}`. URL inexistente → 410 `Token not found`, como na busca. URL protegida sem acesso → 401.
// - `signature` segue o estado da mensagem (válida, inválida, ausente = "header … absent"; `unchecked` = `null`);
//   `reasons` vem das inválidas e ausentes, sem o parêntese final, por contagem decrescente, empate pelo texto, até 10.
// - `schema.paths` conta cada `errors[].path` uma vez por mensagem (`""` é a raiz), até 10.
// - `rules.answered` agrupa por `rule.id` com o nome da mensagem mais nova; `near_miss` por `near_miss.id`;
//   `default` conta `rule: null`.
// - `hourly`: horas UTC com mensagem, da mais antiga para a mais nova. Datas no formato de `created_at`.
// - `decryption` segue `decryption.state` da mensagem (`valid`, `invalid`, `unknown_kid`, `absent`; `unchecked` =
//   `decryption: null`, a URL não decifrava); `reasons` vem das `invalid`, por `reason`, por contagem decrescente, empate
//   pelo texto, até 10.
//
// Leituras assumidas (a §1 não fixa): `schema.paths` segue a ordem de `reasons` (contagem decrescente, empate pelo
// texto); `near_miss` leva o nome da mensagem mais nova, como `answered`; a ordem das listas de `rules` não é contrato
// (comparadas por `id`); `methods` de URL vazia é `{}`.

interface Estatisticas {
  window: number;
  evaluated: number;
  total: number;
  newest_seq: number | null;
  oldest_seq: number | null;
  newest_at: string | null;
  oldest_at: string | null;
  methods: Record<string, number>;
  signature: { valid: number; invalid: number; absent: number; unchecked: number; reasons: Array<{ reason: string; count: number }> };
  schema: { valid: number; invalid: number; unchecked: number; paths: Array<{ path: string; count: number }> };
  rules: {
    answered: Array<{ id: string; name: string; count: number }>;
    near_miss: Array<{ id: string; name: string; count: number }>;
    default: number;
  };
  hourly: Array<{ hour: string; count: number; methods: Record<string, number> }>;
  decryption: {
    valid: number; invalid: number; unknown_kid: number; absent: number; unchecked: number;
    reasons: Array<{ reason: string; count: number }>;
  };
}

const CHAVES = [
  'decryption', 'evaluated', 'hourly', 'methods', 'newest_at', 'newest_seq', 'oldest_at', 'oldest_seq', 'rules', 'schema',
  'signature', 'total', 'window',
];
const ERRO_WINDOW = { window: ['The window must be an integer between 1 and 500.'] };

function pedirStats(request: APIRequestContext, tokenId: string, query = ''): Promise<APIResponse> {
  return request.get(`/token/${tokenId}/stats${query ? `?${query}` : ''}`, { headers: JSON_ACCEPT });
}

async function stats(request: APIRequestContext, tokenId: string, query = ''): Promise<Estatisticas> {
  const res = await pedirStats(request, tokenId, query);
  expect(res.status(), `GET /token/{id}/stats${query ? `?${query}` : ''}: ${(await res.text()).slice(0, 500)}`).toBe(200);
  expectContentType(res, 'application/json');
  const corpo = (await res.json()) as Estatisticas;
  expect(Object.keys(corpo).sort(), JSON.stringify(corpo).slice(0, 300)).toEqual(CHAVES);
  return corpo;
}

/** Todas as mensagens guardadas, da mais nova para a mais antiga (por `seq`). */
async function guardadas(request: APIRequestContext, tokenId: string): Promise<Mensagem[]> {
  const { data } = await listar(request, tokenId, 'per_page=500');
  return [...data].sort((a, b) => b.seq - a.seq);
}

const porContagemETexto = <T extends { count: number }>(texto: (x: T) => string) => (a: T, b: T) =>
  b.count - a.count || (texto(a) < texto(b) ? -1 : texto(a) > texto(b) ? 1 : 0);

function contar(chaves: string[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const c of chaves) mapa.set(c, (mapa.get(c) ?? 0) + 1);
  return mapa;
}

/** A §1 escrita como código: o que o servidor deve devolver para estas mensagens e esta janela. */
function esperado(todas: Mensagem[], window: number): Estatisticas {
  const avaliadas = todas.slice(0, Math.min(window, todas.length));
  const maisNova = avaliadas[0];
  const maisAntiga = avaliadas[avaliadas.length - 1];
  const estado = (m: Mensagem) => {
    if (m.signature === null) return 'unchecked';
    if (m.signature.valid) return 'valid';
    return /^header \S+ absent$/.test(m.signature.reason ?? '') ? 'absent' : 'invalid';
  };
  const reasons = [...contar(avaliadas.filter((m) => m.signature && !m.signature.valid).map((m) => m.signature!.reason!.replace(/ \([^)]*\)$/, '')))]
    .map(([reason, count]) => ({ reason, count }))
    .sort(porContagemETexto((x) => x.reason))
    .slice(0, 10);
  const paths = [...contar(avaliadas.flatMap((m) => (m.schema && !m.schema.valid ? [...new Set(m.schema.errors.map((e) => e.path))] : [])))]
    .map(([path, count]) => ({ path, count }))
    .sort(porContagemETexto((x) => x.path))
    .slice(0, 10);
  const agrupar = (lista: Array<{ id: string; name: string }>) => {
    const grupos = new Map<string, { id: string; name: string; count: number }>();
    // `lista` vem da mais nova para a mais antiga: o primeiro nome visto é o da mais nova.
    for (const r of lista) {
      const g = grupos.get(r.id);
      if (g) g.count++;
      else grupos.set(r.id, { id: r.id, name: r.name, count: 1 });
    }
    return [...grupos.values()].sort((a, b) => a.id.localeCompare(b.id));
  };
  const horas = new Map<string, { hour: string; count: number; methods: Record<string, number> }>();
  for (const m of [...avaliadas].reverse()) {
    const hour = `${m.created_at.slice(0, 13)}:00:00`;
    const h = horas.get(hour) ?? { hour, count: 0, methods: {} };
    h.count++;
    h.methods[m.method] = (h.methods[m.method] ?? 0) + 1;
    horas.set(hour, h);
  }
  return {
    window,
    evaluated: avaliadas.length,
    total: todas.length,
    newest_seq: maisNova?.seq ?? null,
    oldest_seq: maisAntiga?.seq ?? null,
    newest_at: maisNova?.created_at ?? null,
    oldest_at: maisAntiga?.created_at ?? null,
    methods: Object.fromEntries(contar(avaliadas.map((m) => m.method))),
    signature: {
      valid: avaliadas.filter((m) => estado(m) === 'valid').length,
      invalid: avaliadas.filter((m) => estado(m) === 'invalid').length,
      absent: avaliadas.filter((m) => estado(m) === 'absent').length,
      unchecked: avaliadas.filter((m) => estado(m) === 'unchecked').length,
      reasons,
    },
    schema: {
      valid: avaliadas.filter((m) => m.schema?.valid === true).length,
      invalid: avaliadas.filter((m) => m.schema?.valid === false).length,
      unchecked: avaliadas.filter((m) => m.schema === null).length,
      paths,
    },
    rules: {
      answered: agrupar(avaliadas.flatMap((m) => (m.rule ? [m.rule] : []))),
      near_miss: agrupar(avaliadas.flatMap((m) => (m.near_miss ? [m.near_miss] : []))),
      default: avaliadas.filter((m) => m.rule === null).length,
    },
    hourly: [...horas.values()],
    decryption: {
      valid: avaliadas.filter((m) => m.decryption?.state === 'valid').length,
      invalid: avaliadas.filter((m) => m.decryption?.state === 'invalid').length,
      unknown_kid: avaliadas.filter((m) => m.decryption?.state === 'unknown_kid').length,
      absent: avaliadas.filter((m) => m.decryption?.state === 'absent').length,
      unchecked: avaliadas.filter((m) => !m.decryption).length,
      reasons: [...contar(avaliadas.filter((m) => m.decryption?.state === 'invalid').map((m) => m.decryption!.reason ?? ''))]
        .map(([reason, count]) => ({ reason, count }))
        .sort(porContagemETexto((x) => x.reason))
        .slice(0, 10),
    },
  };
}

/** As listas de `rules` comparadas por `id`: a ordem delas não é contrato. */
function normalizado(s: Estatisticas): Estatisticas {
  const porId = <T extends { id: string }>(l: T[]) => [...l].sort((a, b) => a.id.localeCompare(b.id));
  return { ...s, rules: { ...s.rules, answered: porId(s.rules.answered), near_miss: porId(s.rules.near_miss) } };
}

async function expectComoAsMensagens(request: APIRequestContext, tokenId: string, query = '', window = 500): Promise<Estatisticas> {
  const recebido = await stats(request, tokenId, query);
  expect(normalizado(recebido)).toEqual(esperado(await guardadas(request, tokenId), window));
  return recebido;
}

async function enviar(request: APIRequestContext, tokenId: string, metodo: string, caminho = '', headers: Record<string, string> = {}, corpo?: string) {
  return enviarEGuardar(request, tokenId, caminho, { method: metodo, headers, ...(corpo === undefined ? {} : { data: Buffer.from(corpo) }) });
}

test.describe('stats: forma, janela e validação (item 14, B2)', () => {
  test('URL vazia: zeros, listas vazias, *_seq e *_at nulos; window padrão 500', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(await stats(request, token.uuid)).toEqual({
      window: 500, evaluated: 0, total: 0,
      newest_seq: null, oldest_seq: null, newest_at: null, oldest_at: null,
      methods: {},
      signature: { valid: 0, invalid: 0, absent: 0, unchecked: 0, reasons: [] },
      schema: { valid: 0, invalid: 0, unchecked: 0, paths: [] },
      rules: { answered: [], near_miss: [], default: 0 },
      hourly: [],
      decryption: { valid: 0, invalid: 0, unknown_kid: 0, absent: 0, unchecked: 0, reasons: [] },
    });
  });

  test('conta por método, marca as pontas por seq e created_at e agrupa por hora UTC; nada é gravado', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const enviadas: Mensagem[] = [];
    for (const metodo of ['POST', 'GET', 'POST', 'PUT', 'GET', 'POST']) enviadas.push((await enviar(request, token.uuid, metodo)).msg);
    const antes = { token: await (await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).json(), mensagens: await guardadas(request, token.uuid) };

    const s = await expectComoAsMensagens(request, token.uuid);

    expect(s).toMatchObject({ window: 500, evaluated: 6, total: 6, methods: { POST: 3, GET: 2, PUT: 1 } });
    expect(s.newest_seq).toBe(enviadas[5].seq);
    expect(s.oldest_seq).toBe(enviadas[0].seq);
    expect(s.newest_at).toMatch(DATA_HORA);
    expect(s.oldest_at).toMatch(DATA_HORA);
    expect(s.hourly.length).toBeGreaterThanOrEqual(1);
    for (const h of s.hourly) expect(h.hour).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:00:00$/);
    expect(s.hourly.map((h) => h.hour), 'da hora mais antiga para a mais nova').toEqual(s.hourly.map((h) => h.hour).sort());
    expect(s.hourly.reduce((soma, h) => soma + h.count, 0)).toBe(6);
    // Sem mensagem, regra ou URL nova: o token e as mensagens ficam como estavam.
    expect(await (await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).json()).toEqual(antes.token);
    expect(await guardadas(request, token.uuid)).toEqual(antes.mensagens);
  });

  test('window=N avalia só as N mais novas; total conta todas', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const enviadas: Mensagem[] = [];
    for (const metodo of ['GET', 'GET', 'GET', 'POST', 'PUT']) enviadas.push((await enviar(request, token.uuid, metodo)).msg);

    const duas = await expectComoAsMensagens(request, token.uuid, 'window=2', 2);
    expect(duas).toMatchObject({ window: 2, evaluated: 2, total: 5, methods: { POST: 1, PUT: 1 } });
    expect(duas.newest_seq).toBe(enviadas[4].seq);
    expect(duas.oldest_seq).toBe(enviadas[3].seq);

    expect(await stats(request, token.uuid, 'window=1')).toMatchObject({ window: 1, evaluated: 1, total: 5, methods: { PUT: 1 } });
    expect(await stats(request, token.uuid, 'window=500')).toMatchObject({ window: 500, evaluated: 5, total: 5 });
  });

  test('window fora de 1..500 ou não inteiro → 422 em window', async ({ request, tokens }) => {
    const token = await tokens.criar();
    for (const valor of ['0', '501', '-1', '1.5', 'abc', '1000']) {
      const res = await pedirStats(request, token.uuid, `window=${valor}`);
      expect(res.status(), `window=${valor}: ${(await res.text()).slice(0, 300)}`).toBe(422);
      expectContentType(res, 'application/json');
      expect(await res.json(), `window=${valor}`).toEqual(ERRO_WINDOW);
    }
  });

  test('URL que nunca existiu ou apagada → 410 Token not found', async ({ request, tokens }) => {
    await expectErroJson(await pedirStats(request, randomUUID()), 410, 'Token not found');
    const token = await tokens.criar();
    expect((await request.delete(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).status()).toBe(204);
    await expectErroJson(await pedirStats(request, token.uuid), 410, 'Token not found');
  });
});

test.describe('stats: assinatura, schema e regras (item 14, B2)', () => {
  test('signature: valid, invalid, absent e unchecked; reasons sem o parêntese final, por contagem', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const corpo = '{"x":1}';
    const json = { 'Content-Type': 'application/json' };
    // Antes de configurar a verificação: signature null → unchecked.
    await enviar(request, token.uuid, 'POST', '', json, corpo);

    expect((await putToken(request, token.uuid, { signature: { provider: 'github', secret: 'segredo-gh' } })).status()).toBe(200);
    await enviar(request, token.uuid, 'POST', '', { ...json, 'X-Hub-Signature-256': assinaturaGithub('segredo-gh', corpo) }, corpo);
    await enviar(request, token.uuid, 'POST', '', { ...json, 'X-Hub-Signature-256': assinaturaGithub('segredo-gh', corpo) }, corpo);
    await enviar(request, token.uuid, 'POST', '', { ...json, 'X-Hub-Signature-256': assinaturaGithub('outro', corpo) }, corpo);
    await enviar(request, token.uuid, 'POST', '', json, corpo);

    // Stripe com timestamp velho: "timestamp outside tolerance (N s)" com N diferente em cada uma, e um segredo errado.
    expect((await putToken(request, token.uuid, { signature: { provider: 'stripe', secret: 'segredo-st', toleranceSeconds: 300 } })).status()).toBe(200);
    const agora = agoraEmSegundos();
    await enviar(request, token.uuid, 'POST', '', { ...json, 'Stripe-Signature': assinaturaStripe('segredo-st', corpo, agora - 1_000).header }, corpo);
    await enviar(request, token.uuid, 'POST', '', { ...json, 'Stripe-Signature': assinaturaStripe('segredo-st', corpo, agora - 2_000).header }, corpo);
    await enviar(request, token.uuid, 'POST', '', { ...json, 'Stripe-Signature': assinaturaStripe('outro', corpo).header }, corpo);

    const s = await expectComoAsMensagens(request, token.uuid);

    expect(s.signature).toMatchObject({ valid: 2, invalid: 4, absent: 1, unchecked: 1 });
    expect(s.signature.reasons).toHaveLength(3);
    expect(s.signature.reasons[0]).toEqual({ reason: 'signature mismatch', count: 2 });
    expect(s.signature.reasons[1]).toEqual({ reason: 'timestamp outside tolerance', count: 2 });
    expect(s.signature.reasons[2].count).toBe(1);
    expect(s.signature.reasons[2].reason).toMatch(/^header x-hub-signature-256 absent$/i);
  });

  test('signature.reasons: no máximo 10, empate pelo texto', async ({ request, tokens }) => {
    const token = await tokens.criar();
    // Generic com 11 nomes de header: 11 frases "header X-Sig-NN absent", a primeira duas vezes.
    for (let i = 0; i <= 10; i++) {
      const header = `X-Sig-${String(i).padStart(2, '0')}`;
      expect((await putToken(request, token.uuid, { signature: { provider: 'generic', secret: 'segredo-generic', header } })).status()).toBe(200);
      await enviar(request, token.uuid, 'GET');
      if (i === 0) await enviar(request, token.uuid, 'GET');
    }

    const s = await expectComoAsMensagens(request, token.uuid);

    expect(s.signature).toMatchObject({ absent: 12, valid: 0, invalid: 0, unchecked: 0 });
    expect(s.signature.reasons).toHaveLength(10);
    expect(s.signature.reasons[0]).toMatchObject({ count: 2 });
    expect(s.signature.reasons[0].reason).toMatch(/^header x-sig-00 absent$/i);
    expect(s.signature.reasons.map((r) => r.reason.toLowerCase())).not.toContain('header x-sig-10 absent');
  });

  test('schema: valid, invalid e unchecked; paths uma vez por mensagem, "" é a raiz, no máximo 10', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const json = { 'Content-Type': 'application/json' };
    const letras = 'bcdefghijkl'.split('');
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string', minLength: 5, pattern: '^[0-9]+$' },
        ...Object.fromEntries(letras.map((l) => [l, { type: 'integer' }])),
      },
    };
    await enviar(request, token.uuid, 'POST', '', json, '{"a":"12345"}');
    expect((await putToken(request, token.uuid, { schema })).status()).toBe(200);
    await enviar(request, token.uuid, 'POST', '', json, '{"a":"12345"}');
    // Dois erros em /a na mesma mensagem: conta uma vez.
    await enviar(request, token.uuid, 'POST', '', json, '{"a":"ab"}');
    await enviar(request, token.uuid, 'POST', '', json, JSON.stringify({ a: 'ab', ...Object.fromEntries(letras.map((l) => [l, 'x'])) }));
    // Corpo que não é JSON: erro na raiz ("").
    await enviar(request, token.uuid, 'POST', '', { 'Content-Type': 'application/x-www-form-urlencoded' }, 'nome=Ana');

    const s = await expectComoAsMensagens(request, token.uuid);

    expect(s.schema).toMatchObject({ valid: 1, invalid: 3, unchecked: 1 });
    expect(s.schema.paths).toHaveLength(10);
    expect(s.schema.paths[0]).toEqual({ path: '/a', count: 2 });
    expect(s.schema.paths).toContainEqual({ path: '', count: 1 });
  });

  test('rules: answered por rule.id com o nome da mais nova, near_miss por near_miss.id, default = rule null', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await enviar(request, token.uuid, 'GET', '/antes-das-regras');
    const [pago, reembolso] = await salvarRegras(request, token.uuid, [
      { name: 'Stripe payment OK', priority: 2, match: { path: { equals: '/pago' } }, response: { status: 201 } },
      { name: 'Refund queued', priority: 1, match: { method: ['POST'], path: { equals: '/refund' } }, response: { status: 202 } },
    ]);
    await enviar(request, token.uuid, 'GET', '/pago');
    await enviar(request, token.uuid, 'GET', '/pago');
    // Mesma regra (mesmo id), nome novo: o agrupamento é por id, com o nome da mensagem mais nova.
    await salvarRegras(request, token.uuid, [
      { ...pago, name: 'Pago v2' },
      reembolso,
    ]);
    await enviar(request, token.uuid, 'GET', '/pago');
    // Uma condição falhando nas duas regras: o near miss é a de menor priority (Refund queued).
    await enviar(request, token.uuid, 'GET', '/refund');
    await enviar(request, token.uuid, 'GET', '/refund');

    const s = await expectComoAsMensagens(request, token.uuid);

    expect(s.rules.answered).toEqual([{ id: pago.id, name: 'Pago v2', count: 3 }]);
    expect(s.rules.near_miss).toEqual([{ id: reembolso.id, name: 'Refund queued', count: 2 }]);
    expect(s.rules.default).toBe(3);
  });
});

testDePrivacidade.describe('stats: acesso (item 14, B2 e item 12)', () => {
  testDePrivacidade('URL protegida: sem acesso ou com o segredo errado → 401; com o segredo → 200', async ({ urls }) => {
    const url = await urls.proteger();
    expect401Protegida(await http('GET', `/token/${url.uuid}/stats`), 'stats sem acesso');
    expect401Protegida(await http('GET', `/token/${url.uuid}/stats`, { headers: comSegredo(`${url.segredo}x`) }), 'stats com o segredo errado');
    const certo = await http('GET', `/token/${url.uuid}/stats`, { headers: comSegredo(url.segredo) });
    expect(certo.status, certo.texto.slice(0, 300)).toBe(200);
    expect(certo.json<Estatisticas>()).toMatchObject({ window: 500, evaluated: 0, total: 0 });
  });

  testDePrivacidade('decryption: valid, invalid por motivo, unknown_kid, absent e unchecked, como as mensagens', async ({ urls }) => {
    const remetente = await parEc('remetente-sig-1');
    const { uuid, segredo } = await urls.proteger();
    const json = { 'Content-Type': 'application/json' };
    const entregar = (corpo: unknown) => capturar(uuid, '', { body: JSON.stringify(corpo), headers: json });
    // Antes da decifra: decryption null → unchecked.
    await entregar({ x: 1 });
    expect((await http('PUT', `/token/${uuid}`, { headers: comSegredo(segredo), corpo: { e2ee: politica([remetente.publica], { required: false }) } })).status).toBe(200);
    const chave = (await http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: { kid: 'enc-v1' } }))
      .json<{ jwk: Record<string, unknown> }>().jwk;
    const selada = async (claims = {}) => {
      const id = randomUUID();
      return envelope(id, await selar(remetente, chave, id, { ok: true }, claims));
    };
    await entregar(await selada());
    await entregar(await selada());
    await entregar(await selada({ aud: 'outro' }));
    await entregar(await selada({ aud: 'outro' }));
    await entregar(await selada({ evt: 'OUTRO' }));
    const alheia = await parEc('enc-v9');
    const id = randomUUID();
    await entregar(envelope(id, await selar(remetente, alheia.publica, id, { ok: true })));
    await entregar(envelope(randomUUID(), { em: 'claro' }));

    const res = await http('GET', `/token/${uuid}/stats`, { headers: comSegredo(segredo) });

    expect(res.status, res.texto.slice(0, 300)).toBe(200);
    expect(res.json<Estatisticas>().decryption).toEqual({
      valid: 2, invalid: 3, unknown_kid: 1, absent: 1, unchecked: 1,
      reasons: [{ reason: 'aud_mismatch', count: 2 }, { reason: 'evt_mismatch', count: 1 }],
    });
  });

  testDePrivacidade('é GET: Origin estranho não importa; Host fora da lista → 403 host not allowed', async ({ urls }) => {
    const token = await urls.abrir();
    const comOrigem = await http('GET', `/token/${token.uuid}/stats`, { headers: { Origin: 'http://evil.test' } });
    expect(comOrigem.status, comOrigem.texto.slice(0, 300)).toBe(200);
    expect403(await httpCruCompleto('GET', `/token/${token.uuid}/stats`, 'evil.test'), ERRO_HOST, 'stats com Host evil.test');
  });
});
