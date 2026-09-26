import { randomUUID } from 'node:crypto';
import { JSON_ACCEPT, enviarEGuardar, espera, expect, expectErroJson, test } from '../../support/contrato.js';
import {
  MODELO_JSON, chamarSuggest, exigirIaDesligada, exigirLlmFalso, expect502, expect503, expectContem, mensagensDo422,
  pedidosCom, sugestaoOk,
} from '../../support/ia.js';
import { novoMarcador, pedidosAoLlm, programarLlm, textoDoPedido } from '../../support/llm-falso.js';
import { expect422 } from '../../support/reenvio.js';
import { lerRegras, salvarRegras, testarRegra, type Regra } from '../../support/regras.js';

// `POST /token/{id}/rules/suggest` (§1 do plano "ia-local", CA-2): o dono descreve a regra em linguagem
// natural e recebe `{rule, explanation, attempts}`. O app pede ao LLM saída estruturada (`json_schema`
// estrito), valida com o parser de regras e, se der erro, devolve os erros ao modelo (até 3 tentativas);
// sem regra válida → 422 com os últimos erros. Nunca grava: a tela mostra e o dono salva.
//
// O LLM é o falso de `support/llm-falso.ts`. Cada teste põe um marcador no prompt, programa as respostas
// do falso para ele e confere depois os pedidos que o falso recebeu.

const REGRA_SUGERIDA: Regra = {
  name: 'pagamentos 429',
  match: { method: ['POST'], path: { equals: '/pagamentos' } },
  response: { status: 429, headers: { 'Retry-After': '5' }, body: '' },
};

/** Três regras que o parser recusa, cada uma por um motivo diferente. */
const INVALIDAS: Regra[] = [
  { name: 'regex ruim', match: { path: { regex: '([a-z' } } },
  { name: 'status ruim', match: { method: ['POST'] }, response: { status: 99 } },
  { name: 'jsonpath ruim', match: { body: [{ jsonPath: { path: "$['status'" } }] } },
];

/** As mensagens com que a API recusa cada regra de `INVALIDAS` (pelo `rules/test`, que não grava). */
async function errosDoParser(request: Parameters<typeof testarRegra>[0], tokenId: string): Promise<string[][]> {
  const erros: string[][] = [];
  for (const regra of INVALIDAS) erros.push(await mensagensDo422(await testarRegra(request, tokenId, regra)));
  // Pré-condição: os motivos não se repetem, para saber de qual tentativa vêm os erros de cada prompt.
  for (let i = 0; i < erros.length; i++) {
    for (let j = i + 1; j < erros.length; j++) for (const m of erros[i]) expect(erros[j]).not.toContain(m);
  }
  return erros;
}

function prompt(marcador: string, texto = 'responda 429 com Retry-After 5 para POST em /pagamentos'): string {
  return `${texto} (${marcador})`;
}

test.describe('rules/suggest com o LLM falso (CA-2)', () => {
  test.beforeEach(() => exigirLlmFalso());

  test('resposta válida vira regra na 1ª tentativa, sem gravar; o pedido ao LLM é estruturado', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const existentes = await salvarRegras(request, token.uuid, [{ name: 'existente', match: { path: { equals: '/x' } } }]);
    const m = novoMarcador();
    await programarLlm(m, [{ regra: REGRA_SUGERIDA, explicacao: 'Responde 429 aos POST em /pagamentos.' }]);

    const s = await sugestaoOk(await chamarSuggest(request, token.uuid, { prompt: prompt(m) }));

    expect(s.attempts).toBe(1);
    expect(s.rule).toMatchObject(REGRA_SUGERIDA as Record<string, unknown>);
    // Nada gravado: as regras da URL continuam as de antes.
    expect(await lerRegras(request, token.uuid)).toEqual(existentes);

    const [pedido] = await pedidosCom(m, 1);
    expect(pedido.corpo.model).toBe(MODELO_JSON);
    expect(pedido.corpo.temperature).toBe(0);
    expect(pedido.corpo.response_format?.type).toBe('json_schema');
    expect(pedido.corpo.response_format?.json_schema?.strict).toBe(true);
    // O schema é o da regra: fala de `match` e de `response`.
    expectContem(JSON.stringify(pedido.corpo.response_format?.json_schema?.schema ?? null), ['"match"', '"response"'], 'schema do response_format');
    // O prompt leva o pedido do dono e o resumo da linguagem de regras.
    expectContem(textoDoPedido(pedido), [prompt(m), 'match', 'response'], 'prompt');

    // A sugestão é uma regra que a API aceita e que funciona quando o dono a salva.
    await salvarRegras(request, token.uuid, [s.rule as Regra]);
    const res = await request.post(`/${token.uuid}/pagamentos`, { data: Buffer.from('{}') });
    expect(res.status()).toBe(429);
    expect(res.headers()['retry-after']).toBe('5');
  });

  test('resposta inválida gera nova tentativa com os erros do parser no prompt', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [errosDa1] = await errosDoParser(request, token.uuid);
    const m = novoMarcador();
    await programarLlm(m, [{ regra: INVALIDAS[0] }, { regra: REGRA_SUGERIDA }]);

    const s = await sugestaoOk(await chamarSuggest(request, token.uuid, { prompt: prompt(m) }));

    expect(s.attempts).toBe(2);
    expect(s.rule).toMatchObject(REGRA_SUGERIDA as Record<string, unknown>);
    const [, segundo] = await pedidosCom(m, 2);
    expectContem(textoDoPedido(segundo), errosDa1, '2º pedido ao LLM');
    expect(await lerRegras(request, token.uuid)).toEqual([]);
  });

  test('conteúdo que não é JSON conta como tentativa inválida', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const m = novoMarcador();
    await programarLlm(m, [{ conteudo: 'Claro! Aqui está a sua regra: responda 429.' }, { regra: REGRA_SUGERIDA }]);

    const s = await sugestaoOk(await chamarSuggest(request, token.uuid, { prompt: prompt(m) }));

    expect(s.attempts).toBe(2);
    expect(s.rule).toMatchObject(REGRA_SUGERIDA as Record<string, unknown>);
    await pedidosCom(m, 2);
  });

  test('3 respostas inválidas → 422 com os erros da última; cada tentativa leva os erros da anterior; nada gravado', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const existentes = await salvarRegras(request, token.uuid, [{ name: 'existente', match: { path: { equals: '/x' } } }]);
    const erros = await errosDoParser(request, token.uuid);
    const m = novoMarcador();
    // Se o app tentasse uma 4ª vez, o falso repetiria a última inválida (e o teste veria 4 pedidos).
    await programarLlm(m, INVALIDAS.map((regra) => ({ regra })));

    const res = await chamarSuggest(request, token.uuid, { prompt: prompt(m) });

    const texto = await res.text();
    expect(res.status(), texto.slice(0, 500)).toBe(422);
    expect(res.headers()['content-type'] ?? '').toContain('application/json');
    expectContem(texto, erros[2], 'corpo do 422');
    const pedidos = await pedidosCom(m, 3);
    expectContem(textoDoPedido(pedidos[1]), erros[0], '2º pedido ao LLM');
    expectContem(textoDoPedido(pedidos[2]), erros[1], '3º pedido ao LLM');
    expect(await lerRegras(request, token.uuid)).toEqual(existentes);
  });

  test('request_id: a mensagem de exemplo vai no contexto do modelo', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const exemplo = novoMarcador();
    const { msg } = await enviarEGuardar(request, token.uuid, '/pagamentos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, data: Buffer.from(`{"status":"pago","ref":"${exemplo}"}`),
    });
    const m = novoMarcador();
    await programarLlm(m, [{ regra: REGRA_SUGERIDA }]);

    await sugestaoOk(await chamarSuggest(request, token.uuid, { prompt: prompt(m), request_id: msg.uuid }));

    const [pedido] = await pedidosCom(m, 1);
    expectContem(textoDoPedido(pedido), [exemplo], 'prompt com request_id');
  });

  test('prompt de 1 a 2000 caracteres; fora disso → 422 em prompt, sem chamar o LLM', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const m = novoMarcador();
    await programarLlm(m, [{ regra: REGRA_SUGERIDA }]);

    await expect422(await chamarSuggest(request, token.uuid, {}), /^prompt$/, 'sem prompt');
    await expect422(await chamarSuggest(request, token.uuid, { prompt: '' }), /^prompt$/, 'prompt vazio');
    await expect422(await chamarSuggest(request, token.uuid, { prompt: 123 }), /^prompt$/, 'prompt número');
    await expect422(await chamarSuggest(request, token.uuid, { prompt: m + 'x'.repeat(2001 - m.length) }), /^prompt$/, 'prompt com 2001');
    expect(await pedidosAoLlm(m)).toEqual([]);

    const s = await sugestaoOk(await chamarSuggest(request, token.uuid, { prompt: m + 'x'.repeat(2000 - m.length) }));
    expect(s.attempts).toBe(1);
    await pedidosCom(m, 1);
  });

  test('URL que não existe → 410 Token not found', async ({ request }) => {
    await expectErroJson(await chamarSuggest(request, randomUUID(), { prompt: 'qualquer' }), 410, 'Token not found');
  });

  test('LLM com erro (500) ou fora (conexão fechada) → 502 com mensagem; nada gravado', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const comErro = novoMarcador();
    await programarLlm(comErro, [{ status: 500 }]);
    await expect502(await chamarSuggest(request, token.uuid, { prompt: prompt(comErro) }));

    const fora = novoMarcador();
    await programarLlm(fora, [{ derrubar: true }]);
    await expect502(await chamarSuggest(request, token.uuid, { prompt: prompt(fora) }));
    expect(await lerRegras(request, token.uuid)).toEqual([]);
  });

  test('uma chamada de IA por vez por URL: duas simultâneas nunca chegam juntas ao LLM', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [a, b] = [novoMarcador(), novoMarcador()];
    await programarLlm(a, [{ regra: REGRA_SUGERIDA, atraso: 1500 }]);
    await programarLlm(b, [{ regra: REGRA_SUGERIDA, atraso: 1500 }]);

    const respostas = await Promise.all([a, b].map((m) => chamarSuggest(request, token.uuid, { prompt: prompt(m) })));

    const status = respostas.map((r) => r.status());
    // A segunda espera a vez (200) ou é recusada (409/429): a §1 não fixa qual.
    for (const s of status) expect([200, 409, 429]).toContain(s);
    expect(status).toContain(200);
    const pedidos = [...(await pedidosAoLlm(a)), ...(await pedidosAoLlm(b))].sort((x, y) => x.inicio - y.inicio);
    for (let i = 1; i < pedidos.length; i++) {
      expect(pedidos[i].inicio, 'um pedido ao LLM começou antes de o anterior acabar').toBeGreaterThanOrEqual(pedidos[i - 1].fim!);
    }
  });

  test('11ª chamada de IA no mesmo minuto na mesma URL → 429 com Retry-After; outra URL segue', async ({ request, tokens }) => {
    test.setTimeout(120_000);
    const [token, outro] = [await tokens.criar(), await tokens.criar()];
    const m = novoMarcador();
    await programarLlm(m, [{ regra: REGRA_SUGERIDA }]);
    // Janela de minuto de relógio ou deslizante: começar no início de um minuto serve às duas.
    const segundo = new Date().getSeconds();
    if (segundo > 40) await espera((61 - segundo) * 1000);

    for (let i = 1; i <= 10; i++) await sugestaoOk(await chamarSuggest(request, token.uuid, { prompt: prompt(m) }));
    const res = await chamarSuggest(request, token.uuid, { prompt: prompt(m) });

    expect(res.status(), (await res.text()).slice(0, 300)).toBe(429);
    const retryAfter = Number(res.headers()['retry-after']);
    expect(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After: ${res.headers()['retry-after']}`).toBe(true);
    await pedidosCom(m, 10);
    await sugestaoOk(await chamarSuggest(request, outro.uuid, { prompt: prompt(m) }));
  });
});

test.describe('rules/suggest com a IA desligada (CA-2)', () => {
  test.beforeEach(() => exigirIaDesligada());

  test('→ 503 {"error": "AI is not configured"}; captura e API seguem normais', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await expect503(await chamarSuggest(request, token.uuid, { prompt: 'responda 429' }));
    const webhook = await request.post(`/${token.uuid}/qualquer`, { data: Buffer.from('x') });
    expect(webhook.status()).toBe(200);
    expect((await request.get(`/token/${token.uuid}/requests`, { headers: JSON_ACCEPT })).status()).toBe(200);
  });
});
