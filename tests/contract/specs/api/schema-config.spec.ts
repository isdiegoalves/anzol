import { CHAVES_TOKEN, enviarEGuardar, expect, test, type Token } from '../../support/contrato.js';
import { postToken, postTokenRegistrando, putToken } from '../../support/assinatura.js';
import {
  SCHEMA_INVALIDO, SCHEMA_PEDIDO, caminhos, envioJson, expect422Schema, expectInvalido, expectValido, lerToken,
  schemaComTamanho,
} from '../../support/schema.js';

// Configuração `schema` do token (CA-2, plano "validacao-schema" §1). Objeto JSON Schema (draft 2020-12
// por padrão; `$schema` draft-07 ou 2019-09 do próprio documento vale) ou `null`, no `POST /token` e no
// `PUT /token/{id}` como a `signature`: ausente no `PUT` volta a `null`; `null` desliga. Volta como foi
// enviado. Limite de 64 KB serializado. Inválido (não é objeto, não compila, `$ref` que não é interno
// `#…`) → 422 `{"schema": ["The schema is invalid: <motivo>."]}`.

const MEIO_SCHEMA = { type: 'object', properties: { n: { type: 'integer' } } };

test.describe('schema no POST /token (CA-2)', () => {
  test('POST com schema: 201 devolve o schema como enviado, e o GET também', async ({ request, tokens }) => {
    const res = await postToken(request, { schema: SCHEMA_PEDIDO });
    expect(res.status(), await res.text()).toBe(201);
    const criado = (await res.json()) as Token;
    tokens.registrar(criado.uuid);
    expect(Object.keys(criado).sort()).toEqual(CHAVES_TOKEN);
    expect(criado.schema).toEqual(SCHEMA_PEDIDO);
    expect((await lerToken(request, criado.uuid)).schema).toEqual(SCHEMA_PEDIDO);
  });

  test('POST sem o campo e com schema null → schema null (token sem o campo lê como null)', async ({ request, tokens }) => {
    const semCampo = await tokens.criar({ default_status: 202 });
    expect(semCampo).toHaveProperty('schema', null);
    expect(await lerToken(request, semCampo.uuid)).toHaveProperty('schema', null);

    const comNull = await tokens.criar({ schema: null });
    expect(comNull).toHaveProperty('schema', null);
    expect(await lerToken(request, comNull.uuid)).toHaveProperty('schema', null);
  });

  test('schema {} é configuração (não é null): volta {} e valida', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: {} });
    expect(token.schema).toEqual({});
    expect((await lerToken(request, token.uuid)).schema).toEqual({});
    expectValido((await enviarEGuardar(request, token.uuid, '', envioJson({ a: 1 }))).msg.schema);
  });

  test('$ref interno (#/$defs/…) é aceito e usado na validação', async ({ request, tokens }) => {
    const schema = {
      $defs: { positivo: { type: 'integer', minimum: 1 } },
      type: 'object',
      properties: { n: { $ref: '#/$defs/positivo' }, lista: { type: 'array', items: { $ref: '#/$defs/positivo' } } },
    };
    const token = await tokens.criar({ schema });
    expect(token.schema).toEqual(schema);
    expectValido((await enviarEGuardar(request, token.uuid, '', envioJson({ n: 2, lista: [1, 5] }))).msg.schema);
    const erros = expectInvalido((await enviarEGuardar(request, token.uuid, '', envioJson({ n: 0, lista: [1, -1] }))).msg.schema);
    expect([...new Set(caminhos(erros))].sort()).toEqual(['/lista/1', '/n']);
  });

  test('schema de 60.000 bytes é aceito (abaixo de 64 KB)', async ({ request, tokens }) => {
    const schema = schemaComTamanho(60_000);
    const token = await tokens.criar({ schema });
    expect(token.schema).toEqual(schema);
    expectValido((await enviarEGuardar(request, token.uuid, '', envioJson({}))).msg.schema);
  });
});

test.describe('schema no PUT /token/{id} (CA-2)', () => {
  test('PUT troca o schema; o GET devolve o novo e a validação segue o novo', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const res = await putToken(request, token.uuid, { schema: MEIO_SCHEMA });
    expect(res.status(), await res.text()).toBe(200);
    expect(((await res.json()) as Token).schema).toEqual(MEIO_SCHEMA);
    expect((await lerToken(request, token.uuid)).schema).toEqual(MEIO_SCHEMA);
    expectValido((await enviarEGuardar(request, token.uuid, '', envioJson({ n: 1 }))).msg.schema);
  });

  test('PUT com schema null desliga; PUT sem o campo também (volta ao padrão null)', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const nulo = await putToken(request, token.uuid, { schema: null });
    expect(nulo.status()).toBe(200);
    expect(await nulo.json()).toHaveProperty('schema', null);
    expect(await lerToken(request, token.uuid)).toHaveProperty('schema', null);
    expect((await enviarEGuardar(request, token.uuid, '', envioJson({ id: 'x' }))).msg).toHaveProperty('schema', null);

    expect((await putToken(request, token.uuid, { schema: SCHEMA_PEDIDO })).status()).toBe(200);
    expect((await lerToken(request, token.uuid)).schema).toEqual(SCHEMA_PEDIDO);
    const ausente = await putToken(request, token.uuid, { default_content: 'x' });
    expect(ausente.status()).toBe(200);
    expect(await ausente.json()).toHaveProperty('schema', null);
    expect(await lerToken(request, token.uuid)).toHaveProperty('schema', null);
    expect((await enviarEGuardar(request, token.uuid, '', envioJson({ id: 'x' }))).msg).toHaveProperty('schema', null);
  });

  test('PUT liga o schema num token criado sem ele', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect((await putToken(request, token.uuid, { schema: MEIO_SCHEMA })).status()).toBe(200);
    expect((await lerToken(request, token.uuid)).schema).toEqual(MEIO_SCHEMA);
    expectInvalido((await enviarEGuardar(request, token.uuid, '', envioJson({ n: 'um' }))).msg.schema);
  });
});

// Casos de 422. `mensagem` exata: `The schema is invalid: <motivo>.` para os três motivos da §1;
// para o tamanho, só a forma do Laravel (a §1 não fixa o texto).
const NAO_OBJETO: Array<[string, unknown]> = [
  ['texto', '{"type":"object"}'],
  ['número', 42],
  ['lista', [{ type: 'object' }]],
  ['booleano true (schema booleano não vale: tem de ser objeto)', true],
  ['booleano false', false],
];

const NAO_COMPILA: Array<[string, unknown]> = [
  ['type desconhecido', { type: 'banana' }],
  ['required que não é lista', { type: 'object', required: 'id' }],
  ['minLength negativo', { type: 'string', minLength: -1 }],
  ['properties que não é objeto', { type: 'object', properties: [{ type: 'string' }] }],
  ['pattern com regex inválida', { type: 'string', pattern: '([a-z' }],
];

const REF_REMOTO: Array<[string, unknown]> = [
  ['$ref https na raiz', { $ref: 'https://example.com/schemas/pedido.json' }],
  ['$ref http aninhado', { type: 'object', properties: { a: { $ref: 'http://169.254.169.254/latest/meta-data' } } }],
  ['$ref relativo a outro documento', { type: 'object', properties: { a: { $ref: 'outro.json#/x' } } }],
  ['$ref file:', { $ref: 'file:///etc/passwd' }],
];

test.describe('schema inválido → 422 (CA-2)', () => {
  for (const [grupo, casos] of [['não é objeto', NAO_OBJETO], ['não compila', NAO_COMPILA], ['$ref remoto', REF_REMOTO]] as const) {
    for (const [nome, schema] of casos) {
      test(`POST: ${grupo} (${nome}) → 422 {"schema": ["The schema is invalid: …"]}`, async ({ request, tokens }) => {
        const { res } = await postTokenRegistrando(request, tokens, { schema });
        expect(await expect422Schema(res, schema)).toMatch(SCHEMA_INVALIDO);
      });
    }
  }

  test('POST: schema de 65.537 bytes (acima de 64 KB) → 422 em schema', async ({ request, tokens }) => {
    const schema = schemaComTamanho(64 * 1024 + 1);
    const { res } = await postTokenRegistrando(request, tokens, { schema });
    await expect422Schema(res, { tamanho: 64 * 1024 + 1 });
  });

  test('PUT: cada caso inválido → 422 e a configuração salva não muda', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const invalidos = [...NAO_OBJETO, ...NAO_COMPILA, ...REF_REMOTO].map(([, s]) => s);
    for (const schema of invalidos) {
      expect(await expect422Schema(await putToken(request, token.uuid, { schema }), schema)).toMatch(SCHEMA_INVALIDO);
    }
    await expect422Schema(await putToken(request, token.uuid, { schema: schemaComTamanho(64 * 1024 + 1) }), { tamanho: '65537' });

    expect((await lerToken(request, token.uuid)).schema).toEqual(SCHEMA_PEDIDO);
    expectValido((await enviarEGuardar(request, token.uuid, '', envioJson({ id: 1, status: 'pago' }))).msg.schema);
  });
});
