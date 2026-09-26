import { buscarMensagem, expect, test, type Token } from '../../support/contrato.js';
import { ADAPTADOR, assinar, type Assinatura } from '../../support/eventos.js';
import { NAO_E_JSON, PEDIDO_VALIDO, SCHEMA_PEDIDO, expectInvalido, expectValido } from '../../support/schema.js';

// Evento `request.created` com o resultado da validação de schema (CA-4, plano "validacao-schema"
// §1): o `request` do evento é a mensagem gravada, com o campo `schema` (`{valid, errors}` ou `null`
// sem schema na URL). O corte de 1.000.000 caracteres tira `content`, `headers` e `user_agent`, não o
// `schema`.

test.describe(`evento request.created com schema (adaptador ${ADAPTADOR})`, () => {
  let assinaturas: Assinatura[] = [];

  async function abrir(token: Token): Promise<Assinatura> {
    const a = await assinar(token.uuid);
    assinaturas.push(a);
    return a;
  }

  test.afterEach(async () => {
    for (const a of assinaturas) await a.fechar();
    assinaturas = [];
  });

  const json = (corpo: unknown) => ({ data: Buffer.from(JSON.stringify(corpo)), headers: { 'Content-Type': 'application/json' } });

  test('corpo válido: request.schema = {valid: true, errors: []}, igual à mensagem gravada', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const canal = await abrir(token);
    const res = await request.post(`/${token.uuid}`, json(PEDIDO_VALIDO));
    const evento = await canal.proximo();
    expect(evento.request).toHaveProperty('schema');
    expectValido(evento.request.schema);
    const gravada = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
    expect(evento.request).toEqual(gravada);
  });

  test('corpo inválido: request.schema traz valid false e os mesmos erros da mensagem gravada', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const canal = await abrir(token);
    const res = await request.post(`/${token.uuid}`, json({ id: 'sete', status: 'pago' }));
    const evento = await canal.proximo();
    const erros = expectInvalido(evento.request.schema);
    expect(erros.map((e) => e.path)).toContain('/id');
    const gravada = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
    expect(evento.request.schema).toEqual(gravada.schema);
    expect(evento.request).toEqual(gravada);
  });

  test('corpo que não é JSON: request.schema = body is not JSON', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const canal = await abrir(token);
    await request.get(`/${token.uuid}`);
    const evento = await canal.proximo();
    expect(evento.request.schema).toEqual(NAO_E_JSON);
  });

  test('URL sem schema: request.schema null (a chave existe)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const canal = await abrir(token);
    await request.post(`/${token.uuid}`, json(PEDIDO_VALIDO));
    const evento = await canal.proximo();
    expect(evento.request).toHaveProperty('schema', null);
  });

  test('evento truncated também leva o schema', async ({ request, tokens }) => {
    const token = await tokens.criar({ schema: SCHEMA_PEDIDO });
    const canal = await abrir(token);
    await request.post(`/${token.uuid}`, { data: Buffer.from('/'.repeat(600_000)), headers: { 'Content-Type': 'text/plain' } });
    const evento = await canal.proximo();
    expect(evento.truncated).toBe(true);
    expect(evento.request.schema).toEqual(NAO_E_JSON);
  });
});
