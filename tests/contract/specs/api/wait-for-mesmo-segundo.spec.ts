import type { APIRequestContext } from '@playwright/test';
import { disparar, expect, listar, test, type Mensagem } from '../../support/contrato.js';
import { esperar } from '../../support/espera.js';

// Decisões do Anzol, T4 (`.docs-arquivo/decisoes-anzol/api.md`): o cursor do wait-for, da listagem `after` e do CLI é
// o `seq`, único e estritamente crescente por URL, e nenhuma mensagem com o mesmo `created_at` é pulada.
//
// O que o contrato alcança é a mensagem NOVA: rajadas no mesmo segundo (e no mesmo microssegundo) já ganham `seq`
// distinto, e estes testes são guarda de regressão (passam no app de hoje). O defeito achado no estudo é das mensagens
// ANTIGAS: o backfill do índice (`requests-common.lua`, `legacyScore`) dá a toda mensagem gravada antes do índice o
// score `created_at × 10⁶`, e duas do mesmo segundo ficam com o mesmo `seq` — `after`, o `readHistory` do wait-for e
// o mapa por `seq` pulam ou sobrescrevem as irmãs. Mensagem antiga não se semeia pela API (nenhuma rota grava sem a
// captura; o contrato não escreve no Redis): o teste dessa correção é do backend, com o Redis em container.

/** Todas as mensagens em ordem `oldest` (a do índice). */
async function todas(request: APIRequestContext, t: string): Promise<Mensagem[]> {
  return (await listar(request, t, 'sorting=oldest&per_page=500')).data;
}

/** Grupos de mensagens com o mesmo `created_at`, só os com duas ou mais. */
function mesmoSegundo(mensagens: Mensagem[]): Mensagem[][] {
  const grupos = new Map<string, Mensagem[]>();
  for (const m of mensagens) grupos.set(m.created_at, [...(grupos.get(m.created_at) ?? []), m]);
  return [...grupos.values()].filter((g) => g.length >= 2);
}

test.describe('T4: mensagens do mesmo segundo e o cursor por seq', () => {
  test('rajada: seq único e estritamente crescente, também dentro do mesmo created_at', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await disparar(request, t, 150, { paralelas: 30 });
    const mensagens = await todas(request, t);
    expect(mensagens).toHaveLength(150);
    expect(mesmoSegundo(mensagens).length, 'pré-condição: a rajada tem mensagens no mesmo segundo').toBeGreaterThan(0);
    const seqs = mensagens.map((m) => m.seq);
    expect(new Set(seqs).size).toBe(150);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i], `posição ${i}`).toBeGreaterThan(seqs[i - 1]);
  });

  test('after no meio de um segundo: a listagem traz exatamente as seguintes, sem pular as irmãs', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await disparar(request, t, 60, { paralelas: 30 });
    const mensagens = await todas(request, t);
    const [grupo] = mesmoSegundo(mensagens);
    expect(grupo, 'pré-condição: mensagens no mesmo segundo').toBeDefined();
    for (const cursor of grupo.slice(0, -1)) {
      const i = mensagens.findIndex((m) => m.uuid === cursor.uuid);
      const { data } = await listar(request, t, `after=${cursor.seq}&per_page=100`);
      expect(data.map((m) => m.uuid), `after do seq ${cursor.seq}`).toEqual(mensagens.slice(i + 1).map((m) => m.uuid));
    }
  });

  test('wait-for: after no meio de um segundo e count atravessando o lote de 100 não pulam nem repetem', async ({ request, tokens }) => {
    test.setTimeout(120_000);
    const t = (await tokens.criar()).uuid;
    await disparar(request, t, 150, { paralelas: 30 });
    const mensagens = await todas(request, t);

    // As 100 primeiras, e depois as 50 que faltam a partir do seq da 100ª.
    const primeiras = (await esperar(request, t, { count: 100, after: 0, timeout: 0 })).resultado;
    expect(primeiras.requests.map((m) => m.uuid)).toEqual(mensagens.slice(0, 100).map((m) => m.uuid));
    const resto = (await esperar(request, t, { count: 50, after: primeiras.requests[99].seq, timeout: 0 })).resultado;
    expect(resto.matched).toBe(true);
    expect(resto.requests.map((m) => m.uuid)).toEqual(mensagens.slice(100).map((m) => m.uuid));

    // After em cada mensagem de um segundo com irmãs: as seguintes, todas.
    const [grupo] = mesmoSegundo(mensagens);
    expect(grupo, 'pré-condição: mensagens no mesmo segundo').toBeDefined();
    for (const cursor of grupo.slice(0, 3)) {
      const i = mensagens.findIndex((m) => m.uuid === cursor.uuid);
      const seguintes = mensagens.slice(i + 1, i + 1 + 100);
      const { resultado } = await esperar(request, t, { count: seguintes.length, after: cursor.seq, timeout: 0 });
      expect(resultado.requests.map((m) => m.uuid), `after do seq ${cursor.seq}`).toEqual(seguintes.map((m) => m.uuid));
    }
  });
});
