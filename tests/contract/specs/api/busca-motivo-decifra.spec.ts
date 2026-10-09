import { randomUUID } from 'node:crypto';
import { BASE_URL } from '../../support/contrato.js';
import { cifrar, envelope, parEc, politica, selar, type ResultadoDecifra } from '../../support/e2ee.js';
import { MODO_MCP } from '../../support/ia.js';
import { test as testMcp } from '../../support/mcp.js';
import { comSegredo, expect, http, test, type UrlProtegida } from '../../support/privacidade.js';

// v0.5.0: a busca aceita, no topo do corpo e fora de `match`, `decryption_reason`: a mensagem com `decryption.state`
// `invalid` e esse `decryption.reason`, exato (o texto de `/stats` `decryption.reasons[].reason`). Combina em E com o
// resto; `null` = ausente. 422 em `decryption_reason` (não texto, vazio, > 200). O `search_requests` do MCP aceita o
// mesmo campo e o declara no `tools/list`.

interface Mensagem {
  uuid: string;
  decryption: ResultadoDecifra | null;
}

interface Pagina {
  data: Mensagem[];
  total: number;
}

interface Cenario {
  url: UrlProtegida;
  valida: Mensagem;
  desconhecida: Mensagem;
  /** Envelope com o atributo em claro: `downgrade`. */
  emClaro1: Mensagem;
  emClaro2: Mensagem;
  /** Envelope sem o atributo: `attribute_missing`. */
  semAtributo: Mensagem;
  /** JWE sem o JWS do remetente dentro. */
  forjada: Mensagem;
}

async function montar(urls: { proteger(d?: Record<string, unknown>): Promise<UrlProtegida> }): Promise<Cenario> {
  const remetente = await parEc('remetente-sig-1');
  const url = await urls.proteger({ e2ee: politica([remetente.publica]) });
  const segredo = comSegredo(url.segredo);
  const chave = (await http('POST', `/token/${url.uuid}/keys`, { headers: segredo, corpo: { kid: 'enc-v1' } }))
    .json<{ jwk: Record<string, unknown> }>().jwk;
  const entregar = async (corpo: unknown): Promise<Mensagem> => {
    const res = await fetch(new URL(`/${url.uuid}`, BASE_URL), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
    const rid = res.headers.get('x-request-id');
    expect(rid, `captura sem X-Request-Id: ${res.status}`).toBeTruthy();
    return (await http('GET', `/token/${url.uuid}/request/${rid}`, { headers: segredo })).json<Mensagem>();
  };
  const id = randomUUID();
  const valida = await entregar(envelope(id, await selar(remetente, chave, id, { ok: true })));
  const outro = randomUUID();
  const desconhecida = await entregar(envelope(outro, await selar(remetente, (await parEc('enc-v9')).publica, outro, { ok: true })));
  const emClaro1 = await entregar(envelope(randomUUID(), { pedido: 'PED-1' }));
  const semAtributo = await entregar({ eventId: randomUUID(), tipoEvento: { nome: 'PEDIDO_CRIADO' }, servico: { nome: 'X' } });
  const forjada = await entregar(envelope(randomUUID(), await cifrar(chave, JSON.stringify({ ok: true }))));
  const emClaro2 = await entregar(envelope(randomUUID(), { pedido: 'PED-2' }));

  // O cenário é o que o teste supõe: confere o que a captura gravou.
  expect(valida.decryption?.state).toBe('valid');
  expect(desconhecida.decryption?.state).toBe('unknown_kid');
  for (const m of [emClaro1, emClaro2]) expect(m.decryption).toMatchObject({ state: 'invalid', reason: 'downgrade' });
  expect(semAtributo.decryption).toMatchObject({ state: 'invalid', reason: 'attribute_missing' });
  expect(forjada.decryption?.state).toBe('invalid');
  expect(['downgrade', 'attribute_missing']).not.toContain(forjada.decryption?.reason);
  return { url, valida, desconhecida, emClaro1, emClaro2, semAtributo, forjada };
}

async function buscar(url: UrlProtegida, corpo: Record<string, unknown>): Promise<Pagina> {
  const res = await http('POST', `/token/${url.uuid}/requests/search`, { headers: comSegredo(url.segredo), corpo });
  expect(res.status, `${JSON.stringify(corpo)}: ${res.texto.slice(0, 300)}`).toBe(200);
  return res.json<Pagina>();
}

async function expectBusca(url: UrlProtegida, corpo: Record<string, unknown>, esperadas: Mensagem[]): Promise<void> {
  const pagina = await buscar(url, { sorting: 'oldest', ...corpo });
  const descricao = JSON.stringify(corpo);
  expect(pagina.data.map((m) => m.uuid), descricao).toEqual(esperadas.map((m) => m.uuid));
  expect(pagina.total, descricao).toBe(esperadas.length);
}

test.describe('Busca pelo motivo da decifra', () => {
  test('decryption_reason acha só as inválidas com aquele motivo; a válida e a de kid desconhecido nunca', async ({ urls }) => {
    const c = await montar(urls);
    await expectBusca(c.url, { decryption_reason: 'downgrade' }, [c.emClaro1, c.emClaro2]);
    await expectBusca(c.url, { decryption_reason: 'attribute_missing' }, [c.semAtributo]);
    await expectBusca(c.url, { decryption_reason: c.forjada.decryption!.reason! }, [c.forjada]);
    for (const valor of ['valid', 'unknown_kid', 'Downgrade', 'down', 'signature_invalid']) {
      await expectBusca(c.url, { decryption_reason: valor }, []);
    }
  });

  test('em E com text e match; null vale como ausente', async ({ urls }) => {
    const c = await montar(urls);
    await expectBusca(c.url, { decryption_reason: 'downgrade', text: 'PED-2' }, [c.emClaro2]);
    await expectBusca(c.url, { decryption_reason: 'downgrade', match: { decryption: 'invalid' } }, [c.emClaro1, c.emClaro2]);
    await expectBusca(c.url, { decryption_reason: 'downgrade', match: { decryption: 'valid' } }, []);
    await expectBusca(c.url, { decryption_reason: null }, [c.valida, c.desconhecida, c.emClaro1, c.semAtributo, c.forjada, c.emClaro2]);
  });

  test('o que o /stats lista é o que a busca acha: count de cada motivo = total da busca', async ({ urls }) => {
    const c = await montar(urls);
    const stats = (await http('GET', `/token/${c.url.uuid}/stats`, { headers: comSegredo(c.url.segredo) }))
      .json<{ decryption: { reasons: Array<{ reason: string; count: number }> } }>();
    expect(stats.decryption.reasons.length, 'pré-condição: o /stats lista motivos').toBeGreaterThanOrEqual(3);
    for (const { reason, count } of stats.decryption.reasons) {
      expect((await buscar(c.url, { decryption_reason: reason })).total, reason).toBe(count);
    }
  });

  test('URL sem e2ee: nenhuma mensagem casa', async ({ urls }) => {
    const token = await urls.abrir();
    await fetch(new URL(`/${token.uuid}`, BASE_URL), { method: 'POST', body: '{}' });
    const res = await http('POST', `/token/${token.uuid}/requests/search`, { corpo: { decryption_reason: 'attribute_missing' } });
    expect(res.json<Pagina>().total).toBe(0);
  });

  test('decryption_reason que não é texto, vazio ou com mais de 200 caracteres → 422 em decryption_reason', async ({ urls }) => {
    const token = await urls.abrir();
    for (const valor of [42, true, ['downgrade'], { reason: 'x' }, '', 'a'.repeat(201)]) {
      const res = await http('POST', `/token/${token.uuid}/requests/search`, { corpo: { decryption_reason: valor } });
      const descricao = JSON.stringify(valor).slice(0, 40);
      expect(res.status, `${descricao}: ${res.texto.slice(0, 300)}`).toBe(422);
      const erros = res.json<Record<string, string[]>>();
      expect(erros, descricao).toHaveProperty(['decryption_reason']);
      for (const m of erros.decryption_reason) expect(m, descricao).toMatch(/^[A-Z].*\.$/s);
    }
    const aceito = await http('POST', `/token/${token.uuid}/requests/search`, { corpo: { decryption_reason: 'a'.repeat(200) } });
    expect(aceito.status).toBe(200);
  });
});

testMcp.describe('MCP: busca pelo motivo da decifra', () => {
  testMcp.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  testMcp('search_requests declara decryption_reason e filtra por ele', async ({ mcp }) => {
    const propriedades = mcp.ferramentas.get('search_requests')?.inputSchema.properties as Record<string, unknown> | undefined;
    expect(Object.keys(propriedades ?? {})).toContain('decryption_reason');

    const remetente = await parEc('remetente-sig-1');
    const segredo = `seg-${randomUUID()}`;
    const criada = await http('POST', '/token', { corpo: { read_secret: segredo, e2ee: politica([remetente.publica]) } });
    expect(criada.status, criada.texto.slice(0, 300)).toBe(201);
    const uuid = criada.json<{ uuid: string }>().uuid;
    try {
      const entregar = async (corpo: unknown) =>
        (await fetch(new URL(`/${uuid}`, BASE_URL), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
        })).headers.get('x-request-id');
      await entregar({ eventId: randomUUID() });
      const emClaro = await entregar(envelope(randomUUID(), { ok: true }));

      const pagina = await mcp.chamarOk<Pagina>('search_requests', { read_secret: segredo, decryption_reason: 'downgrade' }, uuid);

      expect(pagina.data.map((m) => m.uuid)).toEqual([emClaro]);
    } finally {
      await http('DELETE', `/token/${uuid}`, { headers: comSegredo(segredo) });
    }
  });
});
