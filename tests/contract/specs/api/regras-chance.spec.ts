import type { APIRequestContext } from '@playwright/test';
import { JSON_ACCEPT, buscarMensagem, enviarEGuardar, expect, listar, type Mensagem } from '../../support/contrato.js';
import { test, textoDo } from '../../support/mcp.js';
import {
  erros422, estadoDoCenario, lerRegras, lerTrace, putRegras, salvarRegras, testarRegra,
  type RegraSalva, type ResultadoTesteDeRegra,
} from '../../support/regras.js';

/** O número sorteado da frase `chance {C}%: rolled {N}, not applied`; exige N entre C+1 e 100. */
function sorteado(frase: string, chance: number): number {
  const achado = new RegExp(`^chance ${chance}%: rolled (\\d+), not applied$`).exec(frase);
  expect(achado, `frase do sorteio: ${frase}`).not.toBeNull();
  const n = Number(achado![1]);
  expect(n, frase).toBeGreaterThan(chance);
  expect(n, frase).toBeLessThanOrEqual(100);
  return n;
}

/** Dispara `quantidade` POSTs em lotes de 20 e devolve os status, na ordem. */
async function disparar(request: APIRequestContext, tokenId: string, caminho: string, quantidade: number): Promise<{ status: number; id: string }[]> {
  const respostas: { status: number; id: string }[] = [];
  for (let i = 0; i < quantidade; i += 20) {
    const lote = await Promise.all(
      Array.from({ length: Math.min(20, quantidade - i) }, () => request.post(`/${tokenId}${caminho}`, { data: 'x' })),
    );
    respostas.push(...lote.map((r) => ({ status: r.status(), id: r.headers()['x-request-id']! })));
  }
  return respostas;
}

async function todas(request: APIRequestContext, tokenId: string): Promise<Mensagem[]> {
  return (await listar(request, tokenId, 'per_page=500')).data;
}

async function salvarComChance(request: APIRequestContext, tokenId: string, regras: Parameters<typeof salvarRegras>[2]): Promise<RegraSalva[]> {
  const salvas = await salvarRegras(request, tokenId, regras);
  salvas.forEach((salva, i) => expect(salva.chance, `chance da regra ${salva.name}`).toBe(regras[i].chance ?? undefined));
  return salvas;
}

test.describe('chance: ida e volta e validação', () => {
  test('1, 50 e 100 vão e voltam; sem chance ou com null, a chave não aparece', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const salvas = await salvarRegras(request, token.uuid, [
      { name: 'um', chance: 1 }, { name: 'metade', chance: 50 }, { name: 'todas', chance: 100 }, { name: 'sem' }, { name: 'nula', chance: null },
    ]);
    expect(salvas.map((r) => r.chance)).toEqual([1, 50, 100, undefined, undefined]);
    expect('chance' in salvas[3]).toBe(false);
    expect('chance' in salvas[4]).toBe(false);
    expect(await lerRegras(request, token.uuid)).toEqual(salvas);
  });

  test('fora de 1..100 ou não inteira → 422 em "0.chance"; no rules/test, em "chance"', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const casos: Array<[unknown, string]> = [
      [0, 'The chance must be between 1 and 100.'],
      [101, 'The chance must be between 1 and 100.'],
      [-5, 'The chance must be between 1 and 100.'],
      [1.5, 'The chance must be an integer.'],
      ['20', 'The chance must be an integer.'],
      [true, 'The chance must be an integer.'],
      [{}, 'The chance must be an integer.'],
    ];
    for (const [chance, mensagem] of casos) {
      const corpo = await erros422(await putRegras(request, token.uuid, [{ name: 'x', chance }]));
      expect(corpo, `chance ${JSON.stringify(chance)}`).toEqual({ '0.chance': [mensagem] });
    }
    expect(await erros422(await testarRegra(request, token.uuid, { name: 'x', chance: 0 }))).toEqual({
      chance: ['The chance must be between 1 and 100.'],
    });
    expect(await lerRegras(request, token.uuid)).toEqual([]);
  });
});

test.describe('chance: o sorteio', () => {
  test('chance 30 em 400 requisições: aplica em 30% ± 7 p.p.; as outras gravam o sorteio no near_miss', async ({ request, tokens }) => {
    test.setTimeout(120_000);
    const token = await tokens.criar();
    const [regra] = await salvarComChance(request, token.uuid, [
      { name: 'instável', chance: 30, match: { path: { equals: '/sorteio' } }, response: { status: 201 } },
    ]);

    const respostas = await disparar(request, token.uuid, '/sorteio', 400);
    expect(respostas.filter((r) => r.status !== 200 && r.status !== 201)).toEqual([]);
    const aplicadas = respostas.filter((r) => r.status === 201).length;
    expect(aplicadas / 400, `${aplicadas} de 400`).toBeGreaterThanOrEqual(0.23);
    expect(aplicadas / 400, `${aplicadas} de 400`).toBeLessThanOrEqual(0.37);

    const mensagens = await todas(request, token.uuid);
    expect(mensagens).toHaveLength(400);
    for (const m of mensagens) {
      if (m.rule) {
        expect(m.rule).toEqual({ id: regra.id, name: 'instável' });
        expect(m.response).toEqual({ status: 201 });
        expect(m.near_miss).toBeNull();
      } else {
        expect(m.response).toEqual({ status: 200 });
        expect(m.near_miss).toMatchObject({ id: regra.id, name: 'instável', conditions: ['chance'] });
        expect(m.near_miss!.failed).toHaveLength(1);
        sorteado(m.near_miss!.failed[0], 30);
      }
    }
    expect(mensagens.filter((m) => m.rule).length).toBe(aplicadas);
  });

  test('o trace mostra o sorteio da captura, sempre o mesmo; rules/test com a regra salva dá o mesmo', async ({ request, tokens }) => {
    test.setTimeout(120_000);
    const token = await tokens.criar();
    const [regra] = await salvarComChance(request, token.uuid, [{ name: 'moeda', chance: 50, response: { status: 201 } }]);
    const respostas = await disparar(request, token.uuid, '', 40);

    const aplicadas = new Set<string>();
    const puladas = new Map<string, string[]>();
    for (const { id } of respostas) {
      const msg = await buscarMensagem(request, token.uuid, id);
      const trace = await lerTrace(request, token.uuid, id);
      const [naLista] = trace.rules;
      if (msg.rule) {
        aplicadas.add(id);
        expect(trace.responded_by).toEqual({ id: regra.id, name: 'moeda' });
        expect(naLista).toMatchObject({ id: regra.id, matches: true, failed: [], conditions: [] });
      } else {
        puladas.set(id, msg.near_miss!.failed);
        expect(trace.responded_by).toBeNull();
        expect(naLista).toMatchObject({ id: regra.id, matches: false, conditions: ['chance'] });
        expect(naLista.failed).toEqual(msg.near_miss!.failed);
        sorteado(naLista.failed[0], 50);
      }
      expect(await lerTrace(request, token.uuid, id)).toEqual(trace);
    }
    expect(aplicadas.size, 'alguma aplicou').toBeGreaterThan(0);
    expect(puladas.size, 'alguma foi pulada').toBeGreaterThan(0);

    const res = await testarRegra(request, token.uuid, regra);
    expect(res.status(), await res.text()).toBe(200);
    const resultado = (await res.json()) as ResultadoTesteDeRegra;
    expect(new Set(resultado.matches.map((m) => m.uuid))).toEqual(aplicadas);
    expect(new Set(resultado.misses.map((m) => m.uuid))).toEqual(new Set(puladas.keys()));
    for (const miss of resultado.misses) {
      expect(miss.failed).toEqual(puladas.get(miss.uuid));
      expect(miss.conditions).toEqual(['chance']);
    }
  });

  test('a parte que não aplicou segue para a próxima regra', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [a, b] = await salvarComChance(request, token.uuid, [
      { name: 'A', priority: 1, chance: 50, response: { status: 201 } },
      { name: 'B', priority: 2, response: { status: 202 } },
    ]);
    const respostas = await disparar(request, token.uuid, '', 60);
    const status = new Set(respostas.map((r) => r.status));
    expect(status).toEqual(new Set([201, 202]));

    for (const { id } of respostas.filter((r) => r.status === 202).slice(0, 5)) {
      const trace = await lerTrace(request, token.uuid, id);
      expect(trace.responded_by).toEqual({ id: b.id, name: 'B' });
      expect(trace.rules.find((r) => r.id === a.id)).toMatchObject({ matches: false, conditions: ['chance'] });
      expect(trace.rules.find((r) => r.id === b.id)).toMatchObject({ matches: true, failed: [] });
    }
  });

  test('a regra pulada pelo sorteio não muda o estado do cenário', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarComChance(request, token.uuid, [
      { name: 'vira', priority: 1, chance: 50, scenario: { name: 'fluxo', newState: 'virou' }, response: { status: 201 } },
      { name: 'resto', priority: 2, response: { status: 202 } },
    ]);
    let pulou = false;
    for (let i = 0; i < 30 && !pulou; i++) {
      const res = await request.post(`/${token.uuid}`, { data: 'x' });
      if (res.status() === 202) {
        pulou = true;
        expect(await estadoDoCenario(request, token.uuid, 'fluxo')).toBe('Started');
      } else {
        expect(res.status()).toBe(201);
        expect(await estadoDoCenario(request, token.uuid, 'fluxo')).toBe('virou');
        expect((await request.delete(`/token/${token.uuid}/scenarios`, { headers: JSON_ACCEPT })).status()).toBe(200);
      }
    }
    expect(pulou, 'em 30 tentativas com chance 50, alguma é pulada').toBe(true);
  });

  test('sem as condições casando não há sorteio: o near_miss só tem a condição que falhou', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [regra] = await salvarComChance(request, token.uuid, [{ name: 'x', chance: 1, match: { path: { equals: '/x' } } }]);
    const { msg } = await enviarEGuardar(request, token.uuid, '/y', { method: 'POST' });
    expect(msg.near_miss).toMatchObject({ id: regra.id, conditions: ['match.path'] });
    expect(msg.near_miss!.failed).toHaveLength(1);
  });
});

test.describe('regras sem os campos novos', () => {
  test('a regra salva não ganha chance nem janela e responde a todas as requisições', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [regra] = await salvarRegras(request, token.uuid, [{ name: 'sempre', response: { status: 201 } }]);
    for (const chave of ['chance', 'active_from', 'active_until']) expect(chave in regra, chave).toBe(false);
    const respostas = await disparar(request, token.uuid, '', 50);
    expect(respostas.every((r) => r.status === 201)).toBe(true);
    const trace = await lerTrace(request, token.uuid, respostas[0].id);
    expect(trace.rules).toEqual([expect.objectContaining({ id: regra.id, matches: true, failed: [], conditions: [] })]);
  });

  test('null em chance, active_from e active_until vale como ausente', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [regra] = await salvarRegras(request, token.uuid, [{ name: 'nulos', chance: null, active_from: null, active_until: null }]);
    for (const chave of ['chance', 'active_from', 'active_until']) expect(chave in regra, chave).toBe(false);
  });
});

test.describe('MCP', () => {
  test('set_rules aceita chance, janela e as falhas novas; get_rules devolve; a descrição de set_rules as cita', async ({ request, tokens, mcp }) => {
    const token = await tokens.criar();
    const regras = [
      { name: 'instável', chance: 25, active_from: '2026-09-29T12:00:00Z', active_until: '2099-01-01T00:00:00Z', response: { status: 503 } },
      { name: 'corta', response: { body: 'abcd', fault: 'truncated_body' } },
    ];
    const salvas = await mcp.chamarOk<RegraSalva[]>('set_rules', { rules: regras }, token.uuid);
    expect(salvas[0]).toMatchObject({ chance: 25, active_from: '2026-09-29T12:00:00Z', active_until: '2099-01-01T00:00:00Z' });
    expect(salvas[1].response.fault).toBe('truncated_body');
    expect(await mcp.chamarOk('get_rules', {}, token.uuid)).toEqual(salvas);
    expect(await lerRegras(request, token.uuid)).toEqual(salvas);

    const ruim = await mcp.chamar('set_rules', { rules: [{ name: 'x', chance: 0 }] }, token.uuid);
    expect(ruim.isError, textoDo(ruim).slice(0, 300)).toBe(true);
    expect(textoDo(ruim)).toContain('The chance must be between 1 and 100.');

    const descricao = mcp.ferramentas.get('set_rules')!.description ?? '';
    for (const termo of ['chance', 'active_from', 'active_until', 'hang', 'stall_after_headers', 'truncated_body']) {
      expect(descricao, `a descrição de set_rules cita ${termo}`).toContain(termo);
    }
  });
});
