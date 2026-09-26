import type { APIRequestContext } from '@playwright/test';
import {
  JSON_ACCEPT, buscarMensagem, disparar, expect, expectContentType, listar, test, type Listagem, type Mensagem,
} from '../../support/contrato.js';

// `seq`: número de ordem da mensagem na URL. É o que o CLI usa como cursor para reenviar sem perder
// nem duplicar (o evento SSE sai fora da ordem de gravação sob concorrência, e a paginação por
// página desloca quando alguém apaga). `after=<seq>` na listagem devolve as mensagens seguintes.

const ENVELOPE = ['current_page', 'data', 'from', 'is_last_page', 'per_page', 'to', 'total'];

/** Listagem inteira na ordem `oldest`, com os `seq`. */
async function todas(request: APIRequestContext, tokenId: string): Promise<Mensagem[]> {
  const msgs: Mensagem[] = [];
  for (let pagina = 1; ; pagina++) {
    const { data, is_last_page } = await listar(request, tokenId, `per_page=500&page=${pagina}`);
    msgs.push(...data);
    if (is_last_page) return msgs;
  }
}

function esperarCrescente(seqs: number[]): void {
  for (const s of seqs) expect(Number.isInteger(s), `seq ${JSON.stringify(s)} não é inteiro`).toBe(true);
  for (let i = 1; i < seqs.length; i++) {
    expect(seqs[i], `seq na posição ${i} (${seqs[i]}) não é maior que o anterior (${seqs[i - 1]}): ${seqs.join(',')}`).toBeGreaterThan(seqs[i - 1]);
  }
}

/** `GET /token/{id}/requests?after=…` (mais `extra`), exigindo 200 e o envelope de sempre. */
async function depois(request: APIRequestContext, tokenId: string, after: number, extra = ''): Promise<Listagem> {
  const pagina = await listar(request, tokenId, `after=${after}${extra ? `&${extra}` : ''}`);
  expect(Object.keys(pagina).sort()).toEqual(ENVELOPE);
  for (const campo of ['total', 'per_page', 'current_page', 'from', 'to'] as const) expect(typeof pagina[campo]).toBe('number');
  const seqs = pagina.data.map((m) => m.seq);
  esperarCrescente(seqs);
  for (const s of seqs) expect(s, `after=${after} devolveu seq ${s}`).toBeGreaterThan(after);
  return pagina;
}

const uuids = (msgs: Mensagem[]) => msgs.map((m) => m.uuid);

test.describe('seq da mensagem', () => {
  test('inteiro ≥ 1 na listagem e no GET de uma mensagem, igual nos dois, crescente na ordem de gravação', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const ids = await disparar(request, token.uuid, 5, { paralelas: 1 });
    const lista = await todas(request, token.uuid);
    expect(uuids(lista)).toEqual(ids);
    for (const m of lista) {
      expect(Number.isInteger(m.seq), `seq de ${m.uuid}: ${JSON.stringify(m.seq)}`).toBe(true);
      expect(m.seq).toBeGreaterThanOrEqual(1);
      expect((await buscarMensagem(request, token.uuid, m.uuid)).seq).toBe(m.seq);
    }
    esperarCrescente(lista.map((m) => m.seq));
  });

  test('100 POSTs, 20 em paralelo: seq único e estritamente crescente na ordem oldest, igual no GET; after pagina na mesma ordem', async ({ request, tokens }) => {
    test.setTimeout(120_000);
    const token = await tokens.criar();
    const ids = await disparar(request, token.uuid, 100, { paralelas: 20, opcoes: { method: 'POST', data: 'rajada' } });
    const lista = await todas(request, token.uuid);
    expect(new Set(uuids(lista))).toEqual(new Set(ids));
    expect(lista).toHaveLength(100);

    const seqs = lista.map((m) => m.seq);
    esperarCrescente(seqs);
    expect(new Set(seqs).size).toBe(100);
    // Ordenar pelo seq dá a ordem oldest; newest é o inverso.
    expect(uuids([...lista].sort((a, b) => a.seq - b.seq))).toEqual(uuids(lista));
    expect(uuids((await listar(request, token.uuid, 'sorting=newest&per_page=100')).data)).toEqual(uuids(lista).reverse());

    for (const m of lista) expect((await buscarMensagem(request, token.uuid, m.uuid)).seq, `seq de ${m.uuid} no GET`).toBe(m.seq);

    // after=0 sem per_page: as 50 primeiras (padrão da listagem); depois a partir da 50ª.
    const primeira = await depois(request, token.uuid, 0);
    expect(uuids(primeira.data)).toEqual(uuids(lista.slice(0, 50)));
    expect(primeira.data.map((m) => m.seq)).toEqual(seqs.slice(0, 50));
    expect(primeira.is_last_page).toBe(false);
    expect(primeira.per_page).toBe(50);
    expect(primeira.total).toBe(100);
    const segunda = await depois(request, token.uuid, seqs[49]);
    expect(uuids(segunda.data)).toEqual(uuids(lista.slice(50)));
    expect(segunda.is_last_page, 'as 50 devolvidas são as últimas').toBe(true);
  });

  test('seq não é reaproveitado: apagar a mais nova, ou todas, não faz a seguinte repetir um seq', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await disparar(request, token.uuid, 3, { paralelas: 1 });
    const antes = await todas(request, token.uuid);
    const maior = antes[2].seq;

    await request.delete(`/token/${token.uuid}/request/${antes[2].uuid}`, { headers: JSON_ACCEPT });
    const [quarta] = await disparar(request, token.uuid, 1);
    const q = await buscarMensagem(request, token.uuid, quarta);
    expect(q.seq, 'a mensagem nova depois de apagar a mais nova').toBeGreaterThan(maior);

    expect((await request.delete(`/token/${token.uuid}/request`, { headers: JSON_ACCEPT })).status()).toBe(200);
    const [quinta] = await disparar(request, token.uuid, 1);
    expect((await buscarMensagem(request, token.uuid, quinta)).seq, 'a mensagem nova depois de apagar todas').toBeGreaterThan(q.seq);
  });
});

test.describe('GET /token/{id}/requests?after=<seq>', () => {
  async function sete(request: APIRequestContext, tokens: { criar(): Promise<{ uuid: string }> }) {
    const token = await tokens.criar();
    await disparar(request, token.uuid, 7, { paralelas: 1 });
    const lista = await todas(request, token.uuid);
    expect(lista).toHaveLength(7);
    return { token: token.uuid, lista, seq: lista.map((m) => m.seq) };
  }

  test('after=0 devolve todas, em ordem de seq; é a última página', async ({ request, tokens }) => {
    const { token, lista } = await sete(request, tokens);
    const p = await depois(request, token, 0);
    expect(p.data).toEqual(lista);
    expect(p.is_last_page).toBe(true);
    expect(p.total).toBe(7);
    expect(p.per_page).toBe(50);
  });

  test('só as de seq maior, em ordem crescente, no máximo per_page; is_last_page quando nada vem depois', async ({ request, tokens }) => {
    const { token, lista, seq } = await sete(request, tokens);

    const p1 = await depois(request, token, seq[1], 'per_page=3');
    expect(uuids(p1.data)).toEqual(uuids(lista.slice(2, 5)));
    expect(p1.is_last_page).toBe(false);
    expect(p1.per_page).toBe(3);
    expect(p1.total, 'total continua sendo o da URL').toBe(7);

    // Exatamente per_page restantes: nada depois delas → última página.
    const p2 = await depois(request, token, seq[3], 'per_page=3');
    expect(uuids(p2.data)).toEqual(uuids(lista.slice(4)));
    expect(p2.is_last_page).toBe(true);

    const p3 = await depois(request, token, seq[4], 'per_page=3');
    expect(uuids(p3.data)).toEqual(uuids(lista.slice(5)));
    expect(p3.is_last_page).toBe(true);

    // after = seq da última → vazio e última página.
    const vazia = await depois(request, token, seq[6], 'per_page=3');
    expect(vazia.data).toEqual([]);
    expect(vazia.is_last_page).toBe(true);

    // after acima de qualquer seq → idem.
    const alem = await depois(request, token, seq[6] + 1_000_000);
    expect(alem.data).toEqual([]);
    expect(alem.is_last_page).toBe(true);
  });

  test('page e sorting são ignorados quando há after', async ({ request, tokens }) => {
    const { token, lista, seq } = await sete(request, tokens);
    const base = await depois(request, token, seq[1], 'per_page=3');
    for (const extra of ['per_page=3&page=2', 'per_page=3&sorting=newest', 'per_page=3&page=3&sorting=newest']) {
      const p = await depois(request, token, seq[1], extra);
      expect(uuids(p.data), extra).toEqual(uuids(lista.slice(2, 5)));
      expect(p.is_last_page, extra).toBe(base.is_last_page);
    }
  });

  test('after de mensagem apagada continua valendo: no meio e a mais nova', async ({ request, tokens }) => {
    const { token, lista, seq } = await sete(request, tokens);

    expect((await request.delete(`/token/${token}/request/${lista[3].uuid}`, { headers: JSON_ACCEPT })).status()).toBe(200);
    const doMeio = await depois(request, token, seq[3]);
    expect(uuids(doMeio.data)).toEqual(uuids(lista.slice(4)));
    expect(doMeio.is_last_page).toBe(true);
    // Quem estava antes da apagada não pula nada além dela.
    expect(uuids((await depois(request, token, seq[2])).data)).toEqual(uuids(lista.slice(4)));

    expect((await request.delete(`/token/${token}/request/${lista[6].uuid}`, { headers: JSON_ACCEPT })).status()).toBe(200);
    const semNada = await depois(request, token, seq[6]);
    expect(semNada.data).toEqual([]);
    expect(semNada.is_last_page).toBe(true);

    const [nova] = await disparar(request, token, 1);
    const aposApagada = await depois(request, token, seq[6]);
    expect(uuids(aposApagada.data), 'a mensagem nova vem depois do cursor apagado').toEqual([nova]);
  });

  for (const [nome, valor, mensagem] of [
    ['texto', 'abc', 'The after must be an integer.'],
    ['fracionário', '1.5', 'The after must be an integer.'],
    ['negativo', '-1', 'The after must be at least 0.'],
  ] as const) {
    test(`after ${nome} → 422 no estilo do Laravel`, async ({ request, tokens }) => {
      const token = await tokens.criar();
      await disparar(request, token.uuid, 1);
      const res = await request.get(`/token/${token.uuid}/requests?after=${valor}`, { headers: JSON_ACCEPT });
      expect(res.status()).toBe(422);
      expectContentType(res, 'application/json');
      expect(await res.json()).toEqual({ after: [mensagem] });
    });
  }
});
