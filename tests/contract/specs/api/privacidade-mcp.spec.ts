import type { Mensagem, Token } from '../../support/contrato.js';
import { MODO_MCP } from '../../support/ia.js';
import { FERRAMENTAS, jsonDo, textoDo, test as testMcp } from '../../support/mcp.js';
import { ALVO_BLOQUEADO, capturar, comSegredo, expect, fixtureUrls, http, novoSegredo, type Urls } from '../../support/privacidade.js';

// CA-5 do item 12, parte do MCP (§1 do plano "privacidade"): as ferramentas ganham o argumento opcional
// `read_secret`; numa URL protegida, sem ele (ou com ele errado) a ferramenta devolve erro de ferramenta legível
// (`isError`, com o texto do 401: "This URL is protected"); com ele, opera como numa URL aberta. O segredo não
// aparece em resultado nenhum.

const test = testMcp.extend<{ urls: Urls }>({ urls: fixtureUrls });

/** As ferramentas que recebem o UUID da URL (todas menos `create_url`). */
const DA_URL = FERRAMENTAS.filter((f) => f !== 'create_url');

/** Argumentos válidos de cada ferramenta, fora o UUID e o `read_secret`. */
function argumentos(rid: string): Record<string, Record<string, unknown>> {
  return {
    get_url: {},
    update_url: { default_status: 299 },
    delete_url: {},
    list_requests: {},
    search_requests: { text: 'corpo' },
    get_request: { request_id: rid },
    wait_for_request: { timeout: 0 },
    get_rules: {},
    set_rules: { rules: [{ name: 'intrusa' }] },
    test_rule: { rule: { name: 'teste' } },
    replay_request: { request_id: rid, url: ALVO_BLOQUEADO },
    send_request: { url: ALVO_BLOQUEADO, method: 'POST' },
    get_outbound: {},
  };
}

/** O argumento do id da mensagem, pelo schema da ferramenta (a §1 do plano "ia-local" não fixa o nome). */
function comIdDaMensagem(schema: Record<string, unknown>, args: Record<string, unknown>): Record<string, unknown> {
  if (!('request_id' in args)) return args;
  const props = Object.keys(schema);
  const nome = ['request_id', 'requestId', 'rid', 'request'].find((n) => props.includes(n)) ?? 'request_id';
  const { request_id: rid, ...resto } = args;
  return { ...resto, [nome]: rid };
}

test.describe('MCP com read_secret (CA-5)', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('toda ferramenta da URL declara read_secret (string, opcional)', async ({ mcp }) => {
    for (const nome of DA_URL) {
      const f = mcp.ferramentas.get(nome)!;
      const props = (f.inputSchema.properties ?? {}) as Record<string, { type?: string | string[] }>;
      expect(props, `${nome}: ${JSON.stringify(f.inputSchema)}`).toHaveProperty('read_secret');
      expect([props['read_secret'].type].flat(), `tipo de read_secret em ${nome}`).toContain('string');
      expect(f.inputSchema.required ?? [], `read_secret opcional em ${nome}`).not.toContain('read_secret');
    }
  });

  test('URL protegida sem read_secret ou com ele errado: erro de ferramenta legível em toda ferramenta, e nada muda', async ({ mcp, urls }) => {
    const url = await urls.proteger();
    const rid = await capturar(url.uuid);
    const args = argumentos(rid);
    for (const [caso, extra] of [['sem read_secret', {}], ['read_secret errado', { read_secret: novoSegredo() }]] as const) {
      for (const nome of DA_URL) {
        const f = mcp.ferramentas.get(nome)!;
        const r = await mcp.chamar(nome, { ...comIdDaMensagem(f.inputSchema.properties ?? {}, args[nome]), ...extra }, url.uuid);
        expect(r.isError, `${nome} ${caso}: ${textoDo(r).slice(0, 300)}`).toBe(true);
        expect(textoDo(r), `${nome} ${caso}`).toMatch(/protected/i);
        expect(textoDo(r)).not.toContain(url.segredo);
      }
    }
    // Nada mudou: a URL existe, com o mesmo status, sem regras, sem saídas e com a mensagem.
    const h = comSegredo(url.segredo);
    const token = await http('GET', `/token/${url.uuid}`, { headers: h });
    expect(token.status).toBe(200);
    expect(token.json<Token>().default_status).toBe(url.token.default_status);
    expect((await http('GET', `/token/${url.uuid}/rules`, { headers: h })).json()).toEqual([]);
    expect((await http('GET', `/token/${url.uuid}/outbound`, { headers: h })).json()).toEqual([]);
    expect((await http('GET', `/token/${url.uuid}/request/${rid}`, { headers: h })).status).toBe(200);
  });

  test('com read_secret certo: as ferramentas operam a URL protegida e o segredo não aparece', async ({ mcp, urls }) => {
    const url = await urls.proteger();
    const rid = await capturar(url.uuid, '/mcp', { body: 'corpo do mcp' });
    const args = argumentos(rid);
    const ordem = DA_URL.filter((n) => n !== 'delete_url' && n !== 'update_url');
    const resultados: Record<string, string> = {};
    let lida: Token | undefined;
    for (const nome of ordem) {
      const f = mcp.ferramentas.get(nome)!;
      const r = await mcp.chamar(nome, { ...comIdDaMensagem(f.inputSchema.properties ?? {}, args[nome]), read_secret: url.segredo }, url.uuid);
      expect(r.isError ?? false, `${nome} com read_secret: ${textoDo(r).slice(0, 300)}`).toBe(false);
      resultados[nome] = textoDo(r);
      if (nome === 'get_url') lida = jsonDo<Token>(r);
      expect(JSON.stringify(r), `${nome} sem o segredo no resultado`).not.toContain(url.segredo);
    }
    expect(lida?.protected, resultados['get_url']).toBe(true);
    expect(resultados['list_requests']).toContain(rid);
    expect(resultados['get_request']).toContain(rid);
    expect(resultados['search_requests']).toContain(rid);
    expect(resultados['wait_for_request']).toContain(rid);

    // set_rules gravou de verdade (conferido pela API, com o header).
    const regras = await http('GET', `/token/${url.uuid}/rules`, { headers: comSegredo(url.segredo) });
    expect(regras.json<Array<{ name: string }>>().map((r) => r.name)).toEqual(['intrusa']);
    const mensagens = await http('GET', `/token/${url.uuid}/requests`, { headers: comSegredo(url.segredo) });
    expect(mensagens.json<{ data: Mensagem[] }>().data.map((m) => m.uuid)).toEqual([rid]);

    const apagada = await mcp.chamar('delete_url', { read_secret: url.segredo }, url.uuid);
    expect(apagada.isError ?? false, textoDo(apagada)).toBe(false);
    expect((await http('GET', `/token/${url.uuid}`, { headers: comSegredo(url.segredo) })).status).toBe(410);
  });
});
