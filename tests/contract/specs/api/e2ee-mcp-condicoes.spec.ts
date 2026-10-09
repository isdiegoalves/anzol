import { MODO_MCP } from '../../support/ia.js';
import { expect } from '../../support/contrato.js';
import { test } from '../../support/mcp.js';

// A condição `match.decryption` e o resultado `decryption` da mensagem, no texto que o agente lê no `tools/list`: sem
// eles, o agente só acha a condição copiando a regra de um laboratório já criado.

const ESTADOS = ['valid', 'invalid', 'unknown_kid', 'absent'];

test.describe('MCP: a decifra nas descrições', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('o argumento match de search_requests e wait_for_request cita decryption', async ({ mcp }) => {
    for (const nome of ['search_requests', 'wait_for_request']) {
      const match = (mcp.ferramentas.get(nome)?.inputSchema.properties as Record<string, { description?: string }> | undefined)?.match;
      expect(match?.description ?? '', `${nome}: descrição de match`).toContain('decryption');
    }
  });

  test('set_rules descreve a condição decryption com os quatro estados', async ({ mcp }) => {
    const descricao = mcp.ferramentas.get('set_rules')?.description ?? '';
    expect(descricao).toContain('decryption');
    for (const estado of ESTADOS) expect(descricao, `set_rules cita ${estado}`).toContain(estado);
  });

  test('get_request diz que traz o resultado da decifra', async ({ mcp }) => {
    expect(mcp.ferramentas.get('get_request')?.description ?? '').toContain('decryption');
  });
});
