import type { APIRequestContext } from '@playwright/test';
import { enviarEGuardar, expect, test, type Mensagem } from '../../support/contrato.js';
import { assinaturaGithub } from '../../support/assinatura.js';
import { buscar, uuidsDaBusca, type PedidoDeBusca } from '../../support/busca.js';
import { PEDIDO_VALIDO, SCHEMA_PEDIDO } from '../../support/schema.js';

// Busca por `match` (CA-2, plano "busca-filtro-diff" §1): o objeto `match` de uma regra, com o mesmo
// parser do `rules/test`, filtra as mensagens gravadas; `text` e `match` combinam em E. A URL tem
// assinatura (GitHub) e schema configurados, para que `match.signature` e `match.schema` tenham o que
// filtrar. As comparações usam `sorting: oldest` e a lista inteira, em ordem.

const SEGREDO = 'segredo-busca-3Kp9';
const CABECALHO = 'X-Hub-Signature-256';

interface Cenario {
  /** POST /pedidos, schema válido, assinatura válida, `X-Tipo: pedido`, `ref` LOTE-77. */
  a: Mensagem;
  /** POST /pedidos, schema inválido, assinatura divergente, `X-Tipo: estorno`, `ref` lote-77. */
  b: Mensagem;
  /** PUT /outro, schema válido, sem header de assinatura, `ref` lote-88. */
  c: Mensagem;
  /** GET /pedidos/9, sem corpo (schema inválido: não é JSON), sem header de assinatura. */
  d: Mensagem;
}

async function montar(request: APIRequestContext, tokenId: string): Promise<Cenario> {
  const json = (metodo: string, texto: string, headers: Record<string, string> = {}) =>
    ({ method: metodo, headers: { 'Content-Type': 'application/json', ...headers }, data: Buffer.from(texto) });
  const corpoA = JSON.stringify({ ...PEDIDO_VALIDO, ref: 'LOTE-77' });
  const a = await enviarEGuardar(request, tokenId, '/pedidos', json('POST', corpoA, {
    [CABECALHO]: assinaturaGithub(SEGREDO, corpoA), 'X-Tipo': 'pedido',
  }));
  // Assinatura do corpo de A sobre outro corpo: diverge.
  const b = await enviarEGuardar(request, tokenId, '/pedidos', json('POST', JSON.stringify({ id: 'sete', status: 'pago', ref: 'lote-77' }), {
    [CABECALHO]: assinaturaGithub(SEGREDO, corpoA), 'X-Tipo': 'estorno',
  }));
  const c = await enviarEGuardar(request, tokenId, '/outro', json('PUT', JSON.stringify({ id: 8, status: 'pendente', ref: 'lote-88' })));
  const d = await enviarEGuardar(request, tokenId, '/pedidos/9', { method: 'GET' });

  // O cenário é o que o teste supõe: confere o que a captura gravou.
  expect(a.msg.signature?.valid).toBe(true);
  expect(b.msg.signature?.valid).toBe(false);
  expect(a.msg.schema?.valid).toBe(true);
  expect(b.msg.schema?.valid).toBe(false);
  expect(c.msg.schema?.valid).toBe(true);
  expect(d.msg.schema?.valid).toBe(false);
  return { a: a.msg, b: b.msg, c: c.msg, d: d.msg };
}

async function expectBusca(request: APIRequestContext, tokenId: string, pedido: PedidoDeBusca, esperadas: Mensagem[]): Promise<void> {
  const pagina = await buscar(request, tokenId, { sorting: 'oldest', ...pedido });
  const descricao = JSON.stringify(pedido);
  expect(pagina.data.map((m) => m.uuid), descricao).toEqual(esperadas.map((m) => m.uuid));
  expect(pagina.total, descricao).toBe(esperadas.length);
}

test.describe('busca por match (CA-2)', () => {
  test('método, caminho, header, corpo, assinatura e schema filtram; match vazio ou ausente não filtra', async ({ request, tokens }) => {
    const t = (await tokens.criar({ signature: { provider: 'github', secret: SEGREDO }, schema: SCHEMA_PEDIDO })).uuid;
    const { a, b, c, d } = await montar(request, t);
    const busca = (pedido: PedidoDeBusca, esperadas: Mensagem[]) => expectBusca(request, t, pedido, esperadas);

    await busca({}, [a, b, c, d]);
    await busca({ match: {} }, [a, b, c, d]);

    // Método: lista; vazia = qualquer.
    await busca({ match: { method: ['POST'] } }, [a, b]);
    await busca({ match: { method: ['PUT', 'GET'] } }, [c, d]);
    await busca({ match: { method: ['DELETE'] } }, []);
    await busca({ match: { method: [] } }, [a, b, c, d]);

    // Caminho (depois do token, sem a query).
    await busca({ match: { path: { equals: '/pedidos' } } }, [a, b]);
    await busca({ match: { path: { prefix: '/pedidos' } } }, [a, b, d]);
    await busca({ match: { path: { regex: '^/out.*$' } } }, [c]);

    // Header: nome sem diferenciar maiúsculas.
    await busca({ match: { headers: { 'X-TIPO': { equals: 'pedido' } } } }, [a]);
    await busca({ match: { headers: { 'x-tipo': { contains: 'orno' } } } }, [b]);
    await busca({ match: { headers: { 'x-tipo': { present: false } } } }, [c, d]);

    // Corpo.
    await busca({ match: { body: [{ jsonPath: { path: '$.status', equals: 'pago' } }] } }, [a, b]);
    await busca({ match: { body: [{ contains: 'lote-88' }] } }, [c]);
    await busca({ match: { body: [{ equalToJson: { ref: 'lote-88', status: 'pendente', id: 8 } }] } }, [c]);

    // Assinatura (os três estados) e schema.
    await busca({ match: { signature: 'valid' } }, [a]);
    await busca({ match: { signature: 'invalid' } }, [b]);
    await busca({ match: { signature: 'absent' } }, [c, d]);
    await busca({ match: { schema: 'valid' } }, [a, c]);
    await busca({ match: { schema: 'invalid' } }, [b, d]);
  });

  test('as condições do match combinam em E', async ({ request, tokens }) => {
    const t = (await tokens.criar({ signature: { provider: 'github', secret: SEGREDO }, schema: SCHEMA_PEDIDO })).uuid;
    const { a, b, d } = await montar(request, t);
    const busca = (pedido: PedidoDeBusca, esperadas: Mensagem[]) => expectBusca(request, t, pedido, esperadas);

    await busca({ match: { method: ['POST'], schema: 'valid' } }, [a]);
    await busca({ match: { method: ['POST'], signature: 'invalid' } }, [b]);
    await busca({ match: { path: { prefix: '/pedidos' }, signature: 'absent' } }, [d]);
    await busca({ match: { method: ['PUT'], signature: 'valid' } }, []);
  });

  test('text e match combinam em E', async ({ request, tokens }) => {
    const t = (await tokens.criar({ signature: { provider: 'github', secret: SEGREDO }, schema: SCHEMA_PEDIDO })).uuid;
    const { a, b, c } = await montar(request, t);
    const busca = (pedido: PedidoDeBusca, esperadas: Mensagem[]) => expectBusca(request, t, pedido, esperadas);

    // `lote-77` está em A (LOTE-77) e em B (lote-77); `lote` em A, B e C.
    await busca({ text: 'lote-77' }, [a, b]);
    await busca({ text: 'LOTE', match: {} }, [a, b, c]);
    await busca({ text: 'lote-77', match: { signature: 'valid' } }, [a]);
    await busca({ text: 'lote-77', match: { schema: 'invalid' } }, [b]);
    await busca({ text: 'lote', match: { method: ['PUT'] } }, [c]);
    await busca({ text: 'lote-88', match: { method: ['POST'] } }, []);
    await busca({ text: 'estorno', match: { headers: { 'x-tipo': { present: true } } } }, [b]);
  });

  test('URL sem schema: match.schema valid e invalid não casam nada', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await enviarEGuardar(request, t, '/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: Buffer.from(JSON.stringify(PEDIDO_VALIDO)) });
    for (const match of [{ schema: 'valid' }, { schema: 'invalid' }] as const) {
      expect(await uuidsDaBusca(request, t, { match }), JSON.stringify(match)).toEqual([]);
    }
  });
});
