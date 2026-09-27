import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { JSON_ACCEPT, buscarMensagem, enviarEGuardar, expect, expectErroJson, listar, test } from '../../support/contrato.js';
import { assinaturaGithub } from '../../support/assinatura.js';
import { ERRO_PROTEGIDA, capturar, comSegredo, http, test as testPrivado } from '../../support/privacidade.js';
import {
  chamarTrace, estadoDoCenario, expectFalhas, lerTrace, salvarRegras, testarRegra,
  type Regra, type RegraNoTrace, type RegraSalva, type ResultadoTesteDeRegra,
} from '../../support/regras.js';

// UX de Regras, C1 (WM-23, `.docs-arquivo/regras-ux/api-contrato.md`): `GET /token/{id}/request/{rid}/rules/trace`
// avalia as regras ATUAIS da URL contra a mensagem gravada, sem gravar nada e sem mudar cenário, e responde
// `{request, responded_by, rules}`. `responded_by` é o `rule` gravado; `rules` traz todas as regras na ordem de
// avaliação (`position` 1..N entre as ligadas, desligadas no fim com `position: null`), cada uma com `matches` e
// `failed`/`conditions` iguais aos do near miss, ignorando `enabled`. Cenário: contra o estado atual. Assinatura e
// schema: o resultado gravado na mensagem. 410 token inexistente; 404 mensagem inexistente, como o `GET`.
//
// "Exatamente as frases e chaves do near miss" é conferido contra a própria API: o `near_miss` gravado e os
// `misses` do `rules/test` com a mesma regra. Assim o contrato não fixa um texto que o api-contrato não fixa (o
// exemplo de lá traz `"conditions": ["headers.x-tenant"]`, e o near miss usa `match.headers.<nome como na regra>`,
// fixado em regras-condicoes.spec.ts).

const JSON_CT = { 'Content-Type': 'application/json' };

/** O miss do `rules/test` para a mensagem `uuid`, testando a regra salva. */
async function missDoTeste(request: APIRequestContext, tokenId: string, regra: RegraSalva, uuid: string): Promise<{ failed: string[]; conditions: string[] }> {
  const res = await testarRegra(request, tokenId, regra);
  expect(res.status(), await res.text()).toBe(200);
  const resultado = (await res.json()) as ResultadoTesteDeRegra;
  const miss = resultado.misses.find((m) => m.uuid === uuid);
  expect(miss, `rules/test de ${regra.name} não traz ${uuid} em misses: ${JSON.stringify(resultado)}`).toBeDefined();
  return { failed: miss!.failed, conditions: miss!.conditions };
}

function porId(rules: RegraNoTrace[], id: string): RegraNoTrace {
  const regra = rules.find((r) => r.id === id);
  expect(regra, `regra ${id} ausente do trace: ${JSON.stringify(rules)}`).toBeDefined();
  return regra!;
}

const PIX: Regra = {
  name: 'Pix pago',
  priority: 1,
  match: { method: ['POST'], path: { equals: '/pagamentos' }, headers: { 'X-Tenant': { equals: 'acme' } } },
  response: { status: 201 },
};
const BOLETO: Regra = {
  name: 'Boleto',
  priority: 2,
  match: { method: ['POST'], body: [{ jsonPath: { path: '$.tipo', equals: 'boleto' } }] },
  response: { status: 202 },
};
const PEGA_TUDO: Regra = { name: 'Pega-tudo', priority: 5, response: { status: 200 } };

/** POST /pagamentos de outro tenant, tipo pix: Pix falha no cabeçalho, Boleto no corpo, a pega-tudo casa. */
const PEDIDO = { method: 'POST', headers: { ...JSON_CT, 'X-Tenant': 'outra' }, data: Buffer.from('{"tipo":"pix"}') };

test.describe('C1: trace de uma mensagem', () => {
  test('outra regra respondeu: o trace diz, condição por condição, por que as outras não casaram', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const [pix, boleto, pegaTudo] = await salvarRegras(request, t, [PIX, BOLETO, PEGA_TUDO]);
    const { res, msg } = await enviarEGuardar(request, t, '/pagamentos', PEDIDO);
    expect(res.status()).toBe(200);
    expect(msg.rule).toEqual({ id: pegaTudo.id, name: 'Pega-tudo' });

    const trace = await lerTrace(request, t, msg.uuid);
    expect(trace.request).toBe(msg.uuid);
    expect(trace.responded_by).toEqual(msg.rule);
    expect(trace.rules.map((r) => [r.id, r.name, r.enabled, r.position])).toEqual([
      [pix.id, 'Pix pago', true, 1],
      [boleto.id, 'Boleto', true, 2],
      [pegaTudo.id, 'Pega-tudo', true, 3],
    ]);

    const tracePix = porId(trace.rules, pix.id);
    expect(tracePix.matches).toBe(false);
    expect(tracePix.failed).toHaveLength(1);
    expectFalhas(tracePix.failed, [/^header x-tenant\b.*acme.*outra/i]);
    expect(tracePix).toMatchObject(await missDoTeste(request, t, pix, msg.uuid));

    const traceBoleto = porId(trace.rules, boleto.id);
    expect(traceBoleto.matches).toBe(false);
    expect(traceBoleto.failed).toHaveLength(1);
    expectFalhas(traceBoleto.failed, [/^body \$\.tipo\b.*boleto.*pix/]);
    expect(traceBoleto).toMatchObject(await missDoTeste(request, t, boleto, msg.uuid));

    // SUPOSIÇÃO: a regra que casa vem com `failed` e `conditions` vazios (listas, não `null`).
    expect(porId(trace.rules, pegaTudo.id)).toMatchObject({ matches: true, failed: [], conditions: [] });
  });

  test('nenhuma respondeu: a regra do near_miss traz exatamente as frases e chaves gravadas na mensagem', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const [pix, boleto] = await salvarRegras(request, t, [PIX, BOLETO]);
    const { msg } = await enviarEGuardar(request, t, '/pagamentos', PEDIDO);
    expect(msg.rule).toBeNull();
    expect(msg.near_miss).not.toBeNull();

    const trace = await lerTrace(request, t, msg.uuid);
    expect(trace.responded_by).toBeNull();
    const doNearMiss = porId(trace.rules, msg.near_miss!.id);
    expect(doNearMiss.matches).toBe(false);
    expect(doNearMiss.failed).toEqual(msg.near_miss!.failed);
    expect(doNearMiss.conditions).toEqual(msg.near_miss!.conditions);
    for (const regra of [pix, boleto]) {
      expect(porId(trace.rules, regra.id), regra.name).toMatchObject({ matches: false, ...(await missDoTeste(request, t, regra, msg.uuid)) });
    }
  });

  test('ordem de avaliação: position 1..N (menor priority, empate pela lista); desligadas no fim, position null, e casam mesmo assim', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await salvarRegras(request, t, [
      { name: 'a', priority: 5 },
      { name: 'b', priority: 1 },
      { name: 'c-desligada', priority: 1, enabled: false },
      { name: 'd', priority: 5 },
      { name: 'e', priority: 3 },
      { name: 'f-desligada', priority: 9, enabled: false },
    ]);
    const { msg } = await enviarEGuardar(request, t, '/qualquer');
    expect(msg.rule?.name).toBe('b');

    const trace = await lerTrace(request, t, msg.uuid);
    expect(trace.rules).toHaveLength(6);
    expect(trace.rules.slice(0, 4).map((r) => [r.name, r.position, r.enabled])).toEqual([
      ['b', 1, true], ['e', 2, true], ['a', 3, true], ['d', 4, true],
    ]);
    // SUPOSIÇÃO: a ordem entre as desligadas não é fixada pelo api-contrato; só que vêm no fim.
    const desligadas = trace.rules.slice(4);
    expect(desligadas.map((r) => r.name).sort()).toEqual(['c-desligada', 'f-desligada']);
    for (const r of desligadas) {
      // `matches` ignora `enabled`: sem `match`, a desligada casaria.
      expect(r, r.name).toMatchObject({ position: null, enabled: false, matches: true, failed: [], conditions: [] });
    }
  });

  test('avalia as regras atuais: trocar a lista muda o trace; responded_by continua citando a regra que respondeu, mesmo apagada', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const [antiga] = await salvarRegras(request, t, [{ name: 'antiga', response: { status: 201 } }]);
    const { msg } = await enviarEGuardar(request, t, '/pedidos');
    expect(msg.rule).toEqual({ id: antiga.id, name: 'antiga' });

    const [nova] = await salvarRegras(request, t, [{ name: 'nova', match: { path: { equals: '/x' } } }]);
    const trace = await lerTrace(request, t, msg.uuid);
    expect(trace.responded_by).toEqual({ id: antiga.id, name: 'antiga' });
    expect(trace.rules).toHaveLength(1);
    expect(trace.rules[0]).toMatchObject({ id: nova.id, name: 'nova', enabled: true, position: 1, matches: false, conditions: ['match.path'] });
    expectFalhas(trace.rules[0].failed, [/^path\b.*\/x.*\/pedidos/]);
  });

  test('URL sem regras: rules [] e responded_by null', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { msg } = await enviarEGuardar(request, t, '/a', { method: 'POST' });
    const trace = await lerTrace(request, t, msg.uuid);
    expect(trace).toEqual({ request: msg.uuid, responded_by: null, rules: [] });
  });

  test('cenário: avaliado contra o estado atual; o trace não grava mensagem nem muda o estado', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const [primeira] = await salvarRegras(request, t, [{
      name: 'primeira', match: { path: { equals: '/p' } }, scenario: { name: 'fluxo', requiredState: 'Started', newState: 'feito' },
      response: { status: 201 },
    }]);
    const { res, msg } = await enviarEGuardar(request, t, '/p');
    expect(res.status()).toBe(201);
    expect(await estadoDoCenario(request, t, 'fluxo')).toBe('feito');

    // No estado atual (`feito`) a regra não casaria: a frase do near miss diz o estado.
    for (let i = 0; i < 2; i++) {
      const trace = await lerTrace(request, t, msg.uuid);
      expect(trace.responded_by).toEqual({ id: primeira.id, name: 'primeira' });
      expect(trace.rules).toEqual([{
        id: primeira.id, name: 'primeira', enabled: true, position: 1, matches: false,
        failed: ['scenario fluxo: expected state "Started", got "feito"'], conditions: ['scenario'],
      }]);
    }
    expect(await estadoDoCenario(request, t, 'fluxo')).toBe('feito');

    // De volta a Started pela API: o trace passa a casar, e casar no trace não transiciona.
    const put = await request.put(`/token/${t}/scenarios/fluxo`, { data: { state: 'Started' }, headers: JSON_ACCEPT });
    expect(put.status(), await put.text()).toBeLessThan(300);
    expect((await lerTrace(request, t, msg.uuid)).rules[0]).toMatchObject({ matches: true, failed: [], conditions: [] });
    expect(await estadoDoCenario(request, t, 'fluxo')).toBe('Started');

    // Nada gravado: a mensagem e a listagem são as mesmas.
    const { data, total } = await listar(request, t);
    expect(total).toBe(1);
    expect(data[0]).toEqual(await buscarMensagem(request, t, msg.uuid));
    expect(data[0]).toEqual(msg);
  });

  test('assinatura e schema: vale o resultado gravado na mensagem, não o da configuração atual da URL', async ({ request, tokens }) => {
    const segredo = 'segredo-trace-antigo-1';
    const token = await tokens.criar({
      signature: { provider: 'github', secret: segredo },
      schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    });
    const corpo = '{"id":1}';
    const { msg } = await enviarEGuardar(request, token.uuid, '/assinado', {
      method: 'POST', headers: { ...JSON_CT, 'X-Hub-Signature-256': assinaturaGithub(segredo, corpo) }, data: Buffer.from(corpo),
    });
    expect(msg.signature?.valid).toBe(true);
    expect(msg.schema?.valid).toBe(true);

    // Outro segredo e um schema que o corpo não segue: recalcular daria assinatura e schema inválidos.
    const put = await request.put(`/token/${token.uuid}`, {
      data: { signature: { provider: 'github', secret: 'segredo-trace-novo-2' }, schema: { type: 'object', properties: { id: { type: 'string' } } } },
      headers: JSON_ACCEPT,
    });
    expect(put.status(), await put.text()).toBe(200);
    const agora = await enviarEGuardar(request, token.uuid, '/assinado', {
      method: 'POST', headers: { ...JSON_CT, 'X-Hub-Signature-256': assinaturaGithub(segredo, corpo) }, data: Buffer.from(corpo),
    });
    expect(agora.msg.signature?.valid, 'pré-condição: com a configuração nova a mesma requisição não confere').toBe(false);
    expect(agora.msg.schema?.valid, 'pré-condição: com o schema novo o mesmo corpo é inválido').toBe(false);

    const [assinada, valida, invalida, schemaInvalido] = await salvarRegras(request, token.uuid, [
      { name: 'assinada', match: { signature: 'valid' } },
      { name: 'schema válido', match: { schema: 'valid' } },
      { name: 'assinatura inválida', match: { signature: 'invalid' } },
      { name: 'schema inválido', match: { schema: 'invalid' } },
    ]);
    const trace = await lerTrace(request, token.uuid, msg.uuid);
    expect(porId(trace.rules, assinada.id)).toMatchObject({ matches: true, failed: [], conditions: [] });
    expect(porId(trace.rules, valida.id)).toMatchObject({ matches: true, failed: [], conditions: [] });
    const semAssinatura = porId(trace.rules, invalida.id);
    expect(semAssinatura).toMatchObject({ matches: false, conditions: ['match.signature'] });
    expectFalhas(semAssinatura.failed, [/^signature\b.*expected invalid.*got valid/]);
    const semSchema = porId(trace.rules, schemaInvalido.id);
    expect(semSchema).toMatchObject({ matches: false, conditions: ['match.schema'] });
    expectFalhas(semSchema.failed, [/^schema: expected invalid, got valid/]);
  });
});

test.describe('C1: erros', () => {
  test('token que nunca existiu e token apagado → 410 Token not found', async ({ request, tokens }) => {
    await expectErroJson(await chamarTrace(request, randomUUID(), randomUUID()), 410, 'Token not found');

    const t = (await tokens.criar()).uuid;
    const { msg } = await enviarEGuardar(request, t, '/a');
    await request.delete(`/token/${t}/request`, { headers: JSON_ACCEPT });
    expect((await request.delete(`/token/${t}`, { headers: JSON_ACCEPT })).status()).toBe(204);
    await expectErroJson(await chamarTrace(request, t, msg.uuid), 410, 'Token not found');
  });

  test('mensagem inexistente, de outra URL ou apagada → 404 com o mesmo corpo do GET /request/{id}', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const outra = (await tokens.criar()).uuid;
    await salvarRegras(request, t, [PIX]);
    const { msg: daOutra } = await enviarEGuardar(request, outra, '/a');
    const { msg: apagada } = await enviarEGuardar(request, t, '/a');
    expect((await request.delete(`/token/${t}/request/${apagada.uuid}`, { headers: JSON_ACCEPT })).status()).toBeLessThan(300);

    for (const [caso, rid] of [['inexistente', randomUUID()], ['de outra URL', daOutra.uuid], ['apagada', apagada.uuid]]) {
      const get = await request.get(`/token/${t}/request/${rid}`, { headers: JSON_ACCEPT });
      expect(get.status(), `pré-condição (${caso}): o GET da mensagem dá 404`).toBe(404);
      const trace = await chamarTrace(request, t, rid);
      await expectErroJson(trace, 404, 'Request not found');
      expect(await trace.json(), caso).toEqual(await get.json());
    }
  });
});

testPrivado.describe('C1: URL protegida', () => {
  testPrivado('sem o segredo → 401 da URL protegida; com o segredo → o trace', async ({ urls }) => {
    const url = await urls.proteger();
    const rid = await capturar(url.uuid, '/a');
    const sem = await http('GET', `/token/${url.uuid}/request/${rid}/rules/trace`);
    expect(sem.status, sem.texto.slice(0, 300)).toBe(401);
    expect(sem.json()).toEqual(ERRO_PROTEGIDA);
    const errado = await http('GET', `/token/${url.uuid}/request/${rid}/rules/trace`, { headers: comSegredo(`${url.segredo}x`) });
    expect(errado.status).toBe(401);

    const com = await http('GET', `/token/${url.uuid}/request/${rid}/rules/trace`, { headers: comSegredo(url.segredo) });
    expect(com.status, com.texto.slice(0, 300)).toBe(200);
    expect(com.json()).toEqual({ request: rid, responded_by: null, rules: [] });
  });
});
