import { enviarEGuardar, espera, expect, test } from '../../support/contrato.js';
import { erros422, expectFalhas, lerRegras, putRegras, salvarRegras, testarRegra, type Regra, type ResultadoTesteDeRegra } from '../../support/regras.js';
import { chamarEspera, esperar } from '../../support/espera.js';
import { NAO_E_JSON, PEDIDO_VALIDO, SCHEMA_PEDIDO, envioJson, expectInvalido, expectValido } from '../../support/schema.js';

// Condição `match.schema: "valid" | "invalid"` (CA-3, plano "validacao-schema" §1), como a
// `match.signature`, sobre o resultado gravado na mensagem. Sem schema configurado na URL a condição
// falha (nenhum dos dois valores casa). Frases do near miss, da §1:
//   schema: expected <valid|invalid>, got not configured
//   schema: expected valid, got invalid (<n> errors)
//   schema: expected invalid, got valid
// O `wait-for` usa o mesmo parser e as mesmas frases.

const INVALIDO = { id: 'sete', status: 'pago' };
/** Ao menos dois erros: `/id` (tipo) e `/status` (tipo e enum). */
const DOIS_ERROS = { id: 'sete', status: 5 };

const REGRAS: Regra[] = [
  { name: 'rejeita inválido', priority: 1, match: { schema: 'invalid' }, response: { status: 400, body: 'payload fora do contrato' } },
  { name: 'aceita válido', priority: 2, match: { schema: 'valid' }, response: { status: 202, body: 'ok' } },
];

const fraseNaoConfigurado = (esperado: 'valid' | 'invalid') => new RegExp(`^schema:\\s+expected\\s+${esperado},\\s+got\\s+not\\s+configured$`);
const FRASE_ESPERAVA_INVALIDO = /^schema:\s+expected\s+invalid,\s+got\s+valid$/;
const FRASE_ESPERAVA_VALIDO = /^schema:\s+expected\s+valid,\s+got\s+invalid\s+\((\d+)\s+errors?\)$/;

/** A frase `expected valid, got invalid (<n> errors)` com n = número de erros gravados na mensagem. */
function expectFraseInvalido(failed: string[], erros: number): void {
  expect(failed, JSON.stringify(failed)).toHaveLength(1);
  const m = FRASE_ESPERAVA_VALIDO.exec(failed[0]);
  expect(m, `frase: ${failed[0]}`).not.toBeNull();
  expect(Number(m![1]), `frase: ${failed[0]}`).toBe(erros);
}

test.describe('regra com match.schema (CA-3)', () => {
  test('400 para corpo inválido e para corpo que não é JSON, 202 para válido, com a rule certa', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const [inv, val] = await salvarRegras(request, token.uuid, REGRAS);

    for (const opcoes of [envioJson(INVALIDO), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: Buffer.from('oi') }, { method: 'GET' }]) {
      const { res, msg } = await enviarEGuardar(request, token.uuid, '/hook', opcoes);
      expect(res.status(), JSON.stringify(msg.schema)).toBe(400);
      expect(await res.text()).toBe('payload fora do contrato');
      expect(msg.rule).toEqual({ id: inv.id, name: 'rejeita inválido' });
      expectInvalido(msg.schema);
    }
    expect((await enviarEGuardar(request, token.uuid, '', { method: 'GET' })).msg.schema).toEqual(NAO_E_JSON);

    const ok = await enviarEGuardar(request, token.uuid, '/hook', envioJson(PEDIDO_VALIDO));
    expect(ok.res.status()).toBe(202);
    expect(await ok.res.text()).toBe('ok');
    expect(ok.msg.rule).toEqual({ id: val.id, name: 'aceita válido' });
    expectValido(ok.msg.schema);
  });

  test('só "400 quando inválido": corpo válido segue para a resposta padrão do token', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO, default_status: 200, default_content: 'padrao' });
    await salvarRegras(request, token.uuid, [REGRAS[0]]);
    expect((await enviarEGuardar(request, token.uuid, '', envioJson(INVALIDO))).res.status()).toBe(400);
    const { res, msg } = await enviarEGuardar(request, token.uuid, '', envioJson(PEDIDO_VALIDO));
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('padrao');
    expect(msg).toHaveProperty('rule', null);
  });

  test('schema combina em E com as outras condições', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    await salvarRegras(request, token.uuid, [
      { name: 'pedido válido', match: { method: ['POST'], path: { equals: '/pedidos' }, schema: 'valid' }, response: { status: 201 } },
    ]);
    expect((await enviarEGuardar(request, token.uuid, '/pedidos', envioJson(PEDIDO_VALIDO))).res.status()).toBe(201);
    expect((await enviarEGuardar(request, token.uuid, '/outro', envioJson(PEDIDO_VALIDO))).res.status()).toBe(200);
    expect((await enviarEGuardar(request, token.uuid, '/pedidos', envioJson(INVALIDO))).res.status()).toBe(200);
    expect((await enviarEGuardar(request, token.uuid, '/pedidos', envioJson(PEDIDO_VALIDO, 'PUT'))).res.status()).toBe(200);
  });

  test('URL sem schema: nem valid nem invalid casam; near miss "schema: expected <x>, got not configured"', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_status: 200, default_content: 'padrao' });
    for (const esperado of ['valid', 'invalid'] as const) {
      const [salva] = await salvarRegras(request, token.uuid, [{ name: `exige ${esperado}`, match: { schema: esperado }, response: { status: 418 } }]);
      for (const opcoes of [envioJson(PEDIDO_VALIDO), envioJson(INVALIDO), { method: 'GET' }]) {
        const { res, msg } = await enviarEGuardar(request, token.uuid, '', opcoes);
        expect(res.status(), `${esperado}: a condição falha sem schema`).toBe(200);
        expect(await res.text()).toBe('padrao');
        expect(msg).toHaveProperty('rule', null);
        expect(msg).toHaveProperty('schema', null);
        expect(msg.near_miss).toMatchObject({ id: salva.id, name: `exige ${esperado}` });
        expect(msg.near_miss!.failed, JSON.stringify(msg.near_miss)).toHaveLength(1);
        expectFalhas(msg.near_miss!.failed, [fraseNaoConfigurado(esperado)]);
      }
    }
  });

  test('near miss "schema: expected valid, got invalid (<n> errors)", n = erros da mensagem, sozinha quando só o schema falha', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const [salva] = await salvarRegras(request, token.uuid, [
      { name: 'exige válido', match: { method: ['POST'], schema: 'valid' }, response: { status: 202 } },
    ]);
    const { res, msg } = await enviarEGuardar(request, token.uuid, '', envioJson(DOIS_ERROS));
    expect(res.status()).toBe(200);
    expect(msg).toHaveProperty('rule', null);
    expect(msg.near_miss).toMatchObject({ id: salva.id, name: 'exige válido' });
    const erros = expectInvalido(msg.schema);
    expect(erros.length).toBeGreaterThanOrEqual(2);
    expectFraseInvalido(msg.near_miss!.failed, erros.length);

    // Corpo que não é JSON: um erro.
    const { msg: texto } = await enviarEGuardar(request, token.uuid, '', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: Buffer.from('x') });
    expectFraseInvalido(texto.near_miss!.failed, 1);
  });

  test('near miss "schema: expected invalid, got valid"', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const [salva] = await salvarRegras(request, token.uuid, [REGRAS[0]]);
    const { msg } = await enviarEGuardar(request, token.uuid, '', envioJson(PEDIDO_VALIDO));
    expect(msg.near_miss).toMatchObject({ id: salva.id, name: 'rejeita inválido' });
    expect(msg.near_miss!.failed, JSON.stringify(msg.near_miss)).toHaveLength(1);
    expectFalhas(msg.near_miss!.failed, [FRASE_ESPERAVA_INVALIDO]);
  });

  test('match.schema volta no GET das regras; valor fora de valid|invalid → 422 em 0.match.schema', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    await salvarRegras(request, token.uuid, REGRAS);
    expect((await lerRegras(request, token.uuid)).map((r) => r.match.schema)).toEqual(['invalid', 'valid']);

    for (const valor of ['absent', 'talvez', true, 1]) {
      const erros = await erros422(await putRegras(request, token.uuid, [{ name: 'x', match: { schema: valor } }]));
      expect(Object.keys(erros), `schema ${JSON.stringify(valor)}`).toContain('0.match.schema');
    }
    // O 422 não mexe nas regras salvas.
    expect((await lerRegras(request, token.uuid)).map((r) => r.name)).toEqual(REGRAS.map((r) => r.name));
  });

  test('rules/test avalia match.schema sobre as mensagens gravadas', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const { msg: valida } = await enviarEGuardar(request, token.uuid, '', envioJson(PEDIDO_VALIDO));
    const { msg: invalida } = await enviarEGuardar(request, token.uuid, '', envioJson(INVALIDO));
    const res = await testarRegra(request, token.uuid, { name: 't', match: { schema: 'valid' } });
    expect(res.status(), await res.text()).toBe(200);
    const resultado = (await res.json()) as ResultadoTesteDeRegra;
    expect(resultado.matches).toEqual([{ uuid: valida.uuid, seq: valida.seq }]);
    expect(resultado.misses.map(({ uuid, seq }) => ({ uuid, seq }))).toEqual([{ uuid: invalida.uuid, seq: invalida.seq }]);
    expectFraseInvalido(resultado.misses[0].failed, invalida.schema!.errors.length);
  });
});

test.describe('wait-for com match.schema (CA-3)', () => {
  test('histórico: schema valid e invalid escolhem a mensagem certa', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const { msg: invalida } = await enviarEGuardar(request, token.uuid, '', envioJson(INVALIDO));
    const { msg: valida } = await enviarEGuardar(request, token.uuid, '', envioJson(PEDIDO_VALIDO));

    const v = await esperar(request, token.uuid, { match: { schema: 'valid' }, timeout: 0 });
    expect(v.resultado).toMatchObject({ matched: true, count: 1, near_miss: null });
    expect(v.resultado.requests).toEqual([valida]);

    const i = await esperar(request, token.uuid, { match: { schema: 'invalid' }, timeout: 0 });
    expect(i.resultado).toMatchObject({ matched: true, count: 1, near_miss: null });
    expect(i.resultado.requests).toEqual([invalida]);
  });

  test('durante a espera: a mensagem válida que chega depois responde a chamada', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const pendente = esperar(request, token.uuid, { match: { method: ['POST'], schema: 'valid' }, timeout: 20_000 });
    await espera(1_000);
    await enviarEGuardar(request, token.uuid, '', envioJson(INVALIDO)); // não casa: schema
    const { msg } = await enviarEGuardar(request, token.uuid, '', envioJson(PEDIDO_VALIDO));
    const enviadaEm = Date.now();

    const { resultado, chegou } = await pendente;
    expect(resultado).toMatchObject({ matched: true, count: 1, near_miss: null });
    expect(resultado.requests.map((m) => m.uuid)).toEqual([msg.uuid]);
    expect(chegou - enviadaEm).toBeLessThan(3_000);
  });

  test('near miss do wait-for traz as frases da §1 (got invalid (n errors), got valid, not configured)', async ({ request, tokens }) => {
    const comSchema = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const { msg: invalida } = await enviarEGuardar(request, comSchema.uuid, '', envioJson(DOIS_ERROS));
    const valido = await esperar(request, comSchema.uuid, { match: { schema: 'valid' }, timeout: 0 });
    expect(valido.resultado).toMatchObject({ matched: false, count: 0, requests: [] });
    expect(valido.resultado.near_miss).toMatchObject({ uuid: invalida.uuid, seq: invalida.seq });
    expectFraseInvalido(valido.resultado.near_miss!.failed, invalida.schema!.errors.length);

    const outra = await tokens.criar({ schema: SCHEMA_PEDIDO });
    await enviarEGuardar(request, outra.uuid, '', envioJson(PEDIDO_VALIDO));
    const invalidoEsperado = await esperar(request, outra.uuid, { match: { schema: 'invalid' }, timeout: 0 });
    expect(invalidoEsperado.resultado.matched).toBe(false);
    expect(invalidoEsperado.resultado.near_miss!.failed).toHaveLength(1);
    expectFalhas(invalidoEsperado.resultado.near_miss!.failed, [FRASE_ESPERAVA_INVALIDO]);

    const semSchema = await tokens.criar();
    await enviarEGuardar(request, semSchema.uuid, '', envioJson(PEDIDO_VALIDO));
    for (const esperado of ['valid', 'invalid'] as const) {
      const { resultado } = await esperar(request, semSchema.uuid, { match: { schema: esperado }, timeout: 0 });
      expect(resultado).toMatchObject({ matched: false, count: 0, requests: [] });
      expect(resultado.near_miss!.failed, JSON.stringify(resultado.near_miss)).toHaveLength(1);
      expectFalhas(resultado.near_miss!.failed, [fraseNaoConfigurado(esperado)]);
    }
  });

  test('match.schema fora de valid|invalid → 422 em match.schema', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    for (const valor of ['absent', 'talvez', true]) {
      const { res } = await chamarEspera(request, token.uuid, { match: { schema: valor }, timeout: 20_000 });
      const erros = await erros422(res);
      expect(Object.keys(erros), `schema ${JSON.stringify(valor)}`).toContain('match.schema');
    }
  });
});
