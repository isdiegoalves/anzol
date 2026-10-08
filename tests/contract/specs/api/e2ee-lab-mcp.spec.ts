import type { Token } from '../../support/contrato.js';
import { parEc, politica } from '../../support/e2ee.js';
import { MODO_MCP } from '../../support/ia.js';
import { jsonDo, textoDo, test as testMcp } from '../../support/mcp.js';
import { comSegredo, expect, fixtureUrls, http, type Urls } from '../../support/privacidade.js';

// Laboratório E2EE pelo MCP: `create_e2ee_lab` (só cria URL nova), `list_e2ee_scenarios` e `run_e2ee_scenarios`
// (só numa URL de laboratório; o resultado nunca traz o texto aberto). O `create_url` e o `update_url` continuam
// ignorando `e2ee`: nenhuma ferramenta muda a política de uma URL que já existe.

const test = testMcp.extend<{ urls: Urls }>({ urls: fixtureUrls });

interface Laboratorio {
  token: Token;
  read_secret: string;
}

test.describe('laboratório E2EE pelo MCP', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('as três ferramentas existem, com descrição e schema de objeto', async ({ mcp }) => {
    for (const nome of ['create_e2ee_lab', 'list_e2ee_scenarios', 'run_e2ee_scenarios']) {
      const f = mcp.ferramentas.get(nome);
      expect(f, nome).toBeDefined();
      expect((f!.description ?? '').trim().length, nome).toBeGreaterThan(0);
      expect(f!.inputSchema.type).toBe('object');
    }
  });

  test('criar e rodar: os 27 conferem e nada aberto no resultado; numa URL comum, erro 422', async ({ mcp, urls }) => {
    const lab = await mcp.chamarOk<Laboratorio>('create_e2ee_lab', {});
    urls.lembrar(lab.token.uuid, lab.read_secret);
    expect(lab.token.lab).toMatchObject({ signer_kid: 'lab-sig-1' });

    const catalogo = await mcp.chamarOk<unknown[]>('list_e2ee_scenarios', {});
    expect(catalogo).toHaveLength(27);

    const rodada = await mcp.chamar('run_e2ee_scenarios', { read_secret: lab.read_secret }, lab.token.uuid);
    expect(rodada.isError ?? false, textoDo(rodada).slice(0, 300)).toBe(false);
    expect(jsonDo<{ total: number; matched: number }>(rodada)).toMatchObject({ total: 27, matched: 27 });
    expect(textoDo(rodada)).not.toContain('"decrypted"');

    const comum = await urls.abrir();
    const recusada = await mcp.chamar('run_e2ee_scenarios', {}, comum.uuid);
    expect(recusada.isError).toBe(true);
    expect(jsonDo<{ status: number }>(recusada).status).toBe(422);
  });

  test('create_url e update_url continuam ignorando e2ee, também numa URL de laboratório', async ({ mcp, urls }) => {
    const intruso = await parEc('intruso');
    const criada = await mcp.chamarOk<Token>('create_url', { e2ee: politica([intruso.publica]) });
    urls.lembrar(criada.uuid);
    expect(criada.e2ee).toBeNull();

    const lab = await mcp.chamarOk<Laboratorio>('create_e2ee_lab', {});
    urls.lembrar(lab.token.uuid, lab.read_secret);
    await mcp.chamar('update_url', { read_secret: lab.read_secret, e2ee: null }, lab.token.uuid);
    await mcp.chamar('update_url', { read_secret: lab.read_secret, e2ee: politica([intruso.publica]) }, lab.token.uuid);
    const lido = (await http('GET', `/token/${lab.token.uuid}`, { headers: comSegredo(lab.read_secret) })).json<Token>();
    expect(lido.e2ee).toEqual(lab.token.e2ee);
  });
});
