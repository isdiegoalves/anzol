import { JSON_ACCEPT, expect, expectContentType, test } from '../../support/contrato.js';
import { chamarBusca } from '../../support/busca.js';
import { erros422, lerRegras, putRegras, testarRegra } from '../../support/regras.js';

// O `path` vazio de um `jsonPath` no `match` é um caminho inválido como os outros (`$.a.`, `$['x'`): 422
// `{"…match.body.0.jsonPath.path": ["The path is invalid."]}` nas três rotas que leem o `match` de uma regra, e não o
// 500 que saía (o compilador de JSONPath recusa o texto vazio com outra exceção).

const MATCH = { body: [{ jsonPath: { path: '', equals: 1 } }] };
const INVALIDO = ['The path is invalid.'];

test.describe('jsonPath com o path vazio → 422, como os outros caminhos inválidos', () => {
  test('PUT /token/{id}/rules → 422 em 0.match.body.0.jsonPath.path, e nada é salvo', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;

    const res = await putRegras(request, t, [{ name: 'vazio', match: MATCH, response: { status: 200 } }]);

    expectContentType(res, 'application/json');
    expect(await erros422(res)).toEqual({ '0.match.body.0.jsonPath.path': INVALIDO });
    expect(await lerRegras(request, t)).toEqual([]);
  });

  test('POST /token/{id}/rules/test → 422 em match.body.0.jsonPath.path', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;

    const res = await testarRegra(request, t, { name: 'vazio', match: MATCH });

    expectContentType(res, 'application/json');
    expect(await erros422(res)).toEqual({ 'match.body.0.jsonPath.path': INVALIDO });
  });

  test('POST /token/{id}/requests/search → 422 em match.body.0.jsonPath.path', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await request.post(`/${t}/pedidos`, { data: { status: 'pago' }, headers: JSON_ACCEPT });

    const res = await chamarBusca(request, t, { match: MATCH });

    expectContentType(res, 'application/json');
    expect(await erros422(res)).toEqual({ 'match.body.0.jsonPath.path': INVALIDO });
  });
});
