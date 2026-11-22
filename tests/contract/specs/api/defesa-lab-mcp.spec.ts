import { type Mensagem, type Token } from '../../support/contrato.js';
import { ONDA, REGRAS_DO_PISO, type Laboratorio, type Relatorio } from '../../support/defesa.js';
import { MODO_MCP } from '../../support/ia.js';
import { jsonDo, textoDo, test as testMcp } from '../../support/mcp.js';
import { expect, fixtureUrls, type Urls } from '../../support/privacidade.js';

// Laboratório de defesa pelo MCP: um agente cria a URL, abre a rodada, lê com `list_requests`, julga com
// `submit_defense_verdicts`, contém com `set_rules` e fecha com `finish_defense_round`. Passar o segredo de leitura
// como argumento não conta como vazamento. A onda inteira cabe num `list_requests`, abaixo do corte de 100 KiB que
// agentes gerenciados aplicam ao resultado de ferramenta.

const test = testMcp.extend<{ urls: Urls }>({ urls: fixtureUrls });

const DE_DEFESA = ['create_defense_lab', 'list_defense_scenarios', 'start_defense_round', 'submit_defense_verdicts', 'finish_defense_round'];

/** O teto do resultado de uma onda no `list_requests`, em caracteres; o corte de agente gerenciado é 100.000. */
const TETO_DA_LISTAGEM = 60_000;

test.describe('laboratório de defesa pelo MCP', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('as cinco ferramentas existem; só o catálogo é de leitura e nenhuma é destrutiva', async ({ mcp }) => {
    for (const nome of DE_DEFESA) {
      const f = mcp.ferramentas.get(nome);
      expect(f, nome).toBeDefined();
      expect((f!.description ?? '').trim().length, nome).toBeGreaterThan(0);
      expect(f!.inputSchema.type).toBe('object');
      expect(f!.annotations?.readOnlyHint, nome).toBe(nome === 'list_defense_scenarios');
      expect(f!.annotations?.destructiveHint, nome).toBe(false);
    }
    expect(mcp.ferramentas.get('set_rules')!.annotations?.readOnlyHint).toBe(false);
  });

  test('rodada inteira só pelo MCP; a listagem da onda cabe no resultado de ferramenta', async ({ mcp, urls }) => {
    const lab = await mcp.chamarOk<Laboratorio>('create_defense_lab', {});
    urls.lembrar(lab.token.uuid, lab.read_secret);
    const segredo = { read_secret: lab.read_secret };
    expect(await mcp.chamarOk<unknown[]>('list_defense_scenarios', {})).toHaveLength(14);

    const inicio = await mcp.chamarOk<{ round_id: string; requests: number }>('start_defense_round', segredo, lab.token.uuid);
    expect(inicio.requests).toBe(ONDA);

    const listagem = await mcp.chamar('list_requests', { ...segredo, per_page: 100 }, lab.token.uuid);
    expect(listagem.isError ?? false, textoDo(listagem).slice(0, 300)).toBe(false);
    expect(textoDo(listagem).length).toBeLessThan(TETO_DA_LISTAGEM);
    for (const proibido of ['"scenario"', '"layer"', '"family"', '"floor"', '"seed"']) expect(textoDo(listagem)).not.toContain(proibido);
    const onda = jsonDo<{ data: Mensagem[] }>(listagem).data;
    expect(onda).toHaveLength(ONDA);

    const reprovadas = onda.filter((m) => m.signature && !m.signature.valid);
    const verdicts = reprovadas.map((m) => ({ request_id: m.uuid, verdict: 'attack', family: 'integrity' }));
    const julgadas = await mcp.chamarOk<{ recorded: number }>('submit_defense_verdicts', { ...segredo, round_id: inicio.round_id, verdicts }, lab.token.uuid);
    expect(julgadas.recorded).toBe(4);
    await mcp.chamarOk('set_rules', { ...segredo, rules: REGRAS_DO_PISO }, lab.token.uuid);

    const relatorio = await mcp.chamarOk<Relatorio>('finish_defense_round', { ...segredo, round_id: inicio.round_id }, lab.token.uuid);
    expect(relatorio.detection.detected).toBe(4);
    expect(relatorio.containment).toMatchObject({ blocked: 4, passed: relatorio.containment.legitimate });
    expect(relatorio.actions).toEqual({ rule_writes: 1, config_changes: 0, outbound: 0 });
    expect(relatorio.injection.obeyed).toBe(0);
  });

  test('erros viram erro de ferramenta: 422 numa URL comum, 409 com rodada aberta, 404 em rodada inexistente', async ({ mcp, urls }) => {
    const comum = await mcp.chamarOk<Token>('create_url', {});
    urls.lembrar(comum.uuid);
    const lab = await mcp.chamarOk<Laboratorio>('create_defense_lab', {});
    urls.lembrar(lab.token.uuid, lab.read_secret);
    const segredo = { read_secret: lab.read_secret };
    await mcp.chamarOk('start_defense_round', segredo, lab.token.uuid);

    const fora = await mcp.chamar('start_defense_round', {}, comum.uuid);
    const segunda = await mcp.chamar('start_defense_round', segredo, lab.token.uuid);
    const inexistente = await mcp.chamar(
      'finish_defense_round', { ...segredo, round_id: '00000000-0000-4000-8000-000000000000' }, lab.token.uuid,
    );
    expect([fora, segunda, inexistente].map((r) => r.isError)).toEqual([true, true, true]);
    expect([fora, segunda, inexistente].map((r) => jsonDo<{ status: number }>(r).status)).toEqual([422, 409, 404]);
  });
});
