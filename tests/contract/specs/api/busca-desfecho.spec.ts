import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { enviarEGuardar, expect, expectContentType, listar, test, type Mensagem } from '../../support/contrato.js';
import { buscar, chamarBusca, metaEsperada, type PedidoDeBusca } from '../../support/busca.js';
import { erros422, salvarRegras, type RegraSalva } from '../../support/regras.js';

// UX de Regras, C2 (WM-27, `.docs-arquivo/regras-ux/api-contrato.md`): `POST /token/{id}/requests/search` aceita
// `outcome`, campo de topo fora de `match`: `{type: "rule", rule}` → mensagens com `rule.id` igual; `{type:
// "near_miss", rule}` → com `near_miss.id` igual; `{type: "default"}` → sem `rule` (resposta padrão, com ou sem near
// miss). Combina em E com `match` e `text`. 422 com chave em pontos para `outcome.type` ausente ou desconhecido e
// `outcome.rule` ausente, não-UUID ou presente com `default`. Sem `outcome`, a busca responde como hoje.

const FORMA_LARAVEL = /^[A-Z].*\.$/s;

interface Cenario {
  pix: RegraSalva;
  boleto: RegraSalva;
  /** GET /antes, gravada antes das regras: sem rule e sem near miss. */
  semRegras: Mensagem;
  /** POST /pix com `X-Marca: alfa` → respondida por Pix. */
  pix1: Mensagem;
  /** POST /boleto → respondida por Boleto. */
  boleto1: Mensagem;
  /** GET /pix com `X-Marca: alfa` → nenhuma casa; near miss Pix (só o método falha). */
  quasePix: Mensagem;
  /** GET /boleto → near miss Boleto. */
  quaseBoleto: Mensagem;
  /** POST /pix → Pix de novo. */
  pix2: Mensagem;
}

async function montar(request: APIRequestContext, t: string): Promise<Cenario> {
  const marca = { 'X-Marca': 'alfa' };
  const { msg: semRegras } = await enviarEGuardar(request, t, '/antes');
  const [pix, boleto] = await salvarRegras(request, t, [
    { name: 'Pix', match: { method: ['POST'], path: { equals: '/pix' } }, response: { status: 201 } },
    { name: 'Boleto', match: { method: ['POST'], path: { equals: '/boleto' } }, response: { status: 202 } },
  ]);
  const { msg: pix1 } = await enviarEGuardar(request, t, '/pix', { method: 'POST', headers: marca });
  const { msg: boleto1 } = await enviarEGuardar(request, t, '/boleto', { method: 'POST' });
  const { msg: quasePix } = await enviarEGuardar(request, t, '/pix', { method: 'GET', headers: marca });
  const { msg: quaseBoleto } = await enviarEGuardar(request, t, '/boleto', { method: 'GET' });
  const { msg: pix2 } = await enviarEGuardar(request, t, '/pix', { method: 'POST' });

  // O cenário é o que o teste supõe: confere o que a captura gravou.
  expect(semRegras.rule).toBeNull();
  expect(semRegras.near_miss).toBeNull();
  expect(pix1.rule?.id).toBe(pix.id);
  expect(pix2.rule?.id).toBe(pix.id);
  expect(boleto1.rule?.id).toBe(boleto.id);
  expect(quasePix.rule).toBeNull();
  expect(quasePix.near_miss?.id).toBe(pix.id);
  expect(quaseBoleto.rule).toBeNull();
  expect(quaseBoleto.near_miss?.id).toBe(boleto.id);
  return { pix, boleto, semRegras, pix1, boleto1, quasePix, quaseBoleto, pix2 };
}

async function expectBusca(request: APIRequestContext, t: string, pedido: PedidoDeBusca, esperadas: Mensagem[]): Promise<void> {
  const pagina = await buscar(request, t, { sorting: 'oldest', ...pedido });
  const descricao = JSON.stringify(pedido);
  expect(pagina.data.map((m) => m.uuid), descricao).toEqual(esperadas.map((m) => m.uuid));
  expect(pagina.total, descricao).toBe(esperadas.length);
}

test.describe('C2: busca por outcome', () => {
  test('rule: as mensagens que a regra respondeu; id que nenhuma cita → página vazia', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    await expectBusca(request, t, { outcome: { type: 'rule', rule: c.pix.id } }, [c.pix1, c.pix2]);
    await expectBusca(request, t, { outcome: { type: 'rule', rule: c.boleto.id } }, [c.boleto1]);
    await expectBusca(request, t, { outcome: { type: 'rule', rule: randomUUID() } }, []);
  });

  test('near_miss: as mensagens em que a regra foi o near miss', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    await expectBusca(request, t, { outcome: { type: 'near_miss', rule: c.pix.id } }, [c.quasePix]);
    await expectBusca(request, t, { outcome: { type: 'near_miss', rule: c.boleto.id } }, [c.quaseBoleto]);
    await expectBusca(request, t, { outcome: { type: 'near_miss', rule: randomUUID() } }, []);
  });

  test('default: as sem rule, com e sem near miss', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    await expectBusca(request, t, { outcome: { type: 'default' } }, [c.semRegras, c.quasePix, c.quaseBoleto]);
  });

  test('combina em E com match e com text', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    await expectBusca(request, t, { outcome: { type: 'default' }, match: { path: { equals: '/pix' } } }, [c.quasePix]);
    await expectBusca(request, t, { outcome: { type: 'rule', rule: c.pix.id }, match: { method: ['GET'] } }, []);
    await expectBusca(request, t, { outcome: { type: 'rule', rule: c.pix.id }, text: 'alfa' }, [c.pix1]);
    await expectBusca(request, t, { outcome: { type: 'default' }, text: 'alfa' }, [c.quasePix]);
    await expectBusca(request, t, { outcome: { type: 'near_miss', rule: c.boleto.id }, text: 'alfa' }, []);
  });

  test('paginação e ordenação valem sobre o filtrado: total é o das que casam', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    const outcome = { type: 'default' } as const;
    const oldest = [c.semRegras, c.quasePix, c.quaseBoleto];
    for (const [sorting, ordem] of [['oldest', oldest], ['newest', [...oldest].reverse()]] as const) {
      for (let page = 1; page <= 4; page++) {
        const pagina = await buscar(request, t, { outcome, sorting, page, per_page: 1 });
        const { data, ...meta } = pagina;
        expect(meta, `${sorting} página ${page}`).toEqual(metaEsperada(3, page, 1));
        expect(data.map((m) => m.uuid), `${sorting} página ${page}`).toEqual(ordem.slice(page - 1, page).map((m) => m.uuid));
      }
    }
  });

  test('regra apagada da lista: outcome rule e near_miss ainda acham as mensagens gravadas com o id dela', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    await salvarRegras(request, t, []);
    await expectBusca(request, t, { outcome: { type: 'rule', rule: c.pix.id } }, [c.pix1, c.pix2]);
    await expectBusca(request, t, { outcome: { type: 'near_miss', rule: c.pix.id } }, [c.quasePix]);
  });

  test('sem outcome: a busca não filtra por desfecho, e os itens são as mensagens como na listagem', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const c = await montar(request, t);
    const todas = [c.semRegras, c.pix1, c.boleto1, c.quasePix, c.quaseBoleto, c.pix2];
    await expectBusca(request, t, {}, todas);
    await expectBusca(request, t, { match: { method: ['GET'] } }, [c.semRegras, c.quasePix, c.quaseBoleto]);
    const pagina = await buscar(request, t, { sorting: 'oldest' });
    expect(pagina).toEqual(await listar(request, t, 'sorting=oldest'));
  });
});

async function expect422(request: APIRequestContext, t: string, corpo: Record<string, unknown>, chave: RegExp): Promise<void> {
  const res = await chamarBusca(request, t, corpo);
  const descricao = JSON.stringify(corpo);
  expect(res.status(), `${descricao}: ${(await res.text()).slice(0, 300)}`).toBe(422);
  expectContentType(res, 'application/json');
  const erros = await erros422(res);
  const chaves = Object.keys(erros);
  expect(chaves.some((k) => chave.test(k)), `${descricao}: nenhuma chave de ${JSON.stringify(erros)} casa ${chave}`).toBe(true);
  for (const k of chaves) {
    expect(Array.isArray(erros[k]) && erros[k].length > 0, `${descricao}: ${k}`).toBe(true);
    for (const msg of erros[k]) expect(msg, `${descricao}: ${k}`).toMatch(FORMA_LARAVEL);
  }
}

test.describe('C2: validação do outcome', () => {
  test('outcome.type ausente ou desconhecido → 422 em outcome.type', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    // SUPOSIÇÃO: o tipo é comparado com caixa (`RULE` é desconhecido) e `type: null` vale como ausente.
    for (const outcome of [{}, { rule: randomUUID() }, { type: 'talvez' }, { type: 'RULE', rule: randomUUID() }, { type: 5 }, { type: null }]) {
      await expect422(request, t, { outcome }, /^outcome\.type$/);
    }
  });

  test('outcome.rule ausente ou que não é UUID, com rule ou near_miss → 422 em outcome.rule', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const type of ['rule', 'near_miss']) {
      for (const rule of [undefined, '', 'abc', '1234', 42, true, `${randomUUID()}x`]) {
        const outcome = rule === undefined ? { type } : { type, rule };
        await expect422(request, t, { outcome }, /^outcome\.rule$/);
      }
    }
  });

  test('outcome.rule presente com default → 422 em outcome.rule', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await expect422(request, t, { outcome: { type: 'default', rule: randomUUID() } }, /^outcome\.rule$/);
  });

  test('outcome que não é objeto → 422 numa chave outcome', async ({ request, tokens }) => {
    // SUPOSIÇÃO: o api-contrato não lista este caso; a leitura conservadora é recusar (422) com uma chave que
    // comece por `outcome`, como `match` texto ou número dá 422 em `match`.
    const t = (await tokens.criar()).uuid;
    for (const outcome of ['rule', 42, ['default']]) {
      await expect422(request, t, { outcome }, /^outcome(\.|$)/);
    }
  });

  test('um 422 do outcome não mexe nas mensagens; a mesma busca válida responde 200', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { msg } = await enviarEGuardar(request, t, '/a');
    await expect422(request, t, { outcome: { type: 'talvez' } }, /^outcome\.type$/);
    expect((await listar(request, t)).data.map((m) => m.uuid)).toEqual([msg.uuid]);
    expect((await buscar(request, t, { outcome: { type: 'default' } })).data.map((m) => m.uuid)).toEqual([msg.uuid]);
  });
});
