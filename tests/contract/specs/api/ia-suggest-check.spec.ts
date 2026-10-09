import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { BASE_URL, JSON_ACCEPT, enviarEGuardar, expect, listar, test } from '../../support/contrato.js';
import { envelope, parEc, politica } from '../../support/e2ee.js';
import { HEADER_SEGREDO } from '../../support/privacidade.js';
import { chamarSuggest, exigirLlmFalso, pedidosCom, sugestaoOk, type Conferencia, type Sugestao } from '../../support/ia.js';
import { novoMarcador, programarLlm } from '../../support/llm-falso.js';
import { estadoDoCenario, lerRegras, salvarRegras, testarRegra, type Regra, type ResultadoTesteDeRegra } from '../../support/regras.js';

// Patamar, fatia D1, DX-29 e UX-41 (`.docs-arquivo/patamar/api-defeitos.md`, item 5): o `rules/suggest` devolve, além
// de `rule`, `explanation` e `attempts`, o bloco `check`: a regra devolvida conferida pelo servidor, sem o modelo.
// `example` é a regra contra a mensagem do `request_id` (`null` sem ele), com as frases e chaves do `rules/test`;
// `recent` é `{evaluated, matched}` sobre a janela do `rules/test`; `warnings` é a lista de `{code, message}` com o
// conjunto fechado `example_not_matched`, `template_disabled`, `path_never_seen`, `sequence_as_single_rule` e
// `decryption_matches_other_reasons` (v0.5.0: `match.decryption: invalid` casa toda recusa da decifra, e a conferência
// diz isso quando as recentes que a regra casa têm motivo diferente do exemplo, ou mais de um sem exemplo).
// A conferência não gera nova tentativa, não grava e não muda cenário; `explanation` é o texto do modelo, como antes.
//
// O LLM é o falso: cada teste programa a regra que "o modelo" devolve, inclusive as erradas do estudo (caminho
// inventado, corpo `equals`, `{{…}}` sem template, sequência numa regra só).

const JSON_CT = { 'Content-Type': 'application/json' };
const EXPLICACAO = 'Texto do modelo, que o servidor não altera.';

/** Chama o suggest com o LLM falso devolvendo `regra` e confere a forma da resposta e do `check`. */
async function sugerir(
  request: APIRequestContext,
  tokenId: string,
  regra: Regra,
  pedido: { prompt?: string; request_id?: string } = {},
): Promise<{ sugestao: Sugestao; check: Conferencia; marcador: string }> {
  const marcador = novoMarcador();
  await programarLlm(marcador, [{ regra, explicacao: EXPLICACAO }]);
  const { prompt = 'responda 201 para POST em /pagamentos', ...resto } = pedido;
  const sugestao = await sugestaoOk(await chamarSuggest(request, tokenId, { prompt: `${prompt} (${marcador})`, ...resto }));
  expect(Object.keys(sugestao).sort(), 'chaves da resposta do suggest').toEqual(['attempts', 'check', 'explanation', 'rule']);
  const check = sugestao.check!;
  expect(Object.keys(check).sort(), JSON.stringify(check)).toEqual(['example', 'recent', 'warnings']);
  expect(Object.keys(check.recent).sort()).toEqual(['evaluated', 'matched']);
  expect(Array.isArray(check.warnings), JSON.stringify(check.warnings)).toBe(true);
  for (const aviso of check.warnings) {
    expect(Object.keys(aviso).sort(), JSON.stringify(aviso)).toEqual(['code', 'message']);
    expect(aviso.message.trim().length, JSON.stringify(aviso)).toBeGreaterThan(0);
  }
  if (check.example !== null) expect(Object.keys(check.example).sort()).toEqual(['conditions', 'failed', 'matches']);
  // O que já existia não muda.
  expect(sugestao.explanation).toBe(EXPLICACAO);
  expect(sugestao.attempts).toBe(1);
  expect(sugestao.rule).toMatchObject(regra as Record<string, unknown>);
  return { sugestao, check, marcador };
}

const codigos = (check: Conferencia): string[] => check.warnings.map((a) => a.code).sort();

/** Duas mensagens em `/pagamentos` (a segunda é o exemplo) e uma em `/outro`. */
async function montar(request: APIRequestContext, t: string) {
  const { msg: antiga } = await enviarEGuardar(request, t, '/pagamentos', { method: 'POST', headers: JSON_CT, data: Buffer.from('{"id":7,"status":"pago"}') });
  const { msg: exemplo } = await enviarEGuardar(request, t, '/pagamentos', { method: 'POST', headers: JSON_CT, data: Buffer.from('{"id":42,"status":"estornado"}') });
  const { msg: outra } = await enviarEGuardar(request, t, '/outro', { method: 'GET' });
  return { antiga, exemplo, outra };
}

test.describe('suggest com check (DX-29)', () => {
  test.beforeEach(() => exigirLlmFalso());

  test('regra certa, com exemplo: example casa, recent conta as que casariam, sem avisos', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { exemplo } = await montar(request, t);
    const regra: Regra = { name: 'pagamentos', match: { method: ['POST'], path: { equals: '/pagamentos' } }, response: { status: 201 } };
    const { check } = await sugerir(request, t, regra, { request_id: exemplo.uuid });
    expect(check).toEqual({ example: { matches: true, failed: [], conditions: [] }, recent: { evaluated: 3, matched: 2 }, warnings: [] });
  });

  test('sem request_id: example null; URL sem mensagens: recent 0 de 0 e nenhum aviso de caminho', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const regra: Regra = { name: 'pagamentos', match: { path: { equals: '/pagamentos' } }, response: { status: 201 } };
    expect((await sugerir(request, t, regra)).check).toEqual({ example: null, recent: { evaluated: 0, matched: 0 }, warnings: [] });

    await montar(request, t);
    expect((await sugerir(request, t, regra)).check).toEqual({ example: null, recent: { evaluated: 3, matched: 2 }, warnings: [] });
  });

  test('caminho inventado: o exemplo não casa, com as frases do rules/test, e nenhuma mensagem recente tem o caminho', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { exemplo } = await montar(request, t);
    // O erro do estudo: o pedido não citava caminho e o modelo pôs `path equals "/"`.
    const regra: Regra = { name: 'estorno', match: { method: ['POST'], path: { equals: '/' }, body: [{ jsonPath: { path: '$.status', equals: 'estornado' } }] }, response: { status: 409 } };
    const { check } = await sugerir(request, t, regra, { prompt: 'quando o status do corpo for estornado, responda 409', request_id: exemplo.uuid });

    const teste = (await (await testarRegra(request, t, regra)).json()) as ResultadoTesteDeRegra;
    const miss = teste.misses.find((m) => m.uuid === exemplo.uuid)!;
    expect(check.example).toEqual({ matches: false, failed: miss.failed, conditions: miss.conditions });
    expect(check.example!.conditions).toEqual(['match.path']);
    expect(check.recent).toEqual({ evaluated: 3, matched: 0 });
    expect(codigos(check)).toEqual(['example_not_matched', 'path_never_seen']);
  });

  test('corpo equals no lugar de jsonPath: o exemplo não casa, e o caminho que existe não gera aviso', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { exemplo } = await montar(request, t);
    const regra: Regra = { name: 'eco', match: { path: { equals: '/pagamentos' }, body: [{ equals: '42' }] }, response: { status: 202 } };
    const { check } = await sugerir(request, t, regra, { prompt: 'case exatamente esta mensagem e responda 202', request_id: exemplo.uuid });
    expect(check.example).toMatchObject({ matches: false, conditions: ['match.body.0'] });
    expect(check.recent).toEqual({ evaluated: 3, matched: 0 });
    expect(codigos(check)).toEqual(['example_not_matched']);
  });

  test('path_never_seen vale para prefix e regex, e some quando alguma mensagem recente tem o caminho', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await montar(request, t);
    for (const path of [{ prefix: '/pedidos' }, { regex: '^/v[0-9]+/.*$' }, { equals: '/PAGAMENTOS' }]) {
      const { check } = await sugerir(request, t, { name: 'nunca visto', match: { path }, response: { status: 201 } });
      expect(codigos(check), JSON.stringify(path)).toEqual(['path_never_seen']);
      expect(check.recent, JSON.stringify(path)).toEqual({ evaluated: 3, matched: 0 });
    }
    // O caminho existe, mas o método não casa nenhuma: 0 casariam, e o caminho não é o problema.
    const { check } = await sugerir(request, t, { name: 'visto', match: { method: ['DELETE'], path: { prefix: '/pagamentos' } }, response: { status: 201 } });
    expect(check.recent).toEqual({ evaluated: 3, matched: 0 });
    expect(codigos(check)).toEqual([]);
  });

  test('{{…}} com template falso, no corpo ou num cabeçalho: template_disabled; com template true, não', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const eco = "{{jsonPath request.body '$.id'}}";
    const semTemplate: Array<[string, Regra['response']]> = [
      ['corpo, template false', { status: 202, body: eco, template: false }],
      ['corpo, template ausente', { status: 202, body: eco }],
      ['cabeçalho', { status: 202, headers: { 'X-Id': eco }, body: 'ok' }],
    ];
    for (const [caso, response] of semTemplate) {
      const { check } = await sugerir(request, t, { name: 'eco', response }, { prompt: 'responda 202 ecoando o id do corpo' });
      expect(codigos(check), caso).toEqual(['template_disabled']);
    }
    const comTemplate = await sugerir(request, t, { name: 'eco', response: { status: 202, body: eco, template: true } }, { prompt: 'responda 202 ecoando o id do corpo' });
    expect(codigos(comTemplate.check)).toEqual([]);
    // Chave sozinha não é template.
    const json = await sugerir(request, t, { name: 'json', response: { status: 200, body: '{"ok":{"a":1}}' } });
    expect(codigos(json.check)).toEqual([]);
  });

  for (const pedido of ['falhe 3 vezes com 503 e depois responda 200', 'fail 3 times with 503 then respond 200']) {
    test(`pedido com forma de sequência que virou regra única ("${pedido}"): sequence_as_single_rule`, async ({ request, tokens }) => {
      const t = (await tokens.criar()).uuid;
      const unica: Regra = { name: 'falha', response: { status: 503 } };
      expect(codigos((await sugerir(request, t, unica, { prompt: pedido })).check)).toEqual(['sequence_as_single_rule']);

      // A regra com cenário é um passo da sequência: sem o aviso.
      const passo: Regra = { name: 'falha 1', scenario: { name: 'retentativa', requiredState: 'Started', newState: 'falhou-1' }, response: { status: 503 } };
      expect(codigos((await sugerir(request, t, passo, { prompt: pedido })).check)).toEqual([]);
    });
  }

  test('pedido sem forma de sequência não ganha o aviso, mesmo com número no texto', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const regra: Regra = { name: '429', match: { method: ['POST'] }, response: { status: 429, headers: { 'Retry-After': '5' } } };
    for (const pedido of ['responda 429 com Retry-After 5 para POST em /pagamentos', 'respond 503 to every request']) {
      expect(codigos((await sugerir(request, t, { ...regra, match: { method: ['POST'] } }, { prompt: pedido })).check), pedido).toEqual([]);
    }
  });

  test('os avisos se somam', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { exemplo } = await montar(request, t);
    const regra: Regra = { name: 'tudo errado', match: { path: { equals: '/' } }, response: { status: 503, body: '{{seq}}' } };
    const { check } = await sugerir(request, t, regra, { prompt: 'falhe 3 vezes com 503 e depois responda 200', request_id: exemplo.uuid });
    expect(codigos(check)).toEqual(['example_not_matched', 'path_never_seen', 'sequence_as_single_rule', 'template_disabled']);
  });

  test('a conferência não gera nova tentativa, não grava e não muda cenário nem mensagens', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const existentes = await salvarRegras(request, t, [
      { name: 'existente', match: { path: { equals: '/x' } }, scenario: { name: 'fluxo', requiredState: 'Started', newState: 'feito' } },
    ]);
    const { exemplo } = await montar(request, t);
    // Casaria o exemplo e transicionaria o cenário se fosse executada de verdade.
    const regra: Regra = { name: 'com cenário', match: { path: { equals: '/pagamentos' } }, scenario: { name: 'fluxo', requiredState: 'Started', newState: 'feito' }, response: { status: 201 } };
    const certa = await sugerir(request, t, regra, { request_id: exemplo.uuid });
    expect(certa.check.example?.matches).toBe(true);
    await pedidosCom(certa.marcador, 1);

    // Com avisos também: uma chamada ao modelo, `attempts` 1.
    const errada = await sugerir(request, t, { name: 'errada', match: { path: { equals: '/' } } }, { request_id: exemplo.uuid });
    expect(codigos(errada.check)).toContain('example_not_matched');
    await pedidosCom(errada.marcador, 1);

    expect(await lerRegras(request, t)).toEqual(existentes);
    expect(await estadoDoCenario(request, t, 'fluxo')).toBe('Started');
    expect((await listar(request, t)).total).toBe(3);
  });

  test('decryption: invalid que casa recusas de outros motivos: decryption_matches_other_reasons, com os motivos contados', async ({ request }) => {
    const segredo = `seg-${randomUUID()}`;
    const comSegredo = { ...JSON_ACCEPT, [HEADER_SEGREDO]: segredo };
    const criada = await request.post('/token', { data: { read_secret: segredo, e2ee: politica([(await parEc('remetente-sig-1')).publica]) }, headers: JSON_ACCEPT });
    expect(criada.status(), (await criada.text()).slice(0, 300)).toBe(201);
    const t = ((await criada.json()) as { uuid: string }).uuid;
    try {
      const entregar = async (corpo: string) =>
        (await fetch(new URL(`/${t}`, BASE_URL), { method: 'POST', headers: JSON_CT, body: corpo })).headers.get('x-request-id')!;
      await entregar('{}');
      await entregar('não é JSON');
      await entregar(JSON.stringify(envelope(randomUUID(), { ok: true })));
      const exemplo = await entregar(JSON.stringify(envelope(randomUUID(), { ok: false })));
      const sugerirComSegredo = async (regra: Regra, extra: Record<string, unknown> = {}) => {
        const marcador = novoMarcador();
        await programarLlm(marcador, [{ regra, explicacao: EXPLICACAO }]);
        const res = await request.post(`/token/${t}/rules/suggest`, {
          data: { prompt: `responda 400 quando o atributo vier em claro (${marcador})`, ...extra }, headers: comSegredo, timeout: 120_000,
        });
        const sugestao = await sugestaoOk(res);
        for (const aviso of sugestao.check!.warnings) expect(Object.keys(aviso).sort()).toEqual(['code', 'message']);
        return sugestao.check!;
      };
      const larga: Regra = { name: 'recusa', match: { decryption: 'invalid' }, response: { status: 400 } };

      const comExemplo = await sugerirComSegredo(larga, { request_id: exemplo });
      expect(codigos(comExemplo)).toEqual(['decryption_matches_other_reasons']);
      expect(comExemplo.warnings[0].message).toBe(
        'match.decryption invalid answers every refused decryption, not only downgrade: 4 of the last 4 requests match, ' +
          'with reasons downgrade (2), attribute_missing (1), body_not_json (1).',
      );
      const semExemplo = await sugerirComSegredo(larga);
      expect(semExemplo.warnings[0].message).toBe(
        'match.decryption invalid answers every refused decryption: 4 of the last 4 requests match, ' +
          'with reasons downgrade (2), attribute_missing (1), body_not_json (1).',
      );

      // Só as do motivo do exemplo casam: sem o aviso; a regra de decifra válida também não o ganha.
      const estreita: Regra = { name: 'em claro', match: { decryption: 'invalid', body: [{ jsonPath: { path: '$.payload.ok' } }] } };
      expect(codigos(await sugerirComSegredo(estreita, { request_id: exemplo }))).toEqual([]);
      expect(codigos(await sugerirComSegredo({ name: 'ok', match: { decryption: 'valid' } }, { request_id: exemplo }))).not.toContain(
        'decryption_matches_other_reasons',
      );
    } finally {
      await request.delete(`/token/${t}`, { headers: comSegredo });
    }
  });

  test('sem regra válida: o 422 de sempre, sem check', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const m = novoMarcador();
    await programarLlm(m, [{ regra: { name: 'regex ruim', match: { path: { regex: '([a-z' } } } }]);
    const res = await chamarSuggest(request, t, { prompt: `qualquer (${m})` });
    expect(res.status(), (await res.text()).slice(0, 300)).toBe(422);
    const corpo = (await res.json()) as Record<string, unknown>;
    expect(corpo).not.toHaveProperty('check');
    expect(corpo).not.toHaveProperty('rule');
  });
});
