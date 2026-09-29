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

/** Campos da fase B de uma regra sem template, atraso, dribble, falha nem cenário. */
const SEM_FASE_B = {
  template: false,
  delayType: 'none',
  delayFixed: 1000,
  delayMin: 500,
  delayMax: 2000,
  delayMedian: 1000,
  delaySigma: 0.5,
  dribble: false,
  dribbleChunks: 5,
  dribbleDuration: 2000,
  fault: 'none',
  scenarioName: '',
  requiredState: '',
  newState: '',
} as const;

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
      signature: 'any',
      schema: 'any',
      chance: null,
      windowMode: 'always',
      windowMinutes: 15,
      activeFrom: '',
      activeUntil: '',
      status: 201,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      responseBody: '{"ok":true}',
      ...SEM_FASE_B,
    });
  });

  it('deve voltar à mesma regra, com os campos que a tela não edita, Quando o formulário não muda', () => {
    expect(fromFormValue(toFormValue(completa), completa)).toEqual(completa);
  });

  it('deve gravar o match vazio no formato normalizado do servidor e manter o id Quando o formulário esvazia as condições', () => {
    const form: RuleFormValue = {
      ...toFormValue(completa),
      methods: [],
      path: '',
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
      pathMode: 'equals',
      path: '',
      status: 200,
      responseBody: '',
    });
  });
});

describe('Dado template, atraso, dribble, falha e cenário no formulário (fase B)', () => {
  const comResposta = (response: Partial<Rule['response']>, scenario: Rule['scenario'] = null) => ({
    ...completa,
    scenario,
    response: { ...completa.response, ...response },
  });

  it.each([
    ['atraso fixo', { delay: { fixed: 300 } }, { delayType: 'fixed', delayFixed: 300 }],
    [
      'atraso uniforme',
      { delay: { uniform: { min: 100, max: 900 } } },
      { delayType: 'uniform', delayMin: 100, delayMax: 900 },
    ],
    [
      'atraso log-normal',
      { delay: { lognormal: { median: 700, sigma: 0.25 } } },
      { delayType: 'lognormal', delayMedian: 700, delaySigma: 0.25 },
    ],
    [
      'template e dribble',
      { template: true, dribble: { chunks: 10, durationMs: 3000 } },
      { template: true, dribble: true, dribbleChunks: 10, dribbleDuration: 3000 },
    ],
  ])('deve preencher e devolver a mesma regra Quando ela tem %s', (_caso, resposta, campos) => {
    const regra = comResposta(resposta);

    const form = toFormValue(regra);

    expect(form).toMatchObject(campos);
    expect(fromFormValue(form, regra)).toEqual(regra);
  });

  it('deve preencher e devolver o cenário com os estados exigido e novo', () => {
    const regra = comResposta(
      {},
      { name: 'Retry', requiredState: 'Started', newState: 'falhou-1' },
    );

    const form = toFormValue(regra);

    expect(form).toMatchObject({
      scenarioName: 'Retry',
      requiredState: 'Started',
      newState: 'falhou-1',
    });
    expect(fromFormValue(form, regra)).toEqual(regra);
  });

  it('deve omitir os estados vazios e gravar cenário nulo Quando o nome fica vazio', () => {
    const base = toFormValue(completa);

    expect(
      fromFormValue({ ...base, scenarioName: 'Retry', requiredState: ' ', newState: '' }, completa)
        .scenario,
    ).toEqual({ name: 'Retry' });
    expect(
      fromFormValue({ ...base, scenarioName: '', requiredState: 'Started' }, completa).scenario,
    ).toBeNull();
  });

  it('deve gravar a falha e descartar atraso e dribble (ignorados pelo servidor) Quando há falha', () => {
    const form = {
      ...toFormValue(completa),
      fault: 'malformed_chunk',
      delayType: 'fixed',
      dribble: true,
    } as const;

    const response = fromFormValue(form, completa).response;

    expect(response).toMatchObject({ fault: 'malformed_chunk', delay: null, dribble: null });
    expect(response?.status).toBe(201);
  });

  it('deve gravar atraso e dribble nulos Quando o tipo é "none" e o dribble está desligado', () => {
    const regra = comResposta({ delay: { fixed: 1 }, dribble: { chunks: 2, durationMs: 1 } });
    const form = { ...toFormValue(regra), delayType: 'none', dribble: false } as const;

    expect(fromFormValue(form, regra).response).toMatchObject({ delay: null, dribble: null });
  });
});

describe('Dado a condição de assinatura no formulário', () => {
  it.each(['valid', 'invalid', 'absent'] as const)(
    'deve preencher e devolver a condição "%s"',
    (condicao) => {
      const regra: Rule = { ...completa, match: { ...completa.match, signature: condicao } };

      const form = toFormValue(regra);

      expect(form.signature).toBe(condicao);
      expect(fromFormValue(form, regra)).toEqual(regra);
    },
  );

  it('deve omitir a condição, e não gravar nula, Quando o formulário volta para "any"', () => {
    const regra: Rule = { ...completa, match: { ...completa.match, signature: 'invalid' } };

    const gravada = fromFormValue({ ...toFormValue(regra), signature: 'any' }, regra);

    expect(gravada.match).toEqual(completa.match);
    expect(gravada.match && 'signature' in gravada.match).toBe(false);
  });

  it.each([
    ['ausente', completa],
    ['nula', { ...completa, match: { ...completa.match, signature: null } }],
  ])('deve começar em "any" Quando a condição é %s', (_caso, regra) => {
    expect(toFormValue(regra).signature).toBe('any');
  });

  it.each(['valid', 'invalid', 'absent', null])(
    'deve aceitar no JSON a condição %s',
    (condicao) => {
      const texto = JSON.stringify({ name: 'a', match: { signature: condicao } });

      expect(parseRuleJson(texto).errors).toEqual([]);
    },
  );
});

describe('Dado a condição de schema no formulário', () => {
  it.each(['valid', 'invalid'] as const)(
    'deve preencher e devolver a condição "%s"',
    (condicao) => {
      const regra: Rule = { ...completa, match: { ...completa.match, schema: condicao } };

      const form = toFormValue(regra);

      expect(form.schema).toBe(condicao);
      expect(fromFormValue(form, regra)).toEqual(regra);
    },
  );

  it('deve omitir a condição, e não gravar nula, Quando o formulário volta para "any"', () => {
    const regra: Rule = { ...completa, match: { ...completa.match, schema: 'valid' } };

    const gravada = fromFormValue({ ...toFormValue(regra), schema: 'any' }, regra);

    expect(gravada.match).toEqual(completa.match);
    expect(gravada.match && 'schema' in gravada.match).toBe(false);
  });

  it.each([
    ['ausente', completa],
    ['nula', { ...completa, match: { ...completa.match, schema: null } }],
  ])('deve começar em "any" Quando a condição é %s', (_caso, regra) => {
    expect(toFormValue(regra).schema).toBe('any');
  });

  it.each(['valid', 'invalid', null])('deve aceitar no JSON a condição %s', (condicao) => {
    const texto = JSON.stringify({ name: 'a', match: { schema: condicao } });

    expect(parseRuleJson(texto).errors).toEqual([]);
  });

  it.each(['absent', 'ok', true])('deve recusar no JSON a condição %s', (condicao) => {
    const texto = JSON.stringify({ name: 'a', match: { schema: condicao } });

    expect(parseRuleJson(texto).errors).toEqual(['match.schema: The selected schema is invalid.']);
  });
});

describe('Dado a chance e a janela de tempo no formulário', () => {
  const AGORA = Date.parse('2026-09-29T12:00:30.750Z');

  it('deve abrir com a chance e com as datas em "Between dates" Quando a regra tem janela', () => {
    const regra = {
      ...completa,
      chance: 30,
      active_from: '2026-09-29T12:00:00Z',
      active_until: '2099-01-01T00:00:00Z',
    };

    expect(toFormValue(regra)).toMatchObject({
      chance: 30,
      windowMode: 'dates',
      activeFrom: '2026-09-29T12:00:00Z',
      activeUntil: '2099-01-01T00:00:00Z',
    });
    expect(fromFormValue(toFormValue(regra), regra)).toEqual(regra);
  });

  it('deve abrir em "Between dates" Quando a regra só tem o fim da janela', () => {
    expect(toFormValue({ ...completa, active_until: '2099-01-01T00:00:00Z' })).toMatchObject({
      windowMode: 'dates',
      activeFrom: '',
      activeUntil: '2099-01-01T00:00:00Z',
    });
  });

  it('deve tirar as chaves da regra, e não gravá-las nulas, Quando a chance fica vazia e a janela volta a "Always"', () => {
    const regra = { ...completa, chance: 30, active_from: '2026-09-29T12:00:00Z' };
    const form: RuleFormValue = { ...toFormValue(regra), chance: null, windowMode: 'always' };

    const gravada = fromFormValue(form, regra);

    expect(gravada).toEqual(completa);
    expect(Object.keys(gravada)).not.toContain('chance');
    expect(Object.keys(gravada)).not.toContain('active_from');
  });

  it('deve gravar "For the next minutes" como agora, no segundo, até agora mais N minutos', () => {
    const form: RuleFormValue = {
      ...toFormValue(completa),
      windowMode: 'minutes',
      windowMinutes: 15,
    };

    expect(fromFormValue(form, completa, AGORA)).toMatchObject({
      active_from: '2026-09-29T12:00:30Z',
      active_until: '2026-09-29T12:15:30Z',
    });
  });

  it('deve gravar só a ponta preenchida e aparar os espaços Quando é "Between dates"', () => {
    const form: RuleFormValue = {
      ...toFormValue(completa),
      windowMode: 'dates',
      activeFrom: ' 2026-09-29T09:00:00-03:00 ',
      activeUntil: '',
    };

    const gravada = fromFormValue(form, { ...completa, active_until: '2099-01-01T00:00:00Z' });

    expect(gravada['active_from']).toBe('2026-09-29T09:00:00-03:00');
    expect(Object.keys(gravada)).not.toContain('active_until');
  });

  it('deve gravar a chance como número', () => {
    const form: RuleFormValue = { ...toFormValue(completa), chance: 30 };

    expect(fromFormValue(form, completa)['chance']).toBe(30);
  });

  it.each([
    ['chance', { field: 'chance' }],
    ['active_from', { field: 'activeFrom' }],
    ['active_until', { field: 'activeUntil' }],
  ])('deve apontar o 422 de "%s" para o campo da janela', (chave, campo) => {
    expect(locateError(chave, toFormValue(completa))).toEqual(campo);
  });

  it.each([
    ['chance zero', '{"name":"a","chance":0}', 'chance: The chance must be between 1 and 100.'],
    ['chance 101', '{"name":"a","chance":101}', 'chance: The chance must be between 1 and 100.'],
    ['chance fracionária', '{"name":"a","chance":1.5}', 'chance: The chance must be an integer.'],
    ['chance em texto', '{"name":"a","chance":"20"}', 'chance: The chance must be an integer.'],
    [
      'início que não é texto',
      '{"name":"a","active_from":1759147200}',
      'active_from: The active from must be an ISO-8601 date-time with a time zone, like 2026-09-29T12:00:00Z.',
    ],
  ])('deve recusar no JSON a %s', (_caso, texto, erro) => {
    expect(parseRuleJson(texto).errors).toEqual([erro]);
  });

  it('deve aceitar no JSON chance e janela nulas', () => {
    const texto = '{"name":"a","chance":null,"active_from":null,"active_until":null}';

    expect(parseRuleJson(texto).errors).toEqual([]);
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
    ['match.signature', { field: 'signature' }],
    ['match.schema', { field: 'schema' }],
    ['response.status', { field: 'status' }],
    ['response.headers.Content-Type', { list: 'responseHeaders', index: 0, field: 'value' }],
    ['response.body', { field: 'responseBody' }],
    ['response.template', { field: 'template' }],
    ['response.delay.fixed', { field: 'delayFixed' }],
    ['response.delay.uniform.min', { field: 'delayMin' }],
    ['response.delay.uniform.max', { field: 'delayMax' }],
    ['response.delay.lognormal.median', { field: 'delayMedian' }],
    ['response.delay.lognormal.sigma', { field: 'delaySigma' }],
    ['response.delay', { field: 'delayType' }],
    ['response.dribble.chunks', { field: 'dribbleChunks' }],
    ['response.dribble.durationMs', { field: 'dribbleDuration' }],
    ['response.fault', { field: 'fault' }],
    ['scenario.name', { field: 'scenarioName' }],
    ['scenario.requiredState', { field: 'requiredState' }],
    ['scenario.newState', { field: 'newState' }],
    ['scenario', { field: 'scenarioName' }],
  ])('deve apontar "%s" para o campo do formulário', (chave, campo) => {
    expect(locateError(chave, form)).toEqual(campo);
  });

  it('deve apontar o erro do atraso inteiro para o parâmetro do tipo escolhido', () => {
    expect(locateError('response.delay', { ...form, delayType: 'uniform' })).toEqual({
      field: 'delayMin',
    });
  });

  it.each([
    ['campo sem lugar no formulário', 'response.outro'],
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

  it('deve aceitar a regra Quando tem template, atraso no teto, dribble, falha e cenário', () => {
    const faseB: Rule = {
      ...completa,
      scenario: { name: 'Retry', requiredState: 'Started', newState: null },
      response: {
        template: true,
        delay: { lognormal: { median: 60000, sigma: 0.5 } },
        dribble: { chunks: 100, durationMs: 0 },
        fault: 'random_data_then_close',
      },
    };

    expect(parseRuleJson(JSON.stringify(faseB)).errors).toEqual([]);
  });

  it.each([
    ['hang', ''],
    ['stall_after_headers', '{"ok":true}'],
    ['truncated_body', '{"ok":true}'],
  ])('deve aceitar a falha "%s" Quando o corpo é "%s"', (fault, body) => {
    const texto = JSON.stringify({ name: 'a', response: { fault, body } });

    expect(parseRuleJson(texto).errors).toEqual([]);
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
    [
      'template que não é booleano',
      '{"name":"a","response":{"template":"sim"}}',
      /^response\.template: /,
    ],
    [
      'atraso com dois tipos',
      '{"name":"a","response":{"delay":{"fixed":1,"uniform":{"min":1,"max":2}}}}',
      /^response\.delay: .*exactly one of fixed, uniform, lognormal/,
    ],
    [
      'atraso acima do teto de 60 s',
      '{"name":"a","response":{"delay":{"fixed":60001}}}',
      /^response\.delay\.fixed: .*between 0 and 60000/,
    ],
    [
      'atraso uniforme com mínimo acima do máximo',
      '{"name":"a","response":{"delay":{"uniform":{"min":900,"max":100}}}}',
      /^response\.delay\.uniform\.max: .*at least the min/,
    ],
    [
      'log-normal sem sigma',
      '{"name":"a","response":{"delay":{"lognormal":{"median":100}}}}',
      /^response\.delay\.lognormal\.sigma: /,
    ],
    [
      'dribble com 101 pedaços',
      '{"name":"a","response":{"dribble":{"chunks":101,"durationMs":10}}}',
      /^response\.dribble\.chunks: .*between 1 and 100/,
    ],
    [
      'falha desconhecida',
      '{"name":"a","response":{"fault":"explode"}}',
      /^response\.fault: .*connection_reset, empty_response, malformed_chunk, random_data_then_close/,
    ],
    ['cenário sem nome', '{"name":"a","scenario":{"newState":"x"}}', /^scenario\.name: .*required/],
    [
      'condição de assinatura desconhecida',
      '{"name":"a","match":{"signature":"ok"}}',
      /^match\.signature: The selected signature is invalid\.$/,
    ],
    [
      'estado de cenário que não é texto',
      '{"name":"a","scenario":{"name":"s","requiredState":1}}',
      /^scenario\.requiredState: /,
    ],
    [
      'a falha "stall_after_headers" sem corpo',
      '{"name":"a","response":{"fault":"stall_after_headers"}}',
      /^response\.body: The body field is required when fault is stall_after_headers\.$/,
    ],
    [
      'a falha "truncated_body" com corpo vazio',
      '{"name":"a","response":{"fault":"truncated_body","body":""}}',
      /^response\.body: The body field is required when fault is truncated_body\.$/,
    ],
  ])('deve apontar o erro Quando o JSON tem %s', (_caso, texto, erro) => {
    const { errors } = parseRuleJson(texto);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(erro);
  });
});
