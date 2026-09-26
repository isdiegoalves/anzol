import { JSON_ACCEPT, UUID, expect, expectErroJson, test } from '../../support/contrato.js';
import { lerRegras, putRegras, salvarRegras, testarRegra, type Regra } from '../../support/regras.js';

// API de regras de resposta (CA-9): `GET /token/{id}/rules` devolve a lista; `PUT` substitui a
// lista inteira (é o import) e devolve a lista salva com `id`s. Validação → 422 com chaves em
// notação de ponto a partir da lista (`0.match.path.regex`), no estilo do Laravel.

/** Regra com todos os campos explícitos: a ida e volta tem de devolvê-la sem perda nem acréscimo. */
const COMPLETA: Regra = {
  id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  name: 'Pagamento pix aprovado',
  enabled: true,
  priority: 2,
  match: {
    method: ['POST', 'PUT'],
    path: { equals: '/pagamentos' },
    query: { tipo: { equals: 'pix' }, canal: { contains: 'app' }, lote: { regex: '^[0-9]+$' }, debug: { present: false } },
    headers: { 'X-Signature': { present: true }, 'X-Canal': { regex: '^web-[0-9]+$' } },
    body: [
      { jsonPath: { path: '$.status', equals: 'pago' } },
      { jsonPath: { path: '$.pedido.id' } },
      { contains: 'pedido' },
      { regex: '"valor":\\s*[0-9]+' },
      { equals: '{"status":"pago"}' },
      { equalToJson: { status: 'pago', itens: [1, 2], cliente: { id: 7 } } },
    ],
  },
  scenario: null,
  response: {
    status: 201,
    headers: { 'Content-Type': 'application/json', 'X-Mock': 'sim' },
    body: '{"ok":true}',
    template: false,
    delay: null,
    dribble: null,
    fault: null,
  },
};

function semId({ id: _id, ...resto }: Regra): Regra {
  return resto;
}

test.describe('regras: GET e PUT', () => {
  test('URL nova: lista vazia', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(await lerRegras(request, token.uuid)).toEqual([]);
  });

  test('ida e volta sem perda: o PUT devolve a lista salva e o GET devolve a mesma', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const salvas = await salvarRegras(request, token.uuid, [COMPLETA]);
    expect(salvas).toEqual([COMPLETA]);
    expect(await lerRegras(request, token.uuid)).toEqual([COMPLETA]);
  });

  test('id ausente: o servidor gera um uuid por regra, distinto, que o GET mantém', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const enviadas = [semId(COMPLETA), { ...semId(COMPLETA), name: 'Segunda' }];
    const salvas = await salvarRegras(request, token.uuid, enviadas);
    expect(salvas).toHaveLength(2);
    for (const [i, salva] of salvas.entries()) {
      expect(salva.id).toMatch(UUID);
      expect(semId(salva)).toEqual(enviadas[i]);
    }
    expect(salvas[0].id).not.toBe(salvas[1].id);
    expect(await lerRegras(request, token.uuid)).toEqual(salvas);
  });

  test('importar de novo a lista exportada não muda nada (ids mantidos)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const primeira = await salvarRegras(request, token.uuid, [semId(COMPLETA), { name: 'b', match: { path: { prefix: '/b' } } }]);
    const exportada = await lerRegras(request, token.uuid);
    expect(await salvarRegras(request, token.uuid, exportada)).toEqual(primeira);
    expect(await lerRegras(request, token.uuid)).toEqual(primeira);
  });

  test('padrões: enabled true, priority 5, status 200, body "", template false; scenario e falhas nulos', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [salva] = await salvarRegras(request, token.uuid, [{ name: 'mínima', match: { path: { equals: '/x' } }, response: {} }]);
    expect(salva.id).toMatch(UUID);
    expect(salva.name).toBe('mínima');
    expect(salva.enabled).toBe(true);
    expect(salva.priority).toBe(5);
    expect(salva.match.path).toEqual({ equals: '/x' });
    expect(salva.response.status).toBe(200);
    expect(salva.response.body).toBe('');
    expect(salva.response.template).toBe(false);
    // Os campos das fatias seguintes vêm nulos ou ausentes.
    expect(salva.scenario ?? null).toBeNull();
    expect(salva.response.delay ?? null).toBeNull();
    expect(salva.response.dribble ?? null).toBeNull();
    expect(salva.response.fault ?? null).toBeNull();
  });

  test('PUT substitui a lista inteira, mantém a ordem enviada e [] apaga todas', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [{ name: 'a' }, { name: 'b' }]);
    // Ordem da lista, não da prioridade: é ela que desempata.
    const trocada = await salvarRegras(request, token.uuid, [
      { name: 'z', priority: 9 }, { name: 'y', priority: 1 }, { name: 'x', priority: 5 },
    ]);
    expect(trocada.map((r) => r.name)).toEqual(['z', 'y', 'x']);
    expect((await lerRegras(request, token.uuid)).map((r) => [r.name, r.priority])).toEqual([['z', 9], ['y', 1], ['x', 5]]);
    expect(await salvarRegras(request, token.uuid, [])).toEqual([]);
    expect(await lerRegras(request, token.uuid)).toEqual([]);
  });

  test('100 regras são aceitas', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regras = Array.from({ length: 100 }, (_, i) => ({ name: `r${i}`, match: { path: { equals: `/r${i}` } } }));
    const salvas = await salvarRegras(request, token.uuid, regras);
    expect(salvas).toHaveLength(100);
    expect(salvas.map((r) => r.name)).toEqual(regras.map((r) => r.name));
  });
});

test.describe('regras: token inexistente → 410', () => {
  test('GET, PUT e rules/test de token que não existe (ou que foi apagado) → 410 Token not found', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(await lerRegras(request, token.uuid)).toEqual([]);

    const inexistente = '00000000-0000-4000-8000-000000000000';
    for (const uuid of [inexistente, token.uuid]) {
      if (uuid === token.uuid) {
        expect((await request.delete(`/token/${uuid}`, { headers: JSON_ACCEPT })).status()).toBe(204);
      }
      await expectErroJson(await request.get(`/token/${uuid}/rules`, { headers: JSON_ACCEPT }), 410, 'Token not found');
      await expectErroJson(await putRegras(request, uuid, [{ name: 'a' }]), 410, 'Token not found');
      await expectErroJson(await testarRegra(request, uuid, { name: 'a' }), 410, 'Token not found');
    }
  });
});

test.describe('regras: validação (cliente JSON) → 422 {chave.em.ponto: [mensagem]}', () => {
  const REGEX_INVALIDA = 'The regex is invalid.';
  const base = (): Regra => ({ name: 'ok', match: { path: { equals: '/a' } }, response: { status: 200 } });

  const casos: Array<[string, Regra, string, string | RegExp | null]> = [
    ['nome ausente', { match: { path: { equals: '/a' } } }, '0.name', null],
    ['nome vazio', { ...base(), name: '' }, '0.name', null],
    ['nome com 101 caracteres', { ...base(), name: 'n'.repeat(101) }, '0.name', null],
    ['priority 0', { ...base(), priority: 0 }, '0.priority', null],
    ['path com dois operadores', { ...base(), match: { path: { equals: '/a', prefix: '/a' } } }, '0.match.path', null],
    ['path sem operador', { ...base(), match: { path: {} } }, '0.match.path', null],
    ['regex inválida no path', { ...base(), match: { path: { regex: '([a-z' } } }, '0.match.path.regex', REGEX_INVALIDA],
    ['regex inválida na query', { ...base(), match: { query: { tipo: { regex: '*pix' } } } }, '0.match.query.tipo.regex', REGEX_INVALIDA],
    ['regex inválida no cabeçalho', { ...base(), match: { headers: { 'x-canal': { regex: '[' } } } }, '0.match.headers.x-canal.regex', REGEX_INVALIDA],
    ['regex inválida no corpo', { ...base(), match: { body: [{ regex: '(?<nome' }] } }, '0.match.body.0.regex', REGEX_INVALIDA],
    ['JSONPath inválido', { ...base(), match: { body: [{ jsonPath: { path: "$['status'" } }] } }, '0.match.body.0.jsonPath.path', null],
    ['item de corpo com dois operadores', { ...base(), match: { body: [{ contains: 'a', regex: 'a' } as never] } }, '0.match.body.0', null],
    ['status 99', { ...base(), response: { status: 99 } }, '0.response.status', null],
    ['status 600', { ...base(), response: { status: 600 } }, '0.response.status', null],
    // Os casos "not supported yet" da fase A (template, scenario, delay, dribble, fault) saíram: a
    // fase B (Anexo B) os aceita, e a validação deles está em regras-{template,cenarios,falhas}.spec.ts.
  ];

  for (const [nome, regra, chave, mensagem] of casos) {
    test(`${nome} → 422 em "${chave}"`, async ({ request, tokens }) => {
      const token = await tokens.criar();
      const res = await putRegras(request, token.uuid, [regra]);
      expect(res.status(), await res.text()).toBe(422);
      const corpo = (await res.json()) as Record<string, string[]>;
      expect(Object.keys(corpo), JSON.stringify(corpo)).toContain(chave);
      expect(corpo[chave].length).toBeGreaterThan(0);
      for (const m of corpo[chave]) expect(m).toMatch(/^[A-Z].+\.$/);
      if (typeof mensagem === 'string') expect(corpo[chave]).toEqual([mensagem]);
      else if (mensagem) expect(corpo[chave].some((m) => mensagem.test(m)), JSON.stringify(corpo[chave])).toBe(true);
    });
  }

  test('o índice na chave é o da regra inválida na lista', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const res = await putRegras(request, token.uuid, [base(), { ...base(), response: { status: 700 } }]);
    expect(res.status()).toBe(422);
    const corpo = (await res.json()) as Record<string, string[]>;
    expect(Object.keys(corpo)).toEqual(['1.response.status']);
  });

  test('mais de 100 regras → 422 {"rules": [...]}', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const regras = Array.from({ length: 101 }, (_, i) => ({ name: `r${i}` }));
    const res = await putRegras(request, token.uuid, regras);
    expect(res.status()).toBe(422);
    expect(await res.json()).toEqual({ rules: ['The rules may not have more than 100 items.'] });
  });

  test('422 não mexe nas regras salvas', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const salvas = await salvarRegras(request, token.uuid, [base()]);
    const res = await putRegras(request, token.uuid, [base(), { ...base(), match: { path: { regex: '(' } } }]);
    expect(res.status()).toBe(422);
    expect(await lerRegras(request, token.uuid)).toEqual(salvas);
  });
});
