import { JSON_ACCEPT, espera, expect, expectContentType, listar, test } from '../../support/contrato.js';

test.describe('GET /token/{id}/requests', () => {
  test('token sem mensagens: página vazia', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const res = await request.get(`/token/${token.uuid}/requests`, { headers: JSON_ACCEPT });
    expect(res.status()).toBe(200);
    expectContentType(res, 'application/json');
    expect(await res.json()).toEqual({ data: [], total: 0, per_page: 50, current_page: 1, is_last_page: true, from: 1, to: 0 });
  });

  test('paginação: from, to, is_last_page, total, per_page, current_page (inclusive além do fim)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const enviados = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const res = await request.get(`/${token.uuid}`);
      enviados.add(res.headers()['x-request-id']!);
    }

    const semPagina = await listar(request, token.uuid);
    const { data: todos, ...metaPadrao } = semPagina;
    expect(metaPadrao).toEqual({ total: 7, per_page: 50, current_page: 1, is_last_page: true, from: 1, to: 7 });
    expect(new Set(todos.map((m) => m.uuid))).toEqual(enviados);

    const vistos = new Set<string>();
    const esperadas = [
      { current_page: 1, is_last_page: false, from: 1, to: 3, n: 3 },
      { current_page: 2, is_last_page: false, from: 4, to: 6, n: 3 },
      { current_page: 3, is_last_page: true, from: 7, to: 7, n: 1 },
    ];
    for (const e of esperadas) {
      const { data, ...meta } = await listar(request, token.uuid, `per_page=3&page=${e.current_page}`);
      expect(meta).toEqual({ total: 7, per_page: 3, current_page: e.current_page, is_last_page: e.is_last_page, from: e.from, to: e.to });
      expect(data).toHaveLength(e.n);
      for (const m of data) vistos.add(m.uuid);
    }
    expect(vistos).toEqual(enviados);

    // Além do fim: data vazia, from > to.
    expect(await listar(request, token.uuid, 'per_page=3&page=4')).toEqual({
      data: [], total: 7, per_page: 3, current_page: 4, is_last_page: true, from: 10, to: 7,
    });
    expect(await listar(request, token.uuid, 'per_page=3&page=6')).toEqual({
      data: [], total: 7, per_page: 3, current_page: 6, is_last_page: true, from: 16, to: 7,
    });
  });

  test('ordenação oldest (padrão) e newest; valor desconhecido = oldest', async ({ request, tokens }) => {
    test.setTimeout(30_000);
    const token = await tokens.criar();
    // created_at tem resolução de segundo e mensagens no mesmo segundo têm ordem indefinida:
    // espaçar mais de 1 s entre elas.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) await espera(1100);
      ids.push((await request.get(`/${token.uuid}`)).headers()['x-request-id']!);
    }
    const uuids = async (q: string) => (await listar(request, token.uuid, q)).data.map((m) => m.uuid);
    expect(await uuids('')).toEqual(ids);
    expect(await uuids('sorting=oldest')).toEqual(ids);
    expect(await uuids('sorting=newest')).toEqual([...ids].reverse());
    expect(await uuids('sorting=qualquer')).toEqual(ids);
    expect(await uuids('sorting=newest&per_page=2&page=1')).toEqual([ids[2], ids[1]]);
    expect(await uuids('sorting=newest&per_page=2&page=2')).toEqual([ids[0]]);
  });
});
