import { Rule } from './rule';
import {
  RuleFormValue,
  fromFormValue,
  locateError,
  newRule,
  parseRuleJson,
  toFormValue,
} from './rule-form';

const completa: Rule = {
  id: 'a1',
  name: 'Pix pago',
  enabled: false,
  priority: 2,
  match: {
    method: ['POST'],
    path: { prefix: '/pagamentos' },
    query: { tipo: { equals: 'pix' }, debug: { present: false } },
    headers: { 'X-Signature': { present: true }, 'Content-Type': { contains: 'json' } },
    body: [
      { jsonPath: { path: '$.status', equals: 'pago' } },
      { jsonPath: { path: '$.id' } },
      { contains: 'pedido' },
      { equalToJson: { a: 1, b: [true] } },
    ],
  },
  scenario: null,
  response: {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
    body: '{"ok":true}',
    template: false,
    delay: null,
    dribble: null,
    fault: null,
  },
};

describe('Dado a conversão entre a regra e o formulário do editor', () => {
  it('deve preencher cada seção do formulário Quando a regra tem todas as condições', () => {
    const form = toFormValue(completa);

    expect(form).toEqual<RuleFormValue>({
      name: 'Pix pago',
      enabled: false,
      priority: 2,
      methods: ['POST'],
      pathMode: 'prefix',
      path: '/pagamentos',
      query: [
        { name: 'tipo', operator: 'equals', value: 'pix' },
        { name: 'debug', operator: 'absent', value: '' },
      ],
      headers: [
        { name: 'X-Signature', operator: 'present', value: '' },
        { name: 'Content-Type', operator: 'contains', value: 'json' },
      ],
      body: [
        { type: 'jsonPath', value: '', path: '$.status', equals: '"pago"' },
        { type: 'jsonPath', value: '', path: '$.id', equals: '' },
        { type: 'contains', value: 'pedido', path: '', equals: '' },
        { type: 'equalToJson', value: '{"a":1,"b":[true]}', path: '', equals: '' },
      ],
      status: 201,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      responseBody: '{"ok":true}',
    });
  });

  it('deve voltar à mesma regra, com os campos que a tela não edita, Quando o formulário não muda', () => {
    expect(fromFormValue(toFormValue(completa), completa)).toEqual(completa);
  });

  it('deve gravar o match vazio no formato normalizado do servidor e manter o id Quando o formulário esvazia as condições', () => {
    const form: RuleFormValue = {
      ...toFormValue(completa),
      methods: [],
      pathMode: 'any',
      query: [],
      headers: [],
      body: [],
    };

    const rule = fromFormValue(form, completa);

    expect(rule.id).toBe('a1');
    expect(rule.match).toEqual({ method: [], path: null, query: {}, headers: {}, body: [] });
  });

  it.each([
    ['texto', '"pago"', 'pago'],
    ['número', '10', 10],
    ['booleano', 'true', true],
    ['texto sem aspas (não é JSON)', 'pago', 'pago'],
  ])('deve gravar o equals do JSONPath como %s', (_caso, digitado, gravado) => {
    const form: RuleFormValue = {
      ...toFormValue(newRule()),
      name: 'x',
      body: [{ type: 'jsonPath', value: '', path: '$.a', equals: digitado }],
    };

    expect(fromFormValue(form, newRule()).match?.body).toEqual([
      { jsonPath: { path: '$.a', equals: gravado } },
    ]);
  });

  it('deve começar habilitada, prioridade 5 e status 200 Quando a regra é nova', () => {
    expect(toFormValue(newRule())).toMatchObject({
      name: '',
      enabled: true,
      priority: 5,
      methods: [],
      pathMode: 'any',
      status: 200,
      responseBody: '',
    });
  });
});

describe('Dado um erro 422 com a chave em notação de ponto', () => {
  const form = toFormValue(completa);

  it.each([
    ['name', { field: 'name' }],
    ['priority', { field: 'priority' }],
    ['match.method.0', { field: 'methods' }],
    ['match.path.regex', { field: 'path' }],
    ['match.query.tipo.equals', { list: 'query', index: 0, field: 'value' }],
    ['match.query.tipo', { list: 'query', index: 0, field: 'name' }],
    ['match.headers.x-signature.present', { list: 'headers', index: 0, field: 'value' }],
    ['match.body.1.jsonPath.path', { list: 'body', index: 1, field: 'path' }],
    ['match.body.0.jsonPath.equals', { list: 'body', index: 0, field: 'equals' }],
    ['match.body.3.equalToJson', { list: 'body', index: 3, field: 'value' }],
    ['response.status', { field: 'status' }],
    ['response.headers.Content-Type', { list: 'responseHeaders', index: 0, field: 'value' }],
    ['response.body', { field: 'responseBody' }],
  ])('deve apontar "%s" para o campo do formulário', (chave, campo) => {
    expect(locateError(chave, form)).toEqual(campo);
  });

  it.each([
    ['campo sem lugar no formulário', 'response.template'],
    ['cabeçalho que não está no formulário', 'match.headers.x-outro.regex'],
    ['condição de corpo além da lista', 'match.body.9.regex'],
  ])('não deve apontar campo Quando é %s', (_caso, chave) => {
    expect(locateError(chave, form)).toBeNull();
  });
});

describe('Dado o JSON cru editado na aba "JSON"', () => {
  it('deve devolver a regra Quando o JSON é uma regra válida', () => {
    expect(parseRuleJson(JSON.stringify(completa))).toEqual({ rule: completa, errors: [] });
  });

  it.each([
    ['JSON malformado', '{"name":', /^Invalid JSON/],
    ['uma lista', '[]', /^The rule must be a JSON object\.$/],
    ['sem nome', '{}', /^name: The name field is required\.$/],
    ['nome longo', JSON.stringify({ name: 'x'.repeat(101) }), /^name: .*100 characters/],
    ['prioridade zero', '{"name":"a","priority":0}', /^priority: .*at least 1/],
    [
      'caminho com dois modos',
      '{"name":"a","match":{"path":{"equals":"/a","prefix":"/b"}}}',
      /^match\.path: .*exactly one of equals, prefix, regex/,
    ],
    [
      'header com operador desconhecido',
      '{"name":"a","match":{"headers":{"X":{"starts":"a"}}}}',
      /^match\.headers\.X: .*exactly one of equals, contains, regex, present/,
    ],
    [
      'JSONPath sem path',
      '{"name":"a","match":{"body":[{"jsonPath":{}}]}}',
      /^match\.body\.0\.jsonPath\.path: /,
    ],
    [
      'status fora da faixa',
      '{"name":"a","response":{"status":99}}',
      /^response\.status: .*100 and 599/,
    ],
    [
      'header de resposta que não é texto',
      '{"name":"a","response":{"headers":{"X":1}}}',
      /^response\.headers\.X: /,
    ],
  ])('deve apontar o erro Quando o JSON tem %s', (_caso, texto, erro) => {
    const { errors } = parseRuleJson(texto);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(erro);
  });
});
