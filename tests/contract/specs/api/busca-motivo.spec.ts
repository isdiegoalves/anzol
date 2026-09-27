import type { APIRequestContext } from '@playwright/test';
import { JSON_ACCEPT, enviarEGuardar, expect, expectContentType, listar, test, type Mensagem } from '../../support/contrato.js';
import { agoraEmSegundos, assinaturaGithub, assinaturaStripe } from '../../support/assinatura.js';
import { buscar, chamarBusca, metaEsperada, type PedidoDeBusca } from '../../support/busca.js';
import { erros422 } from '../../support/regras.js';
import { SCHEMA_PEDIDO } from '../../support/schema.js';

// Decisões do Anzol, M1 (`anzol-busca-motivo`; `.docs-arquivo/decisoes-anzol/api.md`): a busca aceita, no topo do
// corpo e fora de `match`, `signature_reason` (o `reason` da assinatura inválida sem o parêntese final, o texto de
// `/stats` `signature.reasons[].reason`) e `schema_path` (o `path` JSON Pointer de um erro do schema, o de `/stats`
// `schema.paths[].path`; `""` = raiz). Combinam em E com o resto; `null` = ausente; sem eles a busca é a de hoje.
// 422 em `signature_reason` (não texto, vazio, > 200) e `schema_path` (não texto, não JSON Pointer, > 1000).

const SEGREDO = 'segredo-busca-motivo-8Hq3';
const JSON_CT = { 'Content-Type': 'application/json' };

interface Cenario {
  /** Stripe válida, schema válido. */
  valida: Mensagem;
  /** Assinatura de outro corpo: `signature mismatch`; schema inválido em `/id`. */
  divergente: Mensagem;
  /** Timestamp 412 s atrás: `timestamp outside tolerance (≈412 s)`; schema inválido em `/status`. */
  vencida1: Mensagem;
  /** Timestamp 900 s atrás: `timestamp outside tolerance (≈900 s)`; schema inválido em `/id` e `/status`. */
  vencida2: Mensagem;
  /** Sem header: `header Stripe-Signature absent`; corpo que não é JSON: schema com o erro na raiz (`""`). */
  ausente: Mensagem;
  /** Header sem `t`/`v1`: `malformed header`; schema válido. */
  malformada: Mensagem;
}

async function montar(request: APIRequestContext, t: string): Promise<Cenario> {
  const enviar = async (corpo: string, cabecalho?: string, tipo = JSON_CT) =>
    (await enviarEGuardar(request, t, '/evento', {
      method: 'POST', headers: { ...tipo, ...(cabecalho === undefined ? {} : { 'Stripe-Signature': cabecalho }) }, data: Buffer.from(corpo),
    })).msg;
  const ok = JSON.stringify({ id: 1, status: 'pago' });
  const agora = agoraEmSegundos();
  const valida = await enviar(ok, assinaturaStripe(SEGREDO, ok).header);
  const semId = JSON.stringify({ id: 'um', status: 'pago' });
  const divergente = await enviar(semId, assinaturaStripe(SEGREDO, ok).header);
  const semStatus = JSON.stringify({ id: 2, status: 5 });
  const vencida1 = await enviar(semStatus, assinaturaStripe(SEGREDO, semStatus, agora - 412).header);
  const semNada = JSON.stringify({ id: 'tres', status: 5 });
  const vencida2 = await enviar(semNada, assinaturaStripe(SEGREDO, semNada, agora - 900).header);
  const ausente = await enviar('não é JSON', undefined, { 'Content-Type': 'text/plain' });
  const malformada = await enviar(ok, 'isto-nao-e-stripe');

  // O cenário é o que o teste supõe: confere o que a captura gravou.
  expect(valida.signature?.valid).toBe(true);
  expect(divergente.signature?.reason).toBe('signature mismatch');
  expect(vencida1.signature?.reason).toMatch(/^timestamp outside tolerance \(\d+ s\)$/);
  expect(vencida2.signature?.reason).toMatch(/^timestamp outside tolerance \(\d+ s\)$/);
  expect(vencida1.signature?.reason).not.toBe(vencida2.signature?.reason);
  expect(ausente.signature?.reason).toBe('header Stripe-Signature absent');
  expect(malformada.signature?.reason).toBe('malformed header');
  expect(valida.schema?.valid).toBe(true);
  expect(malformada.schema?.valid).toBe(true);
  expect(divergente.schema?.errors.map((e) => e.path)).toEqual(['/id']);
  expect(vencida1.schema?.errors.map((e) => e.path)).toEqual(['/status']);
  expect(vencida2.schema?.errors.map((e) => e.path).sort()).toEqual(['/id', '/status']);
  expect(ausente.schema?.errors.map((e) => e.path)).toEqual(['']);
  return { valida, divergente, vencida1, vencida2, ausente, malformada };
}

async function urlStripeComSchema(tokens: { criar(d: Record<string, unknown>): Promise<{ uuid: string }> }): Promise<string> {
  return (await tokens.criar({
    signature: { provider: 'stripe', secret: SEGREDO },
    schema: { type: 'object', required: ['id', 'status'], properties: { id: { type: 'integer' }, status: { type: 'string' } } },
  })).uuid;
}

async function expectBusca(request: APIRequestContext, t: string, pedido: PedidoDeBusca, esperadas: Mensagem[]): Promise<void> {
  const pagina = await buscar(request, t, { sorting: 'oldest', ...pedido });
  const descricao = JSON.stringify(pedido);
  expect(pagina.data.map((m) => m.uuid), descricao).toEqual(esperadas.map((m) => m.uuid));
  expect(pagina.total, descricao).toBe(esperadas.length);
}

test.describe('M1: busca pelo motivo exato da assinatura', () => {
  test('signature_reason casa o motivo sem o parêntese final; cada motivo acha só as suas', async ({ request, tokens }) => {
    const t = await urlStripeComSchema(tokens);
    const c = await montar(request, t);
    await expectBusca(request, t, { signature_reason: 'timestamp outside tolerance' }, [c.vencida1, c.vencida2]);
    await expectBusca(request, t, { signature_reason: 'signature mismatch' }, [c.divergente]);
    await expectBusca(request, t, { signature_reason: 'malformed header' }, [c.malformada]);
    await expectBusca(request, t, { signature_reason: 'header Stripe-Signature absent' }, [c.ausente]);
  });

  test('o parêntese do valor também sai: com ele, casa o motivo inteiro, não só aquela idade', async ({ request, tokens }) => {
    const t = await urlStripeComSchema(tokens);
    const c = await montar(request, t);
    await expectBusca(request, t, { signature_reason: c.vencida1.signature!.reason! }, [c.vencida1, c.vencida2]);
  });

  test('exato: trecho, outra caixa ou motivo que não existe não acham nada; a válida nunca aparece', async ({ request, tokens }) => {
    const t = await urlStripeComSchema(tokens);
    await montar(request, t);
    for (const valor of ['timestamp', 'Signature mismatch', 'SIGNATURE MISMATCH', 'signature  mismatch', 'mismatch', 'header absent', 'valid']) {
      await expectBusca(request, t, { signature_reason: valor }, []);
    }
  });

  test('URL sem assinatura configurada: nenhuma mensagem casa', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await enviarEGuardar(request, t, '/x', { method: 'POST', headers: { 'Stripe-Signature': 't=1,v1=00' }, data: Buffer.from('{}') });
    await expectBusca(request, t, { signature_reason: 'signature mismatch' }, []);
    await expectBusca(request, t, { signature_reason: 'header Stripe-Signature absent' }, []);
  });

  test('GitHub: o motivo de header ausente cita o header do provedor', async ({ request, tokens }) => {
    const t = (await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } })).uuid;
    const { msg: sem } = await enviarEGuardar(request, t, '/x', { method: 'POST', data: Buffer.from('{}') });
    const { msg: errada } = await enviarEGuardar(request, t, '/x', {
      method: 'POST', headers: { 'X-Hub-Signature-256': assinaturaGithub('outro', '{}') }, data: Buffer.from('{}'),
    });
    expect(sem.signature?.reason).toBe('header X-Hub-Signature-256 absent');
    await expectBusca(request, t, { signature_reason: 'header X-Hub-Signature-256 absent' }, [sem]);
    await expectBusca(request, t, { signature_reason: 'signature mismatch' }, [errada]);
  });
});

test.describe('M1: busca pelo caminho do erro de schema', () => {
  test('schema_path casa algum erro com o path exato; "" é a raiz', async ({ request, tokens }) => {
    const t = await urlStripeComSchema(tokens);
    const c = await montar(request, t);
    await expectBusca(request, t, { schema_path: '/id' }, [c.divergente, c.vencida2]);
    await expectBusca(request, t, { schema_path: '/status' }, [c.vencida1, c.vencida2]);
    await expectBusca(request, t, { schema_path: '' }, [c.ausente]);
    // Exato: prefixo, outro caminho ou outra grafia não acham.
    for (const valor of ['/i', '/id/0', '/ID', '/nada']) await expectBusca(request, t, { schema_path: valor }, []);
  });

  test('caminho aninhado e com escape (~1, ~0)', async ({ request, tokens }) => {
    const t = (await tokens.criar({ schema: SCHEMA_PEDIDO })).uuid;
    const { msg: item } = await enviarEGuardar(request, t, '', {
      method: 'POST', headers: JSON_CT, data: Buffer.from(JSON.stringify({ id: 1, status: 'pago', itens: [{ qtd: 1 }, { qtd: 0 }] })),
    });
    expect(item.schema?.errors.map((e) => e.path)).toEqual(['/itens/1/qtd']);
    const t2 = (await tokens.criar({ schema: { type: 'object', properties: { 'a/b': { type: 'integer' }, 'm~n': { type: 'integer' } } } })).uuid;
    const { msg: escapado } = await enviarEGuardar(request, t2, '', {
      method: 'POST', headers: JSON_CT, data: Buffer.from(JSON.stringify({ 'a/b': 'x', 'm~n': 'y' })),
    });
    expect(escapado.schema?.errors.map((e) => e.path).sort()).toEqual(['/a~1b', '/m~0n']);

    await expectBusca(request, t, { schema_path: '/itens/1/qtd' }, [item]);
    await expectBusca(request, t, { schema_path: '/itens/0/qtd' }, []);
    await expectBusca(request, t2, { schema_path: '/a~1b' }, [escapado]);
    await expectBusca(request, t2, { schema_path: '/m~0n' }, [escapado]);
  });

  test('URL sem schema: nenhuma casa, nem a raiz', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await enviarEGuardar(request, t, '/x', { method: 'POST', data: Buffer.from('não é JSON') });
    await expectBusca(request, t, { schema_path: '' }, []);
    await expectBusca(request, t, { schema_path: '/id' }, []);
  });
});

test.describe('M1: combinação, paginação e compatibilidade', () => {
  test('em E entre si e com text, match e outcome', async ({ request, tokens }) => {
    const t = await urlStripeComSchema(tokens);
    const c = await montar(request, t);
    await expectBusca(request, t, { signature_reason: 'timestamp outside tolerance', schema_path: '/id' }, [c.vencida2]);
    await expectBusca(request, t, { signature_reason: 'signature mismatch', schema_path: '/status' }, []);
    await expectBusca(request, t, { schema_path: '/id', match: { signature: 'invalid' } }, [c.divergente, c.vencida2]);
    await expectBusca(request, t, { signature_reason: 'timestamp outside tolerance', text: '"tres"' }, [c.vencida2]);
    await expectBusca(request, t, { signature_reason: 'malformed header', outcome: { type: 'default' } }, [c.malformada]);
    await expectBusca(request, t, { schema_path: '', match: { method: ['GET'] } }, []);
  });

  test('paginação e ordenação sobre o filtrado', async ({ request, tokens }) => {
    const t = await urlStripeComSchema(tokens);
    const c = await montar(request, t);
    const oldest = [c.vencida1, c.vencida2];
    for (const [sorting, ordem] of [['oldest', oldest], ['newest', [...oldest].reverse()]] as const) {
      for (let page = 1; page <= 3; page++) {
        const { data, ...meta } = await buscar(request, t, { signature_reason: 'timestamp outside tolerance', sorting, page, per_page: 1 });
        expect(meta, `${sorting} ${page}`).toEqual(metaEsperada(2, page, 1));
        expect(data.map((m) => m.uuid), `${sorting} ${page}`).toEqual(ordem.slice(page - 1, page).map((m) => m.uuid));
      }
    }
  });

  test('null vale como ausente; sem os campos, a busca é a listagem de sempre', async ({ request, tokens }) => {
    const t = await urlStripeComSchema(tokens);
    await montar(request, t);
    const todas = await listar(request, t, 'sorting=oldest');
    expect(await buscar(request, t, { sorting: 'oldest' })).toEqual(todas);
    expect(await buscar(request, t, { sorting: 'oldest', signature_reason: null, schema_path: null })).toEqual(todas);
  });

  test('o que o /stats lista é o que a busca acha: count do motivo e do caminho = total da busca', async ({ request, tokens }) => {
    const t = await urlStripeComSchema(tokens);
    await montar(request, t);
    const res = await request.get(`/token/${t}/stats`, { headers: JSON_ACCEPT });
    expect(res.status(), await res.text()).toBe(200);
    const stats = (await res.json()) as {
      signature: { reasons: Array<{ reason: string; count: number }> };
      schema: { paths: Array<{ path: string; count: number }> };
    };
    expect(stats.signature.reasons.length, 'pré-condição: o /stats lista motivos').toBeGreaterThanOrEqual(4);
    for (const { reason, count } of stats.signature.reasons) {
      expect((await buscar(request, t, { signature_reason: reason })).total, reason).toBe(count);
    }
    expect(stats.schema.paths.length, 'pré-condição: o /stats lista caminhos').toBeGreaterThanOrEqual(3);
    for (const { path, count } of stats.schema.paths) {
      expect((await buscar(request, t, { schema_path: path })).total, JSON.stringify(path)).toBe(count);
    }
  });
});

async function expect422(request: APIRequestContext, t: string, corpo: Record<string, unknown>, chave: string): Promise<void> {
  const res = await chamarBusca(request, t, corpo);
  const descricao = JSON.stringify(corpo).slice(0, 120);
  expect(res.status(), `${descricao}: ${(await res.text()).slice(0, 300)}`).toBe(422);
  expectContentType(res, 'application/json');
  const erros = await erros422(res);
  expect(erros, `${descricao}: ${JSON.stringify(erros)}`).toHaveProperty(chave);
  for (const m of erros[chave]) expect(m, descricao).toMatch(/^[A-Z].*\.$/s);
}

test.describe('M1: validação', () => {
  test('signature_reason que não é texto, vazio ou com mais de 200 caracteres → 422 em signature_reason; 200 é aceito', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const valor of [42, true, ['signature mismatch'], { reason: 'x' }, '', 'a'.repeat(201)]) {
      await expect422(request, t, { signature_reason: valor }, 'signature_reason');
    }
    expect((await buscar(request, t, { signature_reason: 'a'.repeat(200) })).total).toBe(0);
  });

  test('schema_path que não é texto, não é JSON Pointer ou tem mais de 1000 caracteres → 422 em schema_path', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const valor of [7, false, ['/id'], { path: '/id' }, 'id', '$.valor', '$', 'valor/x', '/a~2', '/a~', `/${'a'.repeat(1000)}`]) {
      await expect422(request, t, { schema_path: valor }, 'schema_path');
    }
    for (const valor of ['', '/', '/a~0b~1c', `/${'a'.repeat(998)}`]) {
      expect((await buscar(request, t, { schema_path: valor })).total, JSON.stringify(valor).slice(0, 40)).toBe(0);
    }
  });

  test('um 422 não mexe nas mensagens', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { msg } = await enviarEGuardar(request, t, '/a', { method: 'POST' });
    await expect422(request, t, { schema_path: '$.valor' }, 'schema_path');
    expect((await listar(request, t)).data.map((m) => m.uuid)).toEqual([msg.uuid]);
  });
});
