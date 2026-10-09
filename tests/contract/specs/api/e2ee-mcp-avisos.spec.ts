import type { Token } from '../../support/contrato.js';
import { parEc, politica } from '../../support/e2ee.js';
import { MODO_MCP } from '../../support/ia.js';
import { test as testMcp } from '../../support/mcp.js';
import { comSegredo, expect, fixtureUrls, http, type Urls } from '../../support/privacidade.js';

// O `create_url` e o `update_url` ignoram `e2ee` (nenhuma ferramenta muda a política da decifra), e o resultado diz
// isso em `warnings`, para o agente não concluir que mudou. `signature: null` numa URL que decifra também avisa: a
// conferência do HMAC, que roda antes da decifra, sai junto. Sem nada a avisar, o resultado não traz `warnings`.

const test = testMcp.extend<{ urls: Urls }>({ urls: fixtureUrls });

const E2EE_IGNORADO = 'e2ee ignored: MCP never changes it; ask the person to change it in the UI (Checks › Decryption).';
const ASSINATURA_REMOVIDA = 'signature removed on a URL with e2ee: decryption no longer requires a valid HMAC';
const HMAC = { provider: 'github', secret: 'segredo-do-hmac-lote' };

type TokenComAvisos = Token & { warnings?: string[] };

test.describe('MCP: avisos sobre a decifra no create_url e no update_url', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('update_url com e2ee (outra política ou null): warnings com o aviso, e a política fica como estava', async ({ mcp, urls }) => {
    const remetente = await parEc('remetente-sig-1');
    const intruso = await parEc('intruso');
    const { uuid, segredo, token } = await urls.proteger({ e2ee: politica([remetente.publica]) });

    for (const e2ee of [politica([intruso.publica]), null]) {
      const r = await mcp.chamarOk<TokenComAvisos>('update_url', { read_secret: segredo, e2ee, default_status: 202 }, uuid);
      expect(r.warnings, JSON.stringify(e2ee)?.slice(0, 80)).toEqual([E2EE_IGNORADO]);
      expect(r.e2ee).toEqual(token.e2ee);
      expect(r.default_status).toBe(202);
    }
    const lido = (await http('GET', `/token/${uuid}`, { headers: comSegredo(segredo) })).json<Token>();
    expect(lido.e2ee).toEqual(token.e2ee);
  });

  test('create_url com e2ee: warnings com o aviso, e a URL nasce sem decifra', async ({ mcp, urls }) => {
    const intruso = await parEc('intruso');
    const criada = await mcp.chamarOk<TokenComAvisos>('create_url', { e2ee: politica([intruso.publica]) });
    urls.lembrar(criada.uuid);

    expect(criada.warnings).toEqual([E2EE_IGNORADO]);
    expect(criada.e2ee).toBeNull();
  });

  test('sem e2ee nos argumentos, o resultado não traz warnings', async ({ mcp, urls }) => {
    const criada = await mcp.chamarOk<TokenComAvisos>('create_url', { default_status: 201 });
    urls.lembrar(criada.uuid);
    const mudada = await mcp.chamarOk<TokenComAvisos>('update_url', { default_status: 202 }, criada.uuid);

    expect(criada).not.toHaveProperty('warnings');
    expect(mudada).not.toHaveProperty('warnings');
  });

  test('signature: null numa URL que decifra: warnings com o aviso, e a assinatura sai', async ({ mcp, urls }) => {
    const remetente = await parEc('remetente-sig-1');
    const { uuid, segredo } = await urls.proteger({ e2ee: politica([remetente.publica]), signature: HMAC });

    const r = await mcp.chamarOk<TokenComAvisos>('update_url', { read_secret: segredo, signature: null }, uuid);

    expect(r.warnings).toEqual([ASSINATURA_REMOVIDA]);
    expect(r.signature).toBeNull();
    expect(r.e2ee).not.toBeNull();
  });

  test('signature: null e e2ee na mesma chamada: os dois avisos', async ({ mcp, urls }) => {
    const remetente = await parEc('remetente-sig-1');
    const { uuid, segredo } = await urls.proteger({ e2ee: politica([remetente.publica]), signature: HMAC });

    const r = await mcp.chamarOk<TokenComAvisos>('update_url', { read_secret: segredo, signature: null, e2ee: null }, uuid);

    expect(r.warnings).toEqual([E2EE_IGNORADO, ASSINATURA_REMOVIDA]);
  });

  test('signature: null sem decifra na URL, ou sem assinatura para tirar: sem warnings', async ({ mcp, urls }) => {
    const comum = await urls.abrir({ signature: HMAC });
    const remetente = await parEc('remetente-sig-1');
    const semHmac = await urls.proteger({ e2ee: politica([remetente.publica]) });

    const naComum = await mcp.chamarOk<TokenComAvisos>('update_url', { signature: null }, comum.uuid);
    const semNada = await mcp.chamarOk<TokenComAvisos>('update_url', { read_secret: semHmac.segredo, signature: null }, semHmac.uuid);

    expect(naComum).not.toHaveProperty('warnings');
    expect(semNada).not.toHaveProperty('warnings');
  });

  test('a descrição do update_url diz o que signature: null tira de uma URL que decifra', async ({ mcp }) => {
    const descricao = mcp.ferramentas.get('update_url')?.description ?? '';
    expect(descricao).toContain('HMAC check that runs before decryption');
  });

  test('as descrições de create_url e update_url dizem que o MCP não muda e2ee', async ({ mcp }) => {
    for (const nome of ['create_url', 'update_url']) {
      const descricao = mcp.ferramentas.get(nome)?.description ?? '';
      expect(descricao, nome).toContain('e2ee');
      expect(descricao, nome).toContain('MCP never');
      expect(descricao, `${nome} não aponta a rota`).not.toContain('PUT /token');
    }
  });
});
