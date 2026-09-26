import type { APIRequestContext, APIResponse } from '@playwright/test';
import { UUID, buscarMensagem, expect, test } from '../../support/contrato.js';
import { erros422, lerRegras, putRegras, salvarRegras, type RespostaRegra } from '../../support/regras.js';

// Templating da resposta (CA-5, fatia 03, Anexo B): com `response.template: true`, o corpo e os
// valores de cabeçalho da regra são Handlebars, sem escape HTML, com contexto só da requisição
// (`request.method|path|url|query.<nome>|headers.<nome em minúsculas>|body`, `seq`) e os helpers
// `jsonPath`, `now`, `randomValue` e `math`. Sem `template` (padrão false) o texto sai literal,
// `{{…}}` incluído. Cada teste confere as duas coisas: um servidor que ignorasse o template não
// passa, e um que templatasse sempre também não.

interface Pedido {
  caminho?: string;
  method?: string;
  headers?: Record<string, string>;
  corpo?: string;
}

const JSON_POST = (corpo: string): Pedido => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, corpo });

/** Salva uma regra que casa tudo com a resposta dada e dispara um pedido. */
async function responder(
  request: APIRequestContext,
  tokenId: string,
  resposta: RespostaRegra,
  pedido: Pedido = {},
): Promise<{ res: APIResponse; corpo: string }> {
  await salvarRegras(request, tokenId, [{ name: 'template', response: { status: 200, ...resposta } }]);
  const res = await request.fetch(`/${tokenId}${pedido.caminho ?? ''}`, {
    method: pedido.method ?? 'GET',
    headers: pedido.headers,
    data: pedido.corpo === undefined ? undefined : Buffer.from(pedido.corpo),
  });
  expect(res.status(), (await res.text()).slice(0, 300)).toBe(200);
  return { res, corpo: await res.text() };
}

/** Com `template: true` o corpo sai renderizado; com `template: false`, exatamente o texto da regra. */
async function renderizar(request: APIRequestContext, tokenId: string, body: string, pedido: Pedido = {}): Promise<string> {
  const literal = await responder(request, tokenId, { body, template: false }, pedido);
  expect(literal.corpo, 'sem template o texto sai literal').toBe(body);
  return (await responder(request, tokenId, { body, template: true }, pedido)).corpo;
}

test.describe('template: contexto da requisição', () => {
  test('request.method', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(await renderizar(request, token.uuid, 'método={{request.method}}', { method: 'PATCH' })).toBe('método=PATCH');
  });

  test('request.path: o caminho depois do token, sem a query', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(await renderizar(request, token.uuid, '[{{request.path}}]', { caminho: '/pagamentos/42?tipo=pix' })).toBe('[/pagamentos/42]');
  });

  test('request.url: a mesma url gravada na mensagem', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await renderizar(request, token.uuid, '{{request.url}}', { caminho: '/pagamentos/42?tipo=pix' });
    const res = await request.get(`/${token.uuid}/pagamentos/42?tipo=pix`);
    const msg = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
    expect(msg.url).toMatch(new RegExp(`/${token.uuid}/pagamentos/42\\?tipo=pix$`));
    expect(await res.text()).toBe(msg.url);
  });

  test('request.query.<nome>; parâmetro ausente vira texto vazio', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(await renderizar(request, token.uuid, 'tipo={{request.query.tipo}};ausente=[{{request.query.nada}}]', { caminho: '?tipo=pix&lote=7' }))
      .toBe('tipo=pix;ausente=[]');
  });

  test('request.headers.<nome em minúsculas>', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(await renderizar(request, token.uuid, 'canal={{request.headers.x-canal}}', { headers: { 'X-Canal': 'web-7' } })).toBe('canal=web-7');
  });

  test('request.body: o corpo cru, sem escape HTML', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const corpo = '<a href="x?a=1&b=2">O\'Neil</a> {"k":[1,2]}';
    expect(await renderizar(request, token.uuid, 'eco:{{request.body}}', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, corpo }))
      .toBe(`eco:${corpo}`);
  });

  test('seq: o seq da mensagem gravada', async ({ request, tokens }) => {
    const token = await tokens.criar();
    // A versão literal já gravou uma mensagem; a renderizada é a segunda.
    expect((await responder(request, token.uuid, { body: 'seq={{seq}}', template: false })).corpo).toBe('seq={{seq}}');
    const { res, corpo } = await responder(request, token.uuid, { body: 'seq={{seq}}', template: true });
    const msg = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
    expect(corpo).toBe(`seq=${msg.seq}`);
  });
});

test.describe('template: helpers', () => {
  const PEDIDO = JSON_POST('{"id":"pg_1","valor":21,"cliente":{"id":7,"nome":"Ana"},"itens":[1,2,{"sku":"a"}]}');

  test('jsonPath: texto e número saem como valor', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(await renderizar(request, token.uuid, `{"pedido":"{{jsonPath request.body '$.id'}}","valor":{{jsonPath request.body '$.valor'}},"nome":"{{jsonPath request.body '$.cliente.nome'}}"}`, PEDIDO))
      .toBe('{"pedido":"pg_1","valor":21,"nome":"Ana"}');
  });

  test('jsonPath: objeto e lista saem como JSON', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const corpo = await renderizar(request, token.uuid, `{"cliente":{{jsonPath request.body '$.cliente'}},"itens":{{jsonPath request.body '$.itens'}}}`, PEDIDO);
    expect(JSON.parse(corpo)).toEqual({ cliente: { id: 7, nome: 'Ana' }, itens: [1, 2, { sku: 'a' }] });
  });

  test('now: ISO-8601 em UTC, perto da hora da resposta', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const corpo = await renderizar(request, token.uuid, '{{now}}');
    expect(corpo).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(Math.abs(Date.parse(corpo) - Date.now())).toBeLessThanOrEqual(15_000);
  });

  test("now format='yyyy-MM-dd': a data de hoje em UTC", async ({ request, tokens }) => {
    const token = await tokens.criar();
    const antes = new Date().toISOString().slice(0, 10);
    const corpo = await renderizar(request, token.uuid, "dia={{now format='yyyy-MM-dd'}}");
    const depois = new Date().toISOString().slice(0, 10);
    expect([`dia=${antes}`, `dia=${depois}`]).toContain(corpo);
  });

  test('randomValue: UUID, ALPHANUMERIC, NUMERIC e HEX com o tamanho pedido (padrão 16); cada chamada sorteia de novo', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const body = [
      "{{randomValue type='UUID'}}",
      "{{randomValue type='UUID'}}",
      "{{randomValue type='ALPHANUMERIC' length=12}}",
      "{{randomValue type='ALPHANUMERIC'}}",
      "{{randomValue type='NUMERIC' length=8}}",
      "{{randomValue type='HEX' length=10}}",
    ].join('|');
    const partes = (await renderizar(request, token.uuid, body)).split('|');
    expect(partes).toHaveLength(6);
    const [uuid1, uuid2, alfa12, alfa16, num8, hex10] = partes;
    expect(uuid1.toLowerCase()).toMatch(UUID);
    expect(uuid2.toLowerCase()).toMatch(UUID);
    expect(uuid1).not.toBe(uuid2);
    expect(alfa12).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(alfa16).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(num8).toMatch(/^[0-9]{8}$/);
    expect(hex10).toMatch(/^[0-9a-fA-F]{10}$/);
  });

  test('math: + - * com inteiros dão inteiros; / divide; aceita subexpressão com jsonPath', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const body = "{{math 7 '+' 5}}|{{math 7 '-' 5}}|{{math 7 '*' 5}}|{{math 12 '/' 4}}|{{math (jsonPath request.body '$.valor') '*' 2}}";
    const [soma, sub, mult, div, sub2] = (await renderizar(request, token.uuid, body, PEDIDO)).split('|');
    expect([soma, sub, mult]).toEqual(['12', '2', '35']);
    // Formato da divisão exata (3 ou 3.0) fica fora do contrato.
    expect(div).toMatch(/^3(\.0+)?$/);
    expect(sub2).toBe('42');
  });

  test('falha em tempo de execução vira texto vazio: jsonPath em corpo que não é JSON', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const corpo = await renderizar(request, token.uuid, "antes-{{jsonPath request.body '$.id'}}-depois", {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, corpo: 'isto não é json',
    });
    expect(corpo).toBe('antes--depois');
  });
});

test.describe('template: cabeçalhos da resposta', () => {
  test('valores de cabeçalho são templados junto com o corpo; sem template saem literais', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const headers = { 'X-Pedido': "{{jsonPath request.body '$.id'}}", 'X-Metodo': '{{request.method}}', 'Content-Type': 'application/json' };
    const pedido = JSON_POST('{"id":"pg_9"}');

    const literal = await responder(request, token.uuid, { headers, body: '{{request.method}}', template: false }, pedido);
    expect(literal.res.headers()['x-pedido']).toBe("{{jsonPath request.body '$.id'}}");
    expect(literal.res.headers()['x-metodo']).toBe('{{request.method}}');

    const templado = await responder(request, token.uuid, { headers, body: '{"ok":"{{request.method}}"}', template: true }, pedido);
    expect(templado.res.headers()['x-pedido']).toBe('pg_9');
    expect(templado.res.headers()['x-metodo']).toBe('POST');
    expect(templado.corpo).toBe('{"ok":"POST"}');
  });
});

test.describe('template: salvar', () => {
  test('template true vai e volta no PUT/GET', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regra = { name: 't', response: { status: 200, body: '{{request.method}}', template: true } };
    const [salva] = await salvarRegras(request, token.uuid, [regra]);
    expect(salva.response.template).toBe(true);
    expect(salva.response.body).toBe('{{request.method}}');
    expect(await lerRegras(request, token.uuid)).toEqual([salva]);
  });

  const INVALIDO = /^The template is invalid/;
  const casos: Array<[string, string]> = [
    ['bloco sem fechamento', '{{#if request.body}}sem fim'],
    ['chaves sem fechamento', "{{jsonPath request.body '$.id'"],
    ['helper desconhecido (arquivo)', "{{file '/etc/passwd'}}"],
    ['helper desconhecido (ambiente)', "{{env 'HOME'}}"],
  ];
  for (const [nome, body] of casos) {
    test(`${nome}: 422 em "0.response.body" com template true; aceito e literal com template false`, async ({ request, tokens }) => {
      const token = await tokens.criar();
      const corpo = await erros422(await putRegras(request, token.uuid, [{ name: 'x', response: { body, template: true } }]));
      expect(Object.keys(corpo), JSON.stringify(corpo)).toEqual(['0.response.body']);
      expect(corpo['0.response.body'].some((m) => INVALIDO.test(m)), JSON.stringify(corpo)).toBe(true);
      expect(await lerRegras(request, token.uuid)).toEqual([]);

      // Sem template o mesmo texto é só texto.
      expect((await responder(request, token.uuid, { body, template: false })).corpo).toBe(body);
    });
  }

  test('o índice da chave é o da regra; template inválido em cabeçalho também dá 422', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const ok = { name: 'ok', response: { body: '{{request.method}}', template: true } };
    const noCorpo = await erros422(await putRegras(request, token.uuid, [ok, { name: 'ruim', response: { body: '{{#each}}', template: true } }]));
    expect(Object.keys(noCorpo)).toEqual(['1.response.body']);

    // A chave exata do cabeçalho fica fora do contrato (o Anexo B só fixa a do corpo).
    const noCabecalho = await erros422(await putRegras(request, token.uuid, [{ name: 'h', response: { headers: { 'X-A': '{{#if}}' }, template: true } }]));
    expect(Object.keys(noCabecalho).every((k) => k.startsWith('0.response.headers')), JSON.stringify(noCabecalho)).toBe(true);
    expect(Object.values(noCabecalho).flat().some((m) => INVALIDO.test(m)), JSON.stringify(noCabecalho)).toBe(true);
  });
});
