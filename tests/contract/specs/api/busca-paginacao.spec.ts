import { disparar, enviarEGuardar, expect, listar, test } from '../../support/contrato.js';
import { buscar, metaEsperada, uuidsDaBusca } from '../../support/busca.js';

// Paginação e ordenação da busca (CA-3, plano "busca-filtro-diff" §1): a resposta tem a forma do
// `GET /token/{id}/requests` e a mesma aritmética de `from`/`to`/`is_last_page`, com `total` = quantas
// casam. Padrões: `sorting` newest (o da listagem é oldest), `page` 1, `per_page` 50. Sem filtro, a busca
// é a listagem, e é comparada com ela diretamente; com filtro, a aritmética é a mesma sobre o `total`
// filtrado (`metaEsperada`, conferida contra a listagem no segundo teste).

const TEXTO_PLANO = { 'Content-Type': 'text/plain' };

test.describe('busca: paginação e ordenação (CA-3)', () => {
  test('URL sem mensagens: página vazia, igual à listagem', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const vazia = { data: [], total: 0, per_page: 50, current_page: 1, is_last_page: true, from: 1, to: 0 };
    expect(await buscar(request, t)).toEqual(vazia);
    expect(await buscar(request, t, { text: 'x', match: { method: ['POST'] } })).toEqual(vazia);
    expect(await listar(request, t)).toEqual(vazia);
  });

  test('sem filtro, cada página da busca é a página da listagem (mesmos itens e metadados)', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    // Sequenciais: várias caem no mesmo segundo, e a ordem tem de ser a de chegada.
    await disparar(request, t, 7, { paralelas: 1 });

    const combinacoes: Array<[page: number, perPage: number]> = [
      [1, 3], [2, 3], [3, 3], [4, 3], [6, 3], [1, 7], [2, 7], [1, 1], [7, 1], [8, 1], [1, 100], [1, 50],
    ];
    for (const sorting of ['oldest', 'newest'] as const) {
      for (const [page, perPage] of combinacoes) {
        const descricao = `sorting=${sorting} page=${page} per_page=${perPage}`;
        const listagem = await listar(request, t, `sorting=${sorting}&page=${page}&per_page=${perPage}`);
        const { data: _dados, ...meta } = listagem;
        expect(meta, `a aritmética de metaEsperada é a da listagem (${descricao})`).toEqual(metaEsperada(7, page, perPage));
        for (const filtro of [{}, { text: '' }, { match: {} }]) {
          const busca = await buscar(request, t, { ...filtro, sorting, page, per_page: perPage });
          expect(busca, `${descricao} ${JSON.stringify(filtro)}`).toEqual(listagem);
        }
      }
    }

    // Padrões: sorting newest, page 1, per_page 50.
    expect(await buscar(request, t)).toEqual(await listar(request, t, 'sorting=newest'));
    expect(await buscar(request, t, { per_page: 2 })).toEqual(await listar(request, t, 'sorting=newest&per_page=2'));
    expect(await buscar(request, t, { page: 2, per_page: 5 })).toEqual(await listar(request, t, 'sorting=newest&page=2&per_page=5'));
  });

  test('com filtro: total = quantas casam, from/to/is_last_page pela mesma aritmética, newest e oldest', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    // 9 mensagens, 5 com o marcador (ora em maiúsculas), intercaladas com as que não casam.
    const padrao = [true, false, true, true, false, true, false, false, true];
    const casam: string[] = [];
    const todas: string[] = [];
    for (const [i, casa] of padrao.entries()) {
      const conteudo = casa ? `item ${i} ${i % 2 ? 'MARCADOR-P' : 'marcador-p'}` : `item ${i} outro`;
      const { msg } = await enviarEGuardar(request, t, `/m${i}`, { method: 'POST', headers: TEXTO_PLANO, data: Buffer.from(conteudo) });
      todas.push(msg.uuid);
      if (casa) casam.push(msg.uuid);
    }
    expect((await listar(request, t)).total).toBe(9);

    for (const sorting of ['oldest', 'newest'] as const) {
      const ordem = sorting === 'oldest' ? casam : [...casam].reverse();
      const vistos: string[] = [];
      for (const page of [1, 2, 3]) {
        const { data, ...meta } = await buscar(request, t, { text: 'marcador-p', sorting, page, per_page: 2 });
        expect(meta, `${sorting} página ${page}`).toEqual(metaEsperada(5, page, 2));
        vistos.push(...data.map((m) => m.uuid));
      }
      expect(vistos, `${sorting}: as páginas juntas são as que casam, na ordem`).toEqual(ordem);

      for (const page of [4, 10]) {
        expect(await buscar(request, t, { text: 'marcador-p', sorting, page, per_page: 2 }), `${sorting} página ${page} (além do fim)`)
          .toEqual({ data: [], ...metaEsperada(5, page, 2) });
      }
      const tudo = await buscar(request, t, { text: 'MARCADOR-P', sorting });
      expect(tudo.data.map((m) => m.uuid)).toEqual(ordem);
      expect({ ...tudo, data: undefined }).toEqual({ ...metaEsperada(5, 1, 50), data: undefined });
      const exata = await buscar(request, t, { text: 'marcador-p', sorting, per_page: 5 });
      expect({ ...exata, data: undefined }).toEqual({ ...metaEsperada(5, 1, 5), data: undefined });
    }

    // Padrão newest; os itens são as mensagens como na listagem.
    const listagem = (await listar(request, t, 'sorting=newest')).data;
    const padraoNewest = await buscar(request, t, { text: 'marcador-p' });
    expect(padraoNewest.data).toEqual(listagem.filter((m) => casam.includes(m.uuid)));

    // Filtro por match: a mesma aritmética.
    const { data: posts, ...metaPosts } = await buscar(request, t, { match: { path: { regex: '^/m[0-4]$' } }, sorting: 'oldest', per_page: 2, page: 3 });
    expect(metaPosts).toEqual(metaEsperada(5, 3, 2));
    expect(posts.map((m) => m.uuid)).toEqual([todas[4]]);
  });

  test('mensagens no mesmo segundo: newest e oldest seguem a ordem de chegada, inclusive entre páginas', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const ids = await disparar(request, t, 12, { paralelas: 1 });
    const segundos = new Set((await listar(request, t)).data.map((m) => m.created_at));
    expect(segundos.size, 'as 12 mensagens deviam cair em poucos segundos').toBeLessThan(12);

    const paginado = async (sorting: 'oldest' | 'newest') => [
      ...(await uuidsDaBusca(request, t, { text: 'get', sorting, per_page: 5, page: 1 })),
      ...(await uuidsDaBusca(request, t, { text: 'get', sorting, per_page: 5, page: 2 })),
      ...(await uuidsDaBusca(request, t, { text: 'get', sorting, per_page: 5, page: 3 })),
    ];
    expect(await paginado('oldest')).toEqual(ids);
    expect(await paginado('newest')).toEqual([...ids].reverse());
    expect(await uuidsDaBusca(request, t, { text: 'GET' })).toEqual([...ids].reverse());
  });
});

test.describe('busca: varre todas as mensagens retidas', () => {
  // O `rules/test` considera só as 500 mais recentes; a busca varre todas (§1: "varre todas as
  // mensagens retidas da URL"). A mensagem que casa é a mais antiga de 520.

  test('text acha a mais antiga de 520', async ({ request, tokens }) => {
    test.setTimeout(120_000);
    const t = (await tokens.criar()).uuid;
    const { msg: antiga } = await enviarEGuardar(request, t, '/antiga', { method: 'POST', headers: TEXTO_PLANO, data: Buffer.from('agulha-no-palheiro') });
    await disparar(request, t, 519, { paralelas: 20 });

    const pagina = await buscar(request, t, { text: 'AGULHA-no-palheiro' });
    expect(pagina.data.map((m) => m.uuid)).toEqual([antiga.uuid]);
    expect(pagina.total).toBe(1);
    const semFiltro = await buscar(request, t, { per_page: 1 });
    expect(semFiltro.total).toBe(520);
    expect(semFiltro.is_last_page).toBe(false);
  });

  test('match acha a mais antiga de 520', async ({ request, tokens }) => {
    test.setTimeout(120_000);
    const t = (await tokens.criar()).uuid;
    const { msg: antiga } = await enviarEGuardar(request, t, '/antiga', { method: 'POST', headers: TEXTO_PLANO, data: Buffer.from('x') });
    await disparar(request, t, 519, { paralelas: 20 });

    for (const match of [{ method: ['POST'] }, { path: { equals: '/antiga' } }]) {
      const pagina = await buscar(request, t, { match });
      expect(pagina.data.map((m) => m.uuid), JSON.stringify(match)).toEqual([antiga.uuid]);
      expect(pagina.total, JSON.stringify(match)).toBe(1);
    }
  });
});
