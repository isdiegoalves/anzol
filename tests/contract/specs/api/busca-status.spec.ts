import type { APIRequestContext } from '@playwright/test';
import { enviarEGuardar, expect, expectContentType, httpCru, listar, test, type Mensagem } from '../../support/contrato.js';
import { buscar, chamarBusca, metaEsperada, type PedidoDeBusca } from '../../support/busca.js';
import { erros422, salvarRegras, type RegraSalva } from '../../support/regras.js';

// v0.6.0: a busca aceita, no topo do corpo e fora de `match`, `answered`: lista de famílias (`"1xx"` a `"5xx"`) e de
// status exatos (`"404"`), sempre como texto. Casa a mensagem cujo `response.status` é de alguma família ou igual a
// algum status da lista (os itens combinam em OU), em E com `text`, `match` e `outcome`. Mensagem sem status gravado
// (regra com falha de rede: `response.fault`) não casa nenhum item. Ausente, `null` ou lista vazia = sem filtro: a
// busca responde como antes do campo. 422 em `answered` (não é lista) e em `answered.<índice>` (item que não é
// família nem status).
//
// Formato antigo: mensagem gravada antes de `response` não casa nenhum item e não derruba a busca. O contrato não
// escreve no Redis, então essa leitura fica com os testes do backend (como em `regras-resposta-gravada.spec.ts`).

const FORMA_LARAVEL = /^[A-Z].*\.$/s;
const TODAS_AS_FAMILIAS = ['1xx', '2xx', '3xx', '4xx', '5xx'];

interface Cenario {
  criado: RegraSalva;
  /** GET /a → 200, a resposta padrão da URL. */
  ok: Mensagem;
  /** POST /pedidos com `X-Marca: alfa` → 201, pela regra Criado. */
  criada: Mensagem;
  /** GET /404 → 404, pelo caminho. */
  ausente: Mensagem;
  /** GET /429 → 429. */
  limite: Mensagem;
  /** POST /500 com `X-Marca: alfa` → 500. */
  erro: Mensagem;
  /** GET /503 → 503. */
  fora: Mensagem;
  /** POST /falha → a regra Cai derruba a conexão: `response.fault`, sem status. */
  derrubada: Mensagem;
}

async function montar(request: APIRequestContext, t: string): Promise<Cenario> {
  const marca = { 'X-Marca': 'alfa' };
  const [criado] = await salvarRegras(request, t, [
    { name: 'Criado', match: { method: ['POST'], path: { equals: '/pedidos' } }, response: { status: 201 } },
    { name: 'Cai', match: { path: { equals: '/falha' } }, response: { fault: 'empty_response' } },
  ]);
  const { msg: ok } = await enviarEGuardar(request, t, '/a');
  const { msg: criada } = await enviarEGuardar(request, t, '/pedidos', { method: 'POST', headers: marca });
  const { msg: ausente } = await enviarEGuardar(request, t, '/404');
  const { msg: limite } = await enviarEGuardar(request, t, '/429');
  const { msg: erro } = await enviarEGuardar(request, t, '/500', { method: 'POST', headers: marca });
  const { msg: fora } = await enviarEGuardar(request, t, '/503');
  await httpCru([`POST /${t}/falha HTTP/1.1`, 'Content-Length: 0']).catch(() => undefined);
  const { data, total } = await listar(request, t, 'sorting=newest');
  expect(total, 'a mensagem da conexão derrubada foi gravada').toBe(7);
  const derrubada = data[0];

  // O cenário é o que o teste supõe: confere o que a captura gravou.
  expect(ok.response).toEqual({ status: 200 });
  expect(criada.response).toEqual({ status: 201 });
  expect(criada.rule?.id).toBe(criado.id);
  expect(ausente.response).toEqual({ status: 404 });
  expect(limite.response).toEqual({ status: 429 });
  expect(erro.response).toEqual({ status: 500 });
  expect(fora.response).toEqual({ status: 503 });
  expect(derrubada.response).toEqual({ fault: 'empty_response' });
  return { criado, ok, criada, ausente, limite, erro, fora, derrubada };
}

async function expectBusca(request: APIRequestContext, t: string, pedido: PedidoDeBusca, esperadas: Mensagem[]): Promise<void> {
  const completo: PedidoDeBusca = { sorting: 'oldest', ...pedido };
  const pagina = await buscar(request, t, completo);
  const descricao = JSON.stringify(pedido);
  expect(pagina.data.map((m) => m.uuid), descricao).toEqual(esperadas.map((m) => m.uuid));
  expect(pagina.total, descricao).toBe(esperadas.length);
}

test.describe('Busca pelo status respondido', () => {
  test('família: as mensagens respondidas com um status dela', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    await expectBusca(request, t, { answered: ['2xx'] }, [c.ok, c.criada]);
    await expectBusca(request, t, { answered: ['4xx'] }, [c.ausente, c.limite]);
    await expectBusca(request, t, { answered: ['5xx'] }, [c.erro, c.fora]);
    await expectBusca(request, t, { answered: ['1xx'] }, []);
    await expectBusca(request, t, { answered: ['3xx'] }, []);
  });

  test('status exato: só as respondidas com ele', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    await expectBusca(request, t, { answered: ['200'] }, [c.ok]);
    await expectBusca(request, t, { answered: ['201'] }, [c.criada]);
    await expectBusca(request, t, { answered: ['404'] }, [c.ausente]);
    await expectBusca(request, t, { answered: ['503'] }, [c.fora]);
    for (const status of ['100', '302', '400', '504', '599']) {
      await expectBusca(request, t, { answered: [status] }, []);
    }
  });

  test('os itens da lista combinam em OU: família com status, e item repetido não duplica', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    await expectBusca(request, t, { answered: ['4xx', '503'] }, [c.ausente, c.limite, c.fora]);
    await expectBusca(request, t, { answered: ['200', '201', '5xx'] }, [c.ok, c.criada, c.erro, c.fora]);
    await expectBusca(request, t, { answered: ['5xx', '503', '5xx'] }, [c.erro, c.fora]);
    await expectBusca(request, t, { answered: ['404', '3xx'] }, [c.ausente]);
  });

  test('conexão derrubada pela regra (response.fault, sem status) não casa nenhuma família', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    await expectBusca(request, t, { answered: TODAS_AS_FAMILIAS }, [c.ok, c.criada, c.ausente, c.limite, c.erro, c.fora]);
    await expectBusca(request, t, { answered: TODAS_AS_FAMILIAS, match: { path: { equals: '/falha' } } }, []);
  });

  test('combina em E com match, text e outcome', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    await expectBusca(request, t, { answered: ['2xx'], match: { method: ['POST'] } }, [c.criada]);
    await expectBusca(request, t, { answered: ['4xx'], match: { method: ['POST'] } }, []);
    await expectBusca(request, t, { answered: ['5xx'], text: 'alfa' }, [c.erro]);
    await expectBusca(request, t, { answered: ['2xx', '5xx'], text: 'alfa' }, [c.criada, c.erro]);
    await expectBusca(request, t, { answered: ['2xx'], outcome: { type: 'rule', rule: c.criado.id } }, [c.criada]);
    await expectBusca(request, t, { answered: ['2xx'], outcome: { type: 'default' } }, [c.ok]);
    await expectBusca(request, t, { answered: ['5xx'], outcome: { type: 'rule', rule: c.criado.id } }, []);
  });

  test('paginação e ordenação valem sobre o filtrado: total é o das que casam', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    const oldest = [c.ausente, c.limite, c.erro, c.fora];
    for (const [sorting, ordem] of [['oldest', oldest], ['newest', [...oldest].reverse()]] as const) {
      for (let page = 1; page <= 5; page++) {
        const pedido: PedidoDeBusca = { answered: ['4xx', '5xx'], sorting, page, per_page: 1 };
        const { data, ...meta } = await buscar(request, t, pedido);
        expect(meta, `${sorting} página ${page}`).toEqual(metaEsperada(4, page, 1));
        expect(data.map((m) => m.uuid), `${sorting} página ${page}`).toEqual(ordem.slice(page - 1, page).map((m) => m.uuid));
      }
    }
  });

  test('sem answered, com null ou com lista vazia: a busca não filtra por status e responde como a listagem', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    const todas = [c.ok, c.criada, c.ausente, c.limite, c.erro, c.fora, c.derrubada];
    const listagem = await listar(request, t, 'sorting=oldest');
    for (const pedido of [{}, { answered: null }, { answered: [] }] as PedidoDeBusca[]) {
      await expectBusca(request, t, pedido, todas);
      await expectBusca(request, t, { ...pedido, match: { method: ['POST'] } }, [c.criada, c.erro, c.derrubada]);
      const completo: PedidoDeBusca = { sorting: 'oldest', ...pedido };
      expect(await buscar(request, t, completo), JSON.stringify(pedido)).toEqual(listagem);
    }
  });
});

async function expect422(request: APIRequestContext, t: string, corpo: Record<string, unknown>, chaves: string[]): Promise<void> {
  const res = await chamarBusca(request, t, corpo);
  const descricao = JSON.stringify(corpo);
  expect(res.status(), `${descricao}: ${(await res.text()).slice(0, 300)}`).toBe(422);
  expectContentType(res, 'application/json');
  const erros = await erros422(res);
  expect(Object.keys(erros).sort(), `${descricao}: ${JSON.stringify(erros)}`).toEqual(chaves);
  for (const k of chaves) {
    expect(Array.isArray(erros[k]) && erros[k].length > 0, `${descricao}: ${k}`).toBe(true);
    for (const msg of erros[k]) expect(msg, `${descricao}: ${k}`).toMatch(FORMA_LARAVEL);
  }
}

test.describe('Validação do answered', () => {
  test('answered que não é lista → 422 em answered', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const answered of ['5xx', '404', 503, true, {}, { 0: '5xx' }]) {
      await expect422(request, t, { answered }, ['answered']);
    }
  });

  test('item que não é família nem status, ou que não é texto → 422 em answered.<índice>', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const itens = [
      '6xx', '0xx', 'xx', '5x', '5xxx', '5XX', '5Xx', '99', '099', '600', '1000', '4x4', '', ' 404', '404 ', '４０４', '2xx,5xx',
      404, 5, true, null, ['5xx'], { status: 404 },
    ];
    for (const item of itens) {
      await expect422(request, t, { answered: [item] }, ['answered.0']);
    }
  });

  test('a chave leva o índice do item recusado; os itens válidos da mesma lista não aparecem', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await expect422(request, t, { answered: ['2xx', '6xx'] }, ['answered.1']);
    await expect422(request, t, { answered: ['x', '404', 'y', '5xx'] }, ['answered.0', 'answered.2']);
  });

  test('um 422 do answered não mexe nas mensagens; a mesma busca válida responde 200', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { msg } = await enviarEGuardar(request, t, '/a');
    await expect422(request, t, { answered: ['6xx'] }, ['answered.0']);
    expect((await listar(request, t)).data.map((m) => m.uuid)).toEqual([msg.uuid]);
    await expectBusca(request, t, { answered: ['2xx'] }, [msg]);
  });
});
