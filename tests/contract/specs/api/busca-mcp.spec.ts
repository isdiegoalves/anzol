import { enviarEGuardar, expect, type Listagem } from '../../support/contrato.js';
import { assinaturaGithub } from '../../support/assinatura.js';
import { MODO_MCP } from '../../support/ia.js';
import { test, type Mcp } from '../../support/mcp.js';
import { salvarRegras } from '../../support/regras.js';
import { envioJson } from '../../support/schema.js';

// v0.6.0: o `search_requests` do MCP declara no `tools/list` os filtros de topo da busca (`outcome`, `answered`,
// `signature_reason` e `schema_path`) e filtra por cada um como o `POST /token/{id}/requests/search`. O
// `decryption_reason` está em `busca-motivo-decifra.spec.ts`; o que cada filtro casa, nos specs da busca pela API.

const SEGREDO = 'segredo-busca-mcp-4Tz9';
const SCHEMA = { type: 'object', required: ['id', 'status'], properties: { id: { type: 'integer' }, status: { type: 'string' } } };

function filtrosDeclarados(mcp: Mcp): string[] {
  return Object.keys(mcp.ferramentas.get('search_requests')?.inputSchema.properties ?? {});
}

/** Os uuids que o `search_requests` devolve com o filtro, da mais antiga para a mais nova. */
async function achadas(mcp: Mcp, tokenId: string, filtro: Record<string, unknown>): Promise<string[]> {
  const pagina = await mcp.chamarOk<Listagem>('search_requests', { sorting: 'oldest', ...filtro }, tokenId);
  return pagina.data.map((m) => m.uuid);
}

test.describe('MCP: os filtros de topo do search_requests', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('search_requests declara outcome e filtra por ele', async ({ mcp, request, tokens }) => {
    expect(filtrosDeclarados(mcp)).toContain('outcome');

    const t = (await tokens.criar()).uuid;
    const [pix] = await salvarRegras(request, t, [
      { name: 'Pix', match: { method: ['POST'], path: { equals: '/pix' } }, response: { status: 201 } },
    ]);
    const { msg: quase } = await enviarEGuardar(request, t, '/pix');
    const { msg: respondida } = await enviarEGuardar(request, t, '/pix', { method: 'POST' });
    const { msg: outra } = await enviarEGuardar(request, t, '/boleto', { method: 'POST' });
    expect(respondida.rule?.id).toBe(pix.id);
    expect(quase.rule).toBeNull();
    expect(outra.rule).toBeNull();

    expect(await achadas(mcp, t, { outcome: { type: 'rule', rule: pix.id } })).toEqual([respondida.uuid]);
  });

  test('search_requests declara answered e filtra por ele', async ({ mcp, request, tokens }) => {
    expect(filtrosDeclarados(mcp)).toContain('answered');

    const t = (await tokens.criar()).uuid;
    const { msg: ok } = await enviarEGuardar(request, t, '/a');
    const { msg: fora } = await enviarEGuardar(request, t, '/503');
    const { msg: ausente } = await enviarEGuardar(request, t, '/404');
    expect(ok.response).toEqual({ status: 200 });
    expect(fora.response).toEqual({ status: 503 });
    expect(ausente.response).toEqual({ status: 404 });

    expect(await achadas(mcp, t, { answered: ['5xx'] })).toEqual([fora.uuid]);
  });

  test('search_requests declara signature_reason e filtra por ele', async ({ mcp, request, tokens }) => {
    expect(filtrosDeclarados(mcp)).toContain('signature_reason');

    const t = (await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } })).uuid;
    const corpo = '{"id":1}';
    const assinado = (segredo: string) => ({
      method: 'POST', headers: { 'X-Hub-Signature-256': assinaturaGithub(segredo, corpo) }, data: Buffer.from(corpo),
    });
    const { msg: valida } = await enviarEGuardar(request, t, '/x', assinado(SEGREDO));
    const { msg: divergente } = await enviarEGuardar(request, t, '/x', assinado('outro-segredo'));
    const { msg: semHeader } = await enviarEGuardar(request, t, '/x', { method: 'POST', data: Buffer.from(corpo) });
    expect(valida.signature?.valid).toBe(true);
    expect(divergente.signature?.reason).toBe('signature mismatch');
    expect(semHeader.signature?.reason).toBe('header X-Hub-Signature-256 absent');

    expect(await achadas(mcp, t, { signature_reason: 'signature mismatch' })).toEqual([divergente.uuid]);
  });

  test('search_requests declara schema_path e filtra por ele', async ({ mcp, request, tokens }) => {
    expect(filtrosDeclarados(mcp)).toContain('schema_path');

    const t = (await tokens.criar({ schema: SCHEMA })).uuid;
    const { msg: valida } = await enviarEGuardar(request, t, '', envioJson({ id: 1, status: 'pago' }));
    const { msg: semStatus } = await enviarEGuardar(request, t, '', envioJson({ id: 2, status: 5 }));
    const { msg: semId } = await enviarEGuardar(request, t, '', envioJson({ id: 'tres', status: 'pago' }));
    expect(valida.schema?.valid).toBe(true);
    expect(semStatus.schema?.errors.map((e) => e.path)).toEqual(['/status']);
    expect(semId.schema?.errors.map((e) => e.path)).toEqual(['/id']);

    expect(await achadas(mcp, t, { schema_path: '/status' })).toEqual([semStatus.uuid]);
  });
});
