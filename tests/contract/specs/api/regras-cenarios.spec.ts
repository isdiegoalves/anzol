import type { APIRequestContext, APIResponse } from '@playwright/test';
import { JSON_ACCEPT, enviarEGuardar, expect, expectErroJson, listar, test } from '../../support/contrato.js';
import {
  erros422, estadoDoCenario, expectFalhas, lerCenarios, lerRegras, putRegras, salvarRegras, type Regra,
} from '../../support/regras.js';

// Cenários com estado (CA-6, fatia 04, Anexo B): estado por (URL, nome do cenário), inicial
// `Started`. A regra com `scenario: {name, requiredState?, newState?}` só casa quando o estado atual
// é `requiredState` (ausente = qualquer) e, AO RESPONDER, muda o estado para `newState` (ausente =
// mantém). Escolha da regra + transição são atômicas por URL. API: `GET /token/{id}/scenarios`,
// `PUT /token/{id}/scenarios/{nome}` `{state}` e `DELETE /token/{id}/scenarios` (todos a `Started`).
// Os status de sucesso do PUT e do DELETE não estão fixados no Anexo B: o contrato aceita qualquer 2xx.

function expect2xx(res: APIResponse, oque: string): void {
  expect(res.status(), oque).toBeGreaterThanOrEqual(200);
  expect(res.status(), oque).toBeLessThan(300);
}

function resetar(request: APIRequestContext, tokenId: string): Promise<APIResponse> {
  return request.delete(`/token/${tokenId}/scenarios`, { headers: JSON_ACCEPT });
}

function definirEstado(request: APIRequestContext, tokenId: string, nome: string, state: string): Promise<APIResponse> {
  return request.put(`/token/${tokenId}/scenarios/${encodeURIComponent(nome)}`, { data: { state }, headers: JSON_ACCEPT });
}

/** "Falha 3×, depois 200": três 503 com Retry-After encadeando estados e uma 200 final que mantém o estado. */
const ENTREGA: Regra[] = [
  { name: 'falha 1', scenario: { name: 'entrega', requiredState: 'Started', newState: 'falhou-1' }, response: { status: 503, headers: { 'Retry-After': '1' }, body: 'indisponível 1' } },
  { name: 'falha 2', scenario: { name: 'entrega', requiredState: 'falhou-1', newState: 'falhou-2' }, response: { status: 503, headers: { 'Retry-After': '2' }, body: 'indisponível 2' } },
  { name: 'falha 3', scenario: { name: 'entrega', requiredState: 'falhou-2', newState: 'ok' }, response: { status: 503, headers: { 'Retry-After': '3' }, body: 'indisponível 3' } },
  { name: 'sucesso', scenario: { name: 'entrega', requiredState: 'ok' }, response: { status: 200, body: 'entregue' } },
];

async function entregar(request: APIRequestContext, tokenId: string): Promise<{ status: number; retryAfter?: string; corpo: string; regra?: string }> {
  const { res, msg } = await enviarEGuardar(request, tokenId, '/entregas', { method: 'POST', data: Buffer.from('{"id":1}') });
  return { status: res.status(), retryAfter: res.headers()['retry-after'], corpo: await res.text(), regra: msg.rule?.name };
}

const FALHA_3X_DEPOIS_200 = [
  { status: 503, retryAfter: '1', corpo: 'indisponível 1', regra: 'falha 1' },
  { status: 503, retryAfter: '2', corpo: 'indisponível 2', regra: 'falha 2' },
  { status: 503, retryAfter: '3', corpo: 'indisponível 3', regra: 'falha 3' },
  { status: 200, retryAfter: undefined, corpo: 'entregue', regra: 'sucesso' },
  { status: 200, retryAfter: undefined, corpo: 'entregue', regra: 'sucesso' },
];

test.describe('cenários: falha 3×, depois 200', () => {
  test('três 503 com Retry-After e depois 200 (que fica); reset volta ao começo', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_status: 418, default_content: 'padrão' });
    const salvas = await salvarRegras(request, token.uuid, ENTREGA);
    expect(salvas.map((r) => r.scenario)).toEqual(ENTREGA.map((r) => r.scenario));

    const recebidas = [];
    for (let i = 0; i < 5; i++) recebidas.push(await entregar(request, token.uuid));
    expect(recebidas).toEqual(FALHA_3X_DEPOIS_200);
    expect(await estadoDoCenario(request, token.uuid, 'entrega')).toBe('ok');

    expect2xx(await resetar(request, token.uuid), 'DELETE /token/{id}/scenarios');
    expect(await estadoDoCenario(request, token.uuid, 'entrega')).toBe('Started');
    const deNovo = [];
    for (let i = 0; i < 5; i++) deNovo.push(await entregar(request, token.uuid));
    expect(deNovo).toEqual(FALHA_3X_DEPOIS_200);
  });
});

test.describe('cenários: API', () => {
  test('GET lista cada cenário citado pelas regras, em Started antes da primeira requisição, com os estados citados', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(await lerCenarios(request, token.uuid)).toEqual([]);
    await salvarRegras(request, token.uuid, [
      ...ENTREGA,
      { name: 'outro', scenario: { name: 'login', newState: 'logado' }, response: { status: 200 } },
    ]);
    const cenarios = await lerCenarios(request, token.uuid);
    expect(cenarios.map((c) => c.name).sort()).toEqual(['entrega', 'login']);
    for (const c of cenarios) expect(Object.keys(c).sort()).toEqual(['name', 'state', 'states']);
    const entrega = cenarios.find((c) => c.name === 'entrega')!;
    expect(entrega.state).toBe('Started');
    // Ordem de `states` fora do contrato.
    expect([...entrega.states].sort()).toEqual(['Started', 'falhou-1', 'falhou-2', 'ok'].sort());
    const login = cenarios.find((c) => c.name === 'login')!;
    expect(login.state).toBe('Started');
    expect(login.states).toContain('logado');
  });

  test('PUT /scenarios/{nome} define o estado à mão e a próxima requisição segue dele', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, ENTREGA);
    expect2xx(await definirEstado(request, token.uuid, 'entrega', 'falhou-2'), 'PUT /token/{id}/scenarios/entrega');
    expect(await estadoDoCenario(request, token.uuid, 'entrega')).toBe('falhou-2');
    expect(await entregar(request, token.uuid)).toEqual(FALHA_3X_DEPOIS_200[2]);
    expect(await entregar(request, token.uuid)).toEqual(FALHA_3X_DEPOIS_200[3]);
  });

  test('DELETE /scenarios volta TODOS os cenários da URL a Started', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [
      { name: 'a', match: { path: { equals: '/a' } }, scenario: { name: 'A', newState: 'a-feito' } },
      { name: 'b', match: { path: { equals: '/b' } }, scenario: { name: 'B', newState: 'b-feito' } },
    ]);
    await request.get(`/${token.uuid}/a`);
    await request.get(`/${token.uuid}/b`);
    expect(await estadoDoCenario(request, token.uuid, 'A')).toBe('a-feito');
    expect(await estadoDoCenario(request, token.uuid, 'B')).toBe('b-feito');
    expect2xx(await resetar(request, token.uuid), 'DELETE /token/{id}/scenarios');
    expect(await estadoDoCenario(request, token.uuid, 'A')).toBe('Started');
    expect(await estadoDoCenario(request, token.uuid, 'B')).toBe('Started');
  });

  test('regra com scenario vai e volta no PUT/GET das regras', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const salvas = await salvarRegras(request, token.uuid, ENTREGA);
    expect(await lerRegras(request, token.uuid)).toEqual(salvas);
    expect(salvas[3].scenario).toEqual({ name: 'entrega', requiredState: 'ok' });
  });

  test('validação: scenario sem nome ou com nome de 101 caracteres → 422 em "0.scenario.name"', async ({ request, tokens }) => {
    const token = await tokens.criar();
    for (const scenario of [{ requiredState: 'Started' }, { name: '' }, { name: 'n'.repeat(101) }]) {
      const corpo = await erros422(await putRegras(request, token.uuid, [{ name: 'x', scenario: scenario as never }]));
      expect(Object.keys(corpo), JSON.stringify(corpo)).toEqual(['0.scenario.name']);
      expect(corpo['0.scenario.name'][0]).toMatch(/^[A-Z].+\.$/);
    }
    // Nome de 100 caracteres é aceito.
    await salvarRegras(request, token.uuid, [{ name: 'x', scenario: { name: 'n'.repeat(100) } }]);
  });
});

test.describe('cenários: casamento e transição', () => {
  test('só a regra que RESPONDE muda o estado: outra que casaria no mesmo estado não transiciona', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [
      { name: 'melhor, sem cenário', priority: 1, match: { path: { equals: '/x' } }, response: { status: 201 } },
      { name: 'com cenário', priority: 9, scenario: { name: 'c', requiredState: 'Started', newState: 'passou' }, response: { status: 202 } },
    ]);
    expect((await request.get(`/${token.uuid}/x`)).status()).toBe(201);
    expect(await estadoDoCenario(request, token.uuid, 'c')).toBe('Started');
    expect((await request.get(`/${token.uuid}/y`)).status()).toBe(202);
    expect(await estadoDoCenario(request, token.uuid, 'c')).toBe('passou');
    // Em "passou" a regra exige Started: não casa mais, e sobra a resposta padrão.
    expect((await request.get(`/${token.uuid}/y`)).status()).toBe(200);
  });

  test('requiredState ausente casa em qualquer estado; newState ausente mantém o estado', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [
      { name: 'avança', match: { path: { equals: '/avanca' } }, scenario: { name: 'c', newState: 'depois' } },
      { name: 'lê', match: { path: { equals: '/le' } }, scenario: { name: 'c' }, response: { status: 207 } },
    ]);
    expect((await request.get(`/${token.uuid}/le`)).status()).toBe(207);
    expect(await estadoDoCenario(request, token.uuid, 'c')).toBe('Started');
    expect((await request.get(`/${token.uuid}/avanca`)).status()).toBe(200);
    expect(await estadoDoCenario(request, token.uuid, 'c')).toBe('depois');
    expect((await request.get(`/${token.uuid}/le`)).status()).toBe(207);
    expect(await estadoDoCenario(request, token.uuid, 'c')).toBe('depois');
  });

  test('o estado é por URL: o mesmo nome de cenário em outra URL não é afetado', async ({ request, tokens }) => {
    const [a, b] = [await tokens.criar(), await tokens.criar()];
    for (const t of [a, b]) await salvarRegras(request, t.uuid, ENTREGA);
    await entregar(request, a.uuid);
    await entregar(request, a.uuid);
    expect(await estadoDoCenario(request, a.uuid, 'entrega')).toBe('falhou-2');
    expect(await estadoDoCenario(request, b.uuid, 'entrega')).toBe('Started');
    expect(await entregar(request, b.uuid)).toEqual(FALHA_3X_DEPOIS_200[0]);
  });

  test('near miss: o estado errado vira a frase `scenario <nome>: expected state "X", got "Y"`', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [salva] = await salvarRegras(request, token.uuid, [
      { name: 'só depois de pago', match: { path: { equals: '/recibo' } }, scenario: { name: 'pagamento', requiredState: 'pago' }, response: { status: 201 } },
    ]);
    const { res, msg } = await enviarEGuardar(request, token.uuid, '/recibo');
    expect(res.status()).toBe(200);
    expect(msg.rule).toBeNull();
    expect(msg.near_miss).toEqual({
      id: salva.id, name: 'só depois de pago',
      failed: ['scenario pagamento: expected state "pago", got "Started"'],
      // Item 14, B1: a condição que produziu a frase.
      conditions: ['scenario'],
    });

    // Com o caminho errado também, as duas frases.
    const outro = await enviarEGuardar(request, token.uuid, '/outro');
    expect(outro.msg.near_miss!.failed).toHaveLength(2);
    expectFalhas(outro.msg.near_miss!.failed, [/^path\b/, /^scenario pagamento: expected state "pago", got "Started"$/]);

    // No estado certo, casa.
    expect2xx(await definirEstado(request, token.uuid, 'pagamento', 'pago'), 'PUT /token/{id}/scenarios/pagamento');
    const casou = await enviarEGuardar(request, token.uuid, '/recibo');
    expect(casou.res.status()).toBe(201);
    expect(casou.msg.rule).toEqual({ id: salva.id, name: 'só depois de pago' });
  });
});

test.describe('cenários: concorrência', () => {
  test('cenário de 5 passos com 20 requisições simultâneas: cada passo responde exatamente uma vez', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_status: 200, default_content: 'padrão' });
    const estados = ['Started', 'p1', 'p2', 'p3', 'p4', 'fim'];
    const STATUS = [230, 231, 232, 233, 234];
    await salvarRegras(request, token.uuid, STATUS.map((status, i) => ({
      name: `passo ${i + 1}`,
      scenario: { name: 'passos', requiredState: estados[i], newState: estados[i + 1] },
      response: { status, body: `passo ${i + 1}` },
    })));

    const respostas = await Promise.all(Array.from({ length: 20 }, () => request.post(`/${token.uuid}/passo`, { data: Buffer.from('x') })));
    const contagem: Record<number, number> = {};
    for (const r of respostas) contagem[r.status()] = (contagem[r.status()] ?? 0) + 1;
    expect(contagem).toEqual({ 200: 15, 230: 1, 231: 1, 232: 1, 233: 1, 234: 1 });
    expect(await estadoDoCenario(request, token.uuid, 'passos')).toBe('fim');

    // Todas gravadas; cada passo registrado em exatamente uma mensagem.
    const { data, total } = await listar(request, token.uuid, 'per_page=50');
    expect(total).toBe(20);
    expect(data.map((m) => m.rule?.name).filter(Boolean).sort()).toEqual(['passo 1', 'passo 2', 'passo 3', 'passo 4', 'passo 5']);
  });
});

test.describe('cenários: apagados com a URL', () => {
  test('depois do DELETE do token, GET/PUT/DELETE de cenários → 410', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, ENTREGA);
    await entregar(request, token.uuid);
    expect(await estadoDoCenario(request, token.uuid, 'entrega')).toBe('falhou-1');

    expect((await request.delete(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).status()).toBe(204);
    await expectErroJson(await request.get(`/token/${token.uuid}/scenarios`, { headers: JSON_ACCEPT }), 410, 'Token not found');
    await expectErroJson(await definirEstado(request, token.uuid, 'entrega', 'ok'), 410, 'Token not found');
    await expectErroJson(await resetar(request, token.uuid), 410, 'Token not found');
  });
});
