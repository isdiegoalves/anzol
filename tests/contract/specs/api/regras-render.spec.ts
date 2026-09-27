import type { APIRequestContext } from '@playwright/test';
import { enviarEGuardar, expect, listar, test, type Mensagem } from '../../support/contrato.js';
import {
  erros422, estadoDoCenario, lerRegras, salvarRegras, testarRegra, testarRegraComRender,
  type Regra, type Renderizada, type ResultadoTesteComRender, type ResultadoTesteDeRegra,
} from '../../support/regras.js';

// UX de Regras, C4 (E-05, `.docs-arquivo/regras-ux/api-contrato.md`): `POST /token/{id}/rules/test?render=N`, N de 1
// a 3, acrescenta `rendered`: uma entrada para cada uma das N mensagens mais novas de `matches`, com a resposta que
// a regra daria — `{uuid, status, headers, body}`, `{uuid, fault}` ou `{uuid, error}`, com `error` `"timeout"` ou
// `"too_large"` (resolução 8: a resposta renderizada passa dos tetos, onde a execução real responderia 500). Mesmo motor do
// webhook (template, helpers, tetos), com `seq` e `now` de agora; helper que falha deixa o trecho vazio; sem atraso
// nem dribble; prazo total de 1 s. `render` fora de 1..3 ou não inteiro → 422 em `render`. Sem o parâmetro, a
// resposta é a de hoje.
//
// Fora do contrato: a entrada `{"error": "timeout"}`. Os tetos de `TemplateLimits` recusam (422) ou cortam antes de
// um template levar 1 s, e o contrato não controla o relógio do servidor; o corte fica com os testes do backend.

const JSON_CT = { 'Content-Type': 'application/json' };

/** Responde as POST com o id do corpo, no corpo e num cabeçalho. */
const ECO: Regra = {
  name: 'eco',
  match: { method: ['POST'] },
  response: {
    status: 201,
    headers: { 'Content-Type': 'application/json', 'X-Pedido': "{{jsonPath request.body '$.id'}}" },
    body: `{"eco":{{jsonPath request.body '$.id'}},"metodo":"{{request.method}}"}`,
    template: true,
  },
};

interface Cenario {
  /** POST /pedidos com `{"id": 1..4}`, gravadas nesta ordem. */
  pedidos: Mensagem[];
  /** GET /outro: não casa ECO. */
  outro: Mensagem;
}

async function montar(request: APIRequestContext, t: string): Promise<Cenario> {
  const pedidos: Mensagem[] = [];
  for (let id = 1; id <= 4; id++) {
    pedidos.push((await enviarEGuardar(request, t, '/pedidos', { method: 'POST', headers: JSON_CT, data: Buffer.from(`{"id":${id}}`) })).msg);
  }
  const { msg: outro } = await enviarEGuardar(request, t, '/outro');
  return { pedidos, outro };
}

async function renderizar(request: APIRequestContext, t: string, regra: Regra, render: number): Promise<ResultadoTesteComRender> {
  const res = await testarRegraComRender(request, t, regra, render);
  expect(res.status(), `rules/test?render=${render}: ${(await res.text()).slice(0, 500)}`).toBe(200);
  const resultado = (await res.json()) as ResultadoTesteComRender;
  expect(Object.keys(resultado).sort(), JSON.stringify(resultado).slice(0, 300)).toEqual(['matches', 'misses', 'rendered']);
  expect(Array.isArray(resultado.rendered), JSON.stringify(resultado.rendered)).toBe(true);
  return resultado;
}

/** Entrada de resposta renderizada: exatamente `{uuid, status, headers, body}`; cabeçalhos com nome em minúsculas. */
function resposta(entrada: Renderizada): { uuid: string; status: number; headers: Record<string, string>; body: string } {
  expect(Object.keys(entrada).sort(), JSON.stringify(entrada)).toEqual(['body', 'headers', 'status', 'uuid']);
  const r = entrada as { uuid: string; status: number; headers: Record<string, string>; body: string };
  expect(typeof r.headers, JSON.stringify(entrada)).toBe('object');
  // O api-contrato mostra `content-type` em minúsculas; o contrato compara o nome sem caixa.
  const headers = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { ...r, headers };
}

const porUuid = <T extends { uuid: string }>(itens: T[]): string[] => itens.map((i) => i.uuid).sort();

test.describe('C4: render no rules/test', () => {
  test('sem render: exatamente matches e misses, como hoje', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { pedidos, outro } = await montar(request, t);
    const res = await testarRegra(request, t, ECO);
    expect(res.status()).toBe(200);
    const resultado = (await res.json()) as ResultadoTesteDeRegra;
    expect(Object.keys(resultado).sort()).toEqual(['matches', 'misses']);
    expect(porUuid(resultado.matches)).toEqual(porUuid(pedidos));
    expect(porUuid(resultado.misses)).toEqual([outro.uuid]);
  });

  test('render=2: as 2 mensagens mais novas de matches, da mais nova para a mais antiga, com status, cabeçalhos e corpo renderizados', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { pedidos, outro } = await montar(request, t);
    const resultado = await renderizar(request, t, ECO, 2);
    // `matches` e `misses` não mudam com o render.
    expect(porUuid(resultado.matches)).toEqual(porUuid(pedidos));
    expect(porUuid(resultado.misses)).toEqual([outro.uuid]);

    // SUPOSIÇÃO: "da mais nova para a mais antiga" é a ordem de `rendered` (a de `matches` segue fora do contrato).
    expect(resultado.rendered.map((r) => r.uuid)).toEqual([pedidos[3].uuid, pedidos[2].uuid]);
    for (const [i, id] of [[0, 4], [1, 3]]) {
      const r = resposta(resultado.rendered[i]);
      expect(r.status).toBe(201);
      expect(r.headers['content-type']).toBe('application/json');
      expect(r.headers['x-pedido']).toBe(String(id));
      expect(JSON.parse(r.body)).toEqual({ eco: id, metodo: 'POST' });
    }
  });

  test('render=1 e render=3; com menos matches que N vêm só as que há; sem matches, rendered []', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { pedidos } = await montar(request, t);
    expect((await renderizar(request, t, ECO, 1)).rendered.map((r) => r.uuid)).toEqual([pedidos[3].uuid]);
    expect((await renderizar(request, t, ECO, 3)).rendered.map((r) => r.uuid)).toEqual([pedidos[3].uuid, pedidos[2].uuid, pedidos[1].uuid]);

    const soUm: Regra = { ...ECO, match: { method: ['POST'], body: [{ jsonPath: { path: '$.id', equals: '2' } }] } };
    const um = await renderizar(request, t, soUm, 3);
    expect(um.rendered.map((r) => r.uuid)).toEqual([pedidos[1].uuid]);
    expect(JSON.parse(resposta(um.rendered[0]).body)).toEqual({ eco: 2, metodo: 'POST' });

    // SUPOSIÇÃO: com `render` e nenhuma mensagem casando, `rendered` vem vazio (não ausente).
    const nenhum = await renderizar(request, t, { ...ECO, match: { path: { equals: '/nada' } } }, 3);
    expect(nenhum.matches).toEqual([]);
    expect(nenhum.rendered).toEqual([]);
  });

  test('template false: corpo e cabeçalhos saem literais', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { pedidos } = await montar(request, t);
    const literal = { ...ECO, response: { ...ECO.response, template: false } };
    const r = resposta((await renderizar(request, t, literal, 1)).rendered[0]);
    expect(r.uuid).toBe(pedidos[3].uuid);
    expect(r.body).toBe(ECO.response!.body);
    expect(r.headers['x-pedido']).toBe("{{jsonPath request.body '$.id'}}");
  });

  test('regra sem response: status 200 e corpo vazio', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await montar(request, t);
    const r = resposta((await renderizar(request, t, { name: 'mínima', match: { method: ['POST'] } }, 1)).rendered[0]);
    expect(r.status).toBe(200);
    expect(r.body).toBe('');
  });

  test('helper que falha deixa o trecho vazio, como na execução', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { msg } = await enviarEGuardar(request, t, '/texto', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: Buffer.from('não é JSON') });
    const regra: Regra = { name: 'jsonPath em texto', response: { body: "a[{{jsonPath request.body '$.id'}}]b|{{request.body}}", template: true } };
    const r = resposta((await renderizar(request, t, regra, 1)).rendered[0]);
    expect(r.uuid).toBe(msg.uuid);
    expect(r.body).toBe('a[]b|não é JSON');
  });

  test('now e seq são de agora', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { pedidos } = await montar(request, t);
    const antes = Date.now();
    const r = resposta((await renderizar(request, t, { name: 'relógio', match: { method: ['POST'] }, response: { body: '{{now}}|{{seq}}', template: true } }, 1)).rendered[0]);
    const [agora, seq] = r.body.split('|');
    expect(agora).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/);
    expect(Math.abs(Date.parse(agora) - antes)).toBeLessThanOrEqual(15_000);
    // SUPOSIÇÃO: "seq de agora" não diz qual número (o `seq` atual da URL ou o próximo); o contrato só exige um
    // inteiro que não seja anterior ao da mensagem renderizada.
    expect(seq).toMatch(/^\d+$/);
    expect(Number(seq)).toBeGreaterThanOrEqual(pedidos[3].seq);
  });

  test('regra com fault: {uuid, fault}', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { pedidos } = await montar(request, t);
    const falha: Regra = { name: 'falha', match: { method: ['POST'] }, response: { status: 201, body: 'nunca', fault: 'connection_reset' } };
    const { rendered } = await renderizar(request, t, falha, 2);
    expect(rendered).toEqual([
      { uuid: pedidos[3].uuid, fault: 'connection_reset' },
      { uuid: pedidos[2].uuid, fault: 'connection_reset' },
    ]);
  });

  test('não aplica atraso nem dribble', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await montar(request, t);
    const lenta: Regra = {
      name: 'lenta', match: { method: ['POST'] },
      response: { status: 202, body: 'corpo inteiro', delay: { fixed: 5000 }, dribble: { chunks: 5, durationMs: 5000 } },
    };
    const inicio = performance.now();
    const { rendered } = await renderizar(request, t, lenta, 3);
    expect(performance.now() - inicio, 'três respostas de 5 s de atraso e 5 s de dribble').toBeLessThan(3000);
    expect(rendered).toHaveLength(3);
    for (const entrada of rendered) expect(resposta(entrada)).toMatchObject({ status: 202, body: 'corpo inteiro' });
  });

  test('não grava mensagem, não salva a regra e não muda o cenário', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await montar(request, t);
    const comCenario: Regra = { ...ECO, name: 'com cenário', scenario: { name: 'fluxo', newState: 'depois' } };
    const salvas = await salvarRegras(request, t, [comCenario]);
    expect(await estadoDoCenario(request, t, 'fluxo')).toBe('Started');

    const { rendered } = await renderizar(request, t, { ...comCenario, name: 'outra versão' }, 3);
    expect(rendered).toHaveLength(3);
    expect(await estadoDoCenario(request, t, 'fluxo')).toBe('Started');
    expect(await lerRegras(request, t)).toEqual(salvas);
    expect((await listar(request, t)).total).toBe(5);
  });
});

test.describe('C4: tetos do template', () => {
  test('resposta renderizada acima dos tetos: {uuid, error: "too_large"}, como o 500 da execução', async ({ request, tokens }) => {
    // Resolução 8 do api-contrato. Tetos de hoje (`TemplateLimits`): corpo de 1 MiB e valor de cabeçalho de 8 KiB.
    const t = (await tokens.criar()).uuid;
    const { msg: pequena } = await enviarEGuardar(request, t, '/p', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: Buffer.from('curto') });
    const { msg: grande } = await enviarEGuardar(request, t, '/g', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: Buffer.from('a'.repeat(600 * 1024)) });

    const noCorpo: Regra = { name: 'corpo dobrado', match: { method: ['POST'] }, response: { status: 201, body: '{{request.body}}{{request.body}}', template: true } };
    const { rendered } = await renderizar(request, t, noCorpo, 2);
    expect(rendered.map((r) => r.uuid)).toEqual([grande.uuid, pequena.uuid]);
    expect(rendered[0]).toEqual({ uuid: grande.uuid, error: 'too_large' });
    expect(resposta(rendered[1])).toMatchObject({ status: 201, body: 'curtocurto' });

    const noCabecalho: Regra = { name: 'cabeçalho', match: { path: { equals: '/g' } }, response: { headers: { 'X-Eco': '{{request.body}}' }, body: 'ok', template: true } };
    expect((await renderizar(request, t, noCabecalho, 1)).rendered).toEqual([{ uuid: grande.uuid, error: 'too_large' }]);
  });
});

test.describe('C4: validação do render', () => {
  for (const valor of ['0', '4', '-1', '1.5', 'abc', 'true', '99999999999999999999']) {
    test(`render=${valor} → 422 com a chave render`, async ({ request, tokens }) => {
      const t = (await tokens.criar()).uuid;
      const erros = await erros422(await testarRegraComRender(request, t, ECO, valor));
      expect(erros, JSON.stringify(erros)).toHaveProperty('render');
      expect(erros.render[0]).toMatch(/^[A-Z].*\.$/s);
    });
  }

  test('render válido não esconde o 422 da regra', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const erros = await erros422(await testarRegraComRender(request, t, { name: 'ruim', match: { path: { regex: '([a-z' } } }, 1));
    const chave = Object.keys(erros).find((k) => /(^|\.)match\.path\.regex$/.test(k));
    expect(chave, JSON.stringify(erros)).toBeDefined();
  });
});
