import { randomUUID } from 'node:crypto';
import { MODO_MCP } from '../../support/ia.js';
import { argumentoDaUrl, test as testMcp, textoDo, type Mcp } from '../../support/mcp.js';
import { comSegredo, expect, fixtureUrls, http, type Urls } from '../../support/privacidade.js';
import { lerRegras, salvarRegras, type Regra, type RegraSalva } from '../../support/regras.js';

// UX de Regras, E-07 (`.docs-arquivo/regras-ux/api-contrato.md`): ferramenta MCP `diff_rules`, com o mesmo argumento
// do `set_rules` (a lista de regras), que NÃO grava e devolve `{equal: [id…], changed: [{id, name, fields}], removed:
// [{id, name}], added: [{id?, name}]}` comparando por `id` com as regras salvas da URL (regra sem `id` = nova).
// `set_rules` não muda (ia-mcp.spec.ts).
//
// SUPOSIÇÃO: a ordem dos itens em cada lista e a de `fields` não é fixada; o contrato compara ordenado.

const test = testMcp.extend<{ urls: Urls }>({ urls: fixtureUrls });

interface Diferenca {
  equal: string[];
  changed: Array<{ id: string; name: string; fields: string[] }>;
  removed: Array<{ id: string; name: string }>;
  added: Array<{ id?: string | null; name: string }>;
}

async function diff(mcp: Mcp, tokenId: string, rules: unknown[]): Promise<Diferenca> {
  const d = await mcp.chamarOk<Diferenca>('diff_rules', { rules }, tokenId);
  expect(Object.keys(d).sort(), JSON.stringify(d).slice(0, 300)).toEqual(['added', 'changed', 'equal', 'removed']);
  for (const c of d.changed) expect(Object.keys(c).sort(), JSON.stringify(c)).toEqual(['fields', 'id', 'name']);
  for (const r of d.removed) expect(Object.keys(r).sort(), JSON.stringify(r)).toEqual(['id', 'name']);
  for (const a of d.added) {
    expect(Object.keys(a).every((k) => k === 'id' || k === 'name'), JSON.stringify(a)).toBe(true);
    expect(typeof a.name).toBe('string');
  }
  return d;
}

const ordenar = <T>(itens: T[], chave: (t: T) => string): T[] => [...itens].sort((a, b) => chave(a).localeCompare(chave(b)));

/** Tira `description` de um JSON Schema, para comparar a forma do argumento sem o texto de ajuda. */
function semDescricao(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(semDescricao);
  if (schema && typeof schema === 'object') {
    return Object.fromEntries(Object.entries(schema).filter(([k]) => k !== 'description').map(([k, v]) => [k, semDescricao(v)]));
  }
  return schema;
}

test.describe('MCP diff_rules (E-07)', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('listada, com descrição, o UUID da URL e o mesmo argumento rules do set_rules', async ({ mcp }) => {
    const f = mcp.ferramentas.get('diff_rules');
    expect(f, `diff_rules ausente de ${[...mcp.ferramentas.keys()].join(', ')}`).toBeDefined();
    expect((f!.description ?? '').trim().length).toBeGreaterThan(0);
    expect(f!.inputSchema.type).toBe('object');
    expect(argumentoDaUrl(f!), JSON.stringify(f!.inputSchema)).toBeDefined();
    const props = (f!.inputSchema.properties ?? {}) as Record<string, unknown>;
    const doSet = (mcp.ferramentas.get('set_rules')!.inputSchema.properties ?? {}) as Record<string, unknown>;
    expect(props).toHaveProperty('rules');
    expect(semDescricao(props['rules'])).toEqual(semDescricao(doSet['rules']));
  });

  test('compara por id: iguais, alteradas com os campos, removidas e novas (com e sem id); não grava', async ({ mcp, request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const [igual, status, nome, some] = await salvarRegras(request, t, [
      { name: 'fica igual', priority: 2, match: { method: ['POST'], path: { equals: '/a' } }, response: { status: 201, body: 'a' } },
      { name: 'muda status', match: { path: { equals: '/b' } }, response: { status: 200 } },
      { name: 'muda nome e prioridade', priority: 3 },
      { name: 'some' },
    ]);
    const antes = await lerRegras(request, t);
    const novoId = randomUUID();
    const proposta: Regra[] = [
      igual,
      { ...status, response: { ...status.response, status: 503 } },
      { ...nome, name: 'nome novo', priority: 4 },
      { name: 'nova sem id' },
      { id: novoId, name: 'nova com id' },
    ];

    const d = await diff(mcp, t, proposta);
    expect(d.equal).toEqual([igual.id]);

    const changed = ordenar(d.changed, (c) => c.id);
    expect(changed.map((c) => c.id)).toEqual([status.id, nome.id].sort());
    const cStatus = changed.find((c) => c.id === status.id)!;
    expect(cStatus.name).toBe('muda status');
    expect(cStatus.fields).toEqual(['response.status']);
    const cNome = changed.find((c) => c.id === nome.id)!;
    // SUPOSIÇÃO: com o nome alterado, o api-contrato não diz se `name` é o salvo ou o proposto; os dois valem.
    expect(['muda nome e prioridade', 'nome novo']).toContain(cNome.name);
    expect([...cNome.fields].sort()).toEqual(['name', 'priority']);

    expect(d.removed).toEqual([{ id: some.id, name: 'some' }]);

    const added = ordenar(d.added, (a) => a.name);
    expect(added.map((a) => a.name)).toEqual(['nova com id', 'nova sem id']);
    // Regra com `id` que a URL não tem também é nova (a comparação é por `id`), e o `id` vem junto.
    expect(added[0].id).toBe(novoId);
    // SUPOSIÇÃO: `{id?, name}` — a regra sem `id` vem sem a chave ou com `null`.
    expect(added[1].id ?? null).toBeNull();

    // Não grava.
    expect(await lerRegras(request, t)).toEqual(antes);
  });

  test('a lista salva, reenviada como veio do GET: tudo igual', async ({ mcp, request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const salvas = await salvarRegras(request, t, [
      {
        name: 'rica', priority: 1, enabled: false,
        match: { method: ['POST'], query: { tipo: { equals: 'pix' } }, headers: { 'X-S': { present: true } }, body: [{ jsonPath: { path: '$.s', equals: 'ok' } }] },
        scenario: { name: 'c', requiredState: 'Started', newState: 'fim' },
        response: { status: 202, headers: { 'X-Seq': '{{seq}}' }, body: '{{request.method}}', template: true, delay: { fixed: 10 } },
      },
      { name: 'mínima' },
    ]);
    const d = await diff(mcp, t, await lerRegras(request, t));
    expect([...d.equal].sort()).toEqual(salvas.map((r) => r.id).sort());
    expect(d).toMatchObject({ changed: [], removed: [], added: [] });
  });

  test('lista vazia: todas removidas; URL sem regras: todas novas', async ({ mcp, request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const salvas = await salvarRegras(request, t, [{ name: 'um' }, { name: 'dois' }]);
    const vazia = await diff(mcp, t, []);
    expect(vazia).toMatchObject({ equal: [], changed: [], added: [] });
    expect(ordenar(vazia.removed, (r) => r.id)).toEqual(ordenar(salvas.map(({ id, name }) => ({ id, name })), (r) => r.id));
    expect(await lerRegras(request, t)).toEqual(salvas);

    const semRegras = (await tokens.criar()).uuid;
    const novas = await diff(mcp, semRegras, [{ name: 'um' }, { name: 'dois' }]);
    expect(novas).toMatchObject({ equal: [], changed: [], removed: [] });
    expect(novas.added.map((a) => a.name).sort()).toEqual(['dois', 'um']);
    expect(await lerRegras(request, semRegras)).toEqual([]);
  });

  test('campos aninhados e enabled: fields aponta o ramo que mudou e só ele', async ({ mcp, request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const [caminho, cabecalho, ligada] = await salvarRegras(request, t, [
      { name: 'caminho', match: { path: { equals: '/x' } }, response: { body: 'b' } },
      { name: 'cabeçalho', response: { headers: { 'X-A': '1' }, body: 'b' } },
      { name: 'ligada', enabled: true },
    ]);
    const d = await diff(mcp, t, [
      { ...caminho, match: { path: { equals: '/y' } } },
      { ...cabecalho, response: { ...cabecalho.response, headers: { 'X-A': '2' } } },
      { ...ligada, enabled: false },
    ]);
    expect(d).toMatchObject({ equal: [], removed: [], added: [] });
    const campos = (id: string) => d.changed.find((c) => c.id === id)?.fields ?? [];
    // SUPOSIÇÃO: a profundidade do caminho em `fields` não é fixada (`match.path` ou `match.path.equals`).
    expect(campos(caminho.id).length).toBeGreaterThan(0);
    for (const f of campos(caminho.id)) expect(f).toMatch(/^match\.path(\.|$)/);
    expect(campos(cabecalho.id).length).toBeGreaterThan(0);
    for (const f of campos(cabecalho.id)) expect(f).toMatch(/^response\.headers(\.|$)/);
    expect(campos(ligada.id)).toEqual(['enabled']);
  });

  test('regra com os padrões omitidos conta como igual à salva com os padrões', async ({ mcp, request, tokens }) => {
    // SUPOSIÇÃO: a comparação é depois dos padrões (o que o set_rules gravaria), senão todo arquivo escrito à mão
    // apareceria como alterado em `enabled`, `priority`, `response.status`…
    const t = (await tokens.criar()).uuid;
    const [minima] = await salvarRegras(request, t, [{ name: 'mínima' }]);
    const d = await diff(mcp, t, [{ id: minima.id, name: 'mínima' }]);
    expect(d).toEqual({ equal: [minima.id], changed: [], removed: [], added: [] });
  });

  test('regra inválida: erro de ferramenta com a mensagem do 422 do set_rules, e nada gravado', async ({ mcp, request, tokens }) => {
    // SUPOSIÇÃO: "o mesmo argumento de set_rules" inclui a mesma validação; o diff de uma lista que o set_rules
    // recusaria é recusado com a mesma mensagem.
    const t = (await tokens.criar()).uuid;
    const salvas: RegraSalva[] = await salvarRegras(request, t, [{ name: 'fica' }]);
    const r = await mcp.chamar('diff_rules', { rules: [{ name: 'ruim', match: { path: { regex: '([a-z' } } }] }, t);
    expect(r.isError, textoDo(r).slice(0, 300)).toBe(true);
    expect(textoDo(r)).toContain('The regex is invalid.');
    expect(await lerRegras(request, t)).toEqual(salvas);
  });

  test('URL inexistente: erro de ferramenta com Token not found', async ({ mcp }) => {
    const r = await mcp.chamar('diff_rules', { rules: [] }, randomUUID());
    expect(r.isError, textoDo(r).slice(0, 300)).toBe(true);
    expect(textoDo(r)).toContain('Token not found');
  });

  test('URL protegida: sem read_secret é erro que cita protected; com ele, o diff', async ({ mcp, urls }) => {
    // SUPOSIÇÃO: vale para diff_rules o que privacidade-mcp.spec.ts exige de toda ferramenta da URL.
    const url = await urls.proteger();
    const put = await http('PUT', `/token/${url.uuid}/rules`, { headers: comSegredo(url.segredo), corpo: [{ name: 'protegida' }] });
    expect(put.status, put.texto.slice(0, 300)).toBe(200);
    const [salva] = put.json<RegraSalva[]>();

    const f = mcp.ferramentas.get('diff_rules');
    expect(f, 'diff_rules ausente').toBeDefined();
    expect((f!.inputSchema.properties ?? {}) as Record<string, unknown>).toHaveProperty('read_secret');

    const sem = await mcp.chamar('diff_rules', { rules: [] }, url.uuid);
    expect(sem.isError, textoDo(sem).slice(0, 300)).toBe(true);
    expect(textoDo(sem)).toMatch(/protected/i);
    expect(JSON.stringify(sem)).not.toContain(url.segredo);

    const com = await mcp.chamarOk<Diferenca>('diff_rules', { rules: [], read_secret: url.segredo }, url.uuid);
    expect(com.removed).toEqual([{ id: salva.id, name: 'protegida' }]);
    expect(JSON.stringify(com)).not.toContain(url.segredo);
  });
});
