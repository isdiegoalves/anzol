import { randomUUID } from 'node:crypto';
import type { Listagem } from '../../support/contrato.js';
import { envelope, parEc, politica, selar } from '../../support/e2ee.js';
import { MODO_MCP } from '../../support/ia.js';
import { test as testMcp } from '../../support/mcp.js';
import { capturar, comSegredo, expect, expect401Protegida, fixtureUrls, http, type Urls } from '../../support/privacidade.js';

// A busca por texto também procura no valor decifrado (`decrypted`), em qualquer nível (nomes e valores do JSON),
// sem diferenciar maiúsculas, mas só na API REST e na tela, que já exigem o acesso de leitura da URL (segredo ou
// cookie). O `search_requests` do MCP não procura nele: o agente nunca vê o valor, e uma busca que achasse por ele
// diria, mensagem a mensagem, se um texto está lá dentro.

const test = testMcp.extend<{ urls: Urls }>({ urls: fixtureUrls });

const VALOR = 'Cartao-Final-4242-XQ';

async function urlComDecifrada(urls: Urls) {
  const remetente = await parEc('remetente-sig-1');
  const { uuid, segredo } = await urls.proteger({ e2ee: politica([remetente.publica]) });
  const chave = (await http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: { kid: 'enc-v1' } }))
    .json<{ jwk: Record<string, unknown> }>().jwk;
  const id = randomUUID();
  const corpo = JSON.stringify(envelope(id, await selar(remetente, chave, id, { pagamento: { nota: VALOR }, NomeDoCampo: 1 })));
  const decifrada = await capturar(uuid, '', { body: corpo, headers: { 'Content-Type': 'application/json' } });
  const outra = await capturar(uuid, '', { body: JSON.stringify({ sem: 'cifra' }), headers: { 'Content-Type': 'application/json' } });
  return { uuid, segredo, decifrada, outra };
}

const buscar = (uuid: string, corpo: unknown, headers: Record<string, string> = {}) =>
  http('POST', `/token/${uuid}/requests/search`, { headers, corpo });

test('REST com o segredo: acha pelo valor e pelo nome de campo decifrados, sem diferenciar maiúsculas', async ({ urls }) => {
  const { uuid, segredo, decifrada } = await urlComDecifrada(urls);

  for (const text of [VALOR, VALOR.toLowerCase(), 'final-4242', 'nomedocampo']) {
    const res = await buscar(uuid, { text }, comSegredo(segredo));
    expect(res.status, res.texto.slice(0, 300)).toBe(200);
    const pagina = res.json<Listagem>();
    expect(pagina.total, `text=${text}`).toBe(1);
    expect(pagina.data[0].uuid).toBe(decifrada);
  }
  expect((await buscar(uuid, { text: 'Cartao-Final-9999' }, comSegredo(segredo))).json<Listagem>().total).toBe(0);
});

test('REST sem acesso: 401, como toda busca numa URL protegida', async ({ urls }) => {
  const { uuid, segredo } = await urlComDecifrada(urls);

  expect401Protegida(await buscar(uuid, { text: VALOR }), 'busca sem segredo');
  expect401Protegida(await buscar(uuid, { text: VALOR }, comSegredo(`${segredo}x`)), 'busca com o segredo errado');
});

test('MCP search_requests, mesmo com o read_secret: não acha pelo valor decifrado, acha pelo corpo como chegou', async ({ mcp, urls }) => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);
  const { uuid, segredo, decifrada } = await urlComDecifrada(urls);

  const pelaCifra = await mcp.chamarOk<Listagem>('search_requests', { read_secret: segredo, text: VALOR }, uuid);
  const peloEnvelope = await mcp.chamarOk<Listagem>('search_requests', { read_secret: segredo, text: 'SERVICO-EXEMPLO' }, uuid);

  expect(pelaCifra.total).toBe(0);
  expect(peloEnvelope.total).toBe(1);
  expect(peloEnvelope.data[0].uuid).toBe(decifrada);
  expect(JSON.stringify(peloEnvelope)).not.toContain(VALOR);
});

test('MCP search_requests: a descrição diz que não procura no valor decifrado', async ({ mcp }) => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  expect(mcp.ferramentas.get('search_requests')?.description ?? '').toMatch(/never (in|searches) the decrypted/i);
});
