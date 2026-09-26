import { enviarEGuardar, expect, listar, test } from '../../support/contrato.js';
import { putToken } from '../../support/assinatura.js';
import {
  NAO_E_JSON, PEDIDO_VALIDO, PONTEIRO_JSON, SCHEMA_PEDIDO, TETO_DE_ERROS, caminhos, envioJson, expectForma, expectInvalido,
  expectValido,
} from '../../support/schema.js';

// Validação na captura (CA-1, plano "validacao-schema" §1). Com schema configurado, cada requisição
// grava `schema: {valid, errors}` na mensagem: válido → `{valid: true, errors: []}`; inválido →
// `valid: false` e `errors` = `[{path, message}]`, `path` = JSON Pointer da instância, no máximo 20
// (os primeiros, em ordem estável). Corpo vazio ou que não é JSON → exatamente um erro
// `{"path": "", "message": "body is not JSON"}`. Sem schema na URL, `schema: null`. O texto de
// `message` é o da biblioteca: o contrato só olha `path`, salvo no `body is not JSON`.

const distintos = (lista: string[]): string[] => [...new Set(lista)].sort();

test.describe('mensagem com schema configurado (CA-1)', () => {
  test('corpo válido → schema {valid: true, errors: []} no GET e na listagem; a resposta é a padrão do token', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO, default_status: 201, default_content: 'recebido' });
    const { res, msg } = await enviarEGuardar(request, token.uuid, '/pedidos', envioJson(PEDIDO_VALIDO));
    expect(res.status()).toBe(201);
    expect(await res.text()).toBe('recebido');
    expectValido(msg.schema);

    const { data } = await listar(request, token.uuid);
    expect(data).toHaveLength(1);
    expectValido(data[0].schema);
  });

  test('corpo inválido → valid false, um path JSON Pointer por instância que falhou; a resposta não muda', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO, default_status: 201, default_content: 'recebido' });
    const corpo = { id: 'sete', status: 'cancelado', itens: [{ qtd: 1 }, { qtd: 0 }] };
    const { res, msg } = await enviarEGuardar(request, token.uuid, '/pedidos', envioJson(corpo));
    expect(res.status(), 'schema inválido sem regra não muda a resposta').toBe(201);
    expect(await res.text()).toBe('recebido');

    const erros = expectInvalido(msg.schema);
    expect(distintos(caminhos(erros)), JSON.stringify(erros)).toEqual(['/id', '/itens/1/qtd', '/status']);

    const { data } = await listar(request, token.uuid);
    expect(data[0].schema).toEqual(msg.schema);
  });

  test('propriedade obrigatória ausente → path do objeto que a devia ter ("" na raiz, /itens/0 no item)', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const { msg } = await enviarEGuardar(request, token.uuid, '', envioJson({ status: 'pago', itens: [{}] }));
    const erros = expectInvalido(msg.schema);
    expect(distintos(caminhos(erros)), JSON.stringify(erros)).toEqual(['', '/itens/0']);
  });

  test('path escapa "/" como ~1 e "~" como ~0 (RFC 6901)', async ({ request, tokens }) => {
    const token = await tokens.criar({
      schema: { type: 'object', properties: { 'a/b': { type: 'integer' }, 'm~n': { type: 'integer' } } },
    });
    const { msg } = await enviarEGuardar(request, token.uuid, '', envioJson({ 'a/b': 'x', 'm~n': 'y', ok: 1 }));
    const erros = expectInvalido(msg.schema);
    expect(distintos(caminhos(erros)), JSON.stringify(erros)).toEqual(['/a~1b', '/m~0n']);
  });

  test('no máximo 20 erros, em ordem estável; abaixo do teto vêm todos', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: { type: 'array', items: { type: 'integer' } } });
    const trinta = Array.from({ length: 30 }, (_, i) => `x${i}`);

    const { msg: primeira } = await enviarEGuardar(request, token.uuid, '', envioJson(trinta));
    const erros = expectInvalido(primeira.schema);
    expect(erros, JSON.stringify(erros)).toHaveLength(TETO_DE_ERROS);
    const validos = new Set(trinta.map((_, i) => `/${i}`));
    for (const p of caminhos(erros)) expect(validos.has(p), `path ${p} fora de /0../29`).toBe(true);
    expect(new Set(caminhos(erros)).size, 'um erro por item: 20 itens distintos').toBe(TETO_DE_ERROS);

    // Mesmo corpo de novo: a mesma lista, na mesma ordem.
    const { msg: segunda } = await enviarEGuardar(request, token.uuid, '', envioJson(trinta));
    expect(segunda.schema).toEqual(primeira.schema);

    const { msg: cinco } = await enviarEGuardar(request, token.uuid, '', envioJson(['a', 'b', 'c', 'd', 'e']));
    expect(distintos(caminhos(expectInvalido(cinco.schema)))).toEqual(['/0', '/1', '/2', '/3', '/4']);
  });

  test('corpo que não é JSON → exatamente {valid: false, errors: [{path: "", message: "body is not JSON"}]}', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const envios = [
      { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: Buffer.from('olá, mundo') },
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: Buffer.from('{"id": 7, "status":') },
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: Buffer.from('id=7&status=pago') },
      { method: 'PUT', headers: { 'Content-Type': 'application/xml' }, data: Buffer.from('<pedido id="7"/>') },
    ];
    for (const opcoes of envios) {
      const { msg } = await enviarEGuardar(request, token.uuid, '', opcoes);
      expect(msg.schema, `${opcoes.headers['Content-Type']}: ${opcoes.data.toString()}`).toEqual(NAO_E_JSON);
    }
  });

  test('corpo vazio → body is not JSON (GET sem corpo e POST JSON vazio)', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const { msg: get } = await enviarEGuardar(request, token.uuid, '', { method: 'GET' });
    expect(get.schema).toEqual(NAO_E_JSON);
    const { msg: post } = await enviarEGuardar(request, token.uuid, '', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, data: Buffer.alloc(0),
    });
    expect(post.schema).toEqual(NAO_E_JSON);
  });

  test('JSON escalar é JSON: valida contra o schema', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: { type: 'integer', minimum: 10 } });
    expectValido((await enviarEGuardar(request, token.uuid, '', envioJson('42'))).msg.schema);
    const erros = expectInvalido((await enviarEGuardar(request, token.uuid, '', envioJson('"42"'))).msg.schema);
    expect(distintos(caminhos(erros))).toEqual(['']);
    expect(caminhos(expectInvalido((await enviarEGuardar(request, token.uuid, '', envioJson('3'))).msg.schema))).toContain('');
  });

  test('schema {} aceita todo JSON, mas corpo não-JSON continua inválido', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: {} });
    expectValido((await enviarEGuardar(request, token.uuid, '', envioJson({ qualquer: [1, 'dois', null] }))).msg.schema);
    expect((await enviarEGuardar(request, token.uuid, '', { method: 'GET' })).msg.schema).toEqual(NAO_E_JSON);
  });

  test('draft 2020-12 por padrão: prefixItems vale sem $schema', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: { type: 'array', prefixItems: [{ type: 'integer' }], items: false } });
    expectValido((await enviarEGuardar(request, token.uuid, '', envioJson([1]))).msg.schema);
    expectInvalido((await enviarEGuardar(request, token.uuid, '', envioJson([1, 'extra']))).msg.schema);
    const erros = expectInvalido((await enviarEGuardar(request, token.uuid, '', envioJson(['x']))).msg.schema);
    expect(caminhos(erros)).toContain('/0');
  });

  for (const [draft, uri] of [
    ['draft-07', 'http://json-schema.org/draft-07/schema#'],
    ['2019-09', 'https://json-schema.org/draft/2019-09/schema'],
  ] as const) {
    test(`$schema ${draft} no documento vale: items em lista (tupla) com additionalItems false`, async ({ request, tokens }) => {
      const token = await tokens.criar({
        schema: { $schema: uri, type: 'array', items: [{ type: 'integer' }], additionalItems: false },
      });
      expectValido((await enviarEGuardar(request, token.uuid, '', envioJson([1]))).msg.schema);
      expectInvalido((await enviarEGuardar(request, token.uuid, '', envioJson([1, 2]))).msg.schema);
      expect(caminhos(expectInvalido((await enviarEGuardar(request, token.uuid, '', envioJson(['x']))).msg.schema))).toContain('/0');
    });
  }
});

test.describe('mensagem sem schema e resultado do momento da captura (CA-1)', () => {
  test('URL sem schema → schema null para qualquer corpo, no GET e na listagem', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(token).toHaveProperty('schema', null);
    const envios = [
      envioJson(PEDIDO_VALIDO),
      envioJson({ id: 'sete' }),
      { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: Buffer.from('texto') },
      { method: 'GET' },
    ];
    for (const opcoes of envios) {
      const { msg } = await enviarEGuardar(request, token.uuid, '', opcoes);
      expect(msg).toHaveProperty('schema', null);
    }
    const { data } = await listar(request, token.uuid);
    expect(data).toHaveLength(envios.length);
    for (const m of data) expect(m).toHaveProperty('schema', null);
  });

  test('trocar ou tirar o schema não revalida o histórico: cada mensagem guarda o resultado da captura', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg: antes } = await enviarEGuardar(request, token.uuid, '', envioJson({ id: 1, status: 'pago' }));
    expect(antes).toHaveProperty('schema', null);

    expect((await putToken(request, token.uuid, { schema: SCHEMA_PEDIDO })).status()).toBe(200);
    const { msg: comPedido } = await enviarEGuardar(request, token.uuid, '', envioJson({ id: 1, status: 'pago' }));
    expectValido(comPedido.schema);

    // Schema novo que a mesma forma de corpo não cumpre.
    expect((await putToken(request, token.uuid, { schema: { type: 'object', required: ['cliente'] } })).status()).toBe(200);
    const { msg: comCliente } = await enviarEGuardar(request, token.uuid, '', envioJson({ id: 1, status: 'pago' }));
    expectInvalido(comCliente.schema);

    expect((await putToken(request, token.uuid, { schema: null })).status()).toBe(200);
    const { msg: depois } = await enviarEGuardar(request, token.uuid, '', envioJson({ id: 1, status: 'pago' }));
    expect(depois).toHaveProperty('schema', null);

    const porUuid = Object.fromEntries((await listar(request, token.uuid)).data.map((m) => [m.uuid, m.schema]));
    expect(porUuid[antes.uuid]).toBeNull();
    expect(porUuid[comPedido.uuid]).toEqual({ valid: true, errors: [] });
    expect(porUuid[comCliente.uuid]).toEqual(comCliente.schema);
    expect(porUuid[depois.uuid]).toBeNull();
  });

  test('forma dos erros: {path, message} com message não vazia e path sempre JSON Pointer', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const { msg } = await enviarEGuardar(request, token.uuid, '', envioJson({ id: 1.5, status: 3, itens: 'nenhum' }));
    const erros = expectInvalido(msg.schema);
    expectForma(msg.schema!);
    for (const e of erros) expect(e.path).toMatch(PONTEIRO_JSON);
    expect(distintos(caminhos(erros))).toEqual(['/id', '/itens', '/status']);
  });
});
