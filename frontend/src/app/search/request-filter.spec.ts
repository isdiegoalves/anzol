import { webhookRequest } from '../../testing/fixtures';
import {
  ValueFilter,
  answeredMatches,
  outsideWaitFor,
  filterFromParams,
  filterToParams,
  NO_FILTER,
  isFilterActive,
  sameFilter,
  searchBody,
  ciTestCommand,
  valueLabel,
  waitForCommand,
} from './request-filter';

describe('Dado o filtro da lista', () => {
  it('deve estar inativo Quando não há texto nem filtro rápido (espaços não contam)', () => {
    expect(isFilterActive(NO_FILTER)).toBe(false);
    expect(isFilterActive({ ...NO_FILTER, text: '   ' })).toBe(false);
  });

  it('deve estar ativo Quando qualquer filtro está ligado', () => {
    expect(isFilterActive({ ...NO_FILTER, text: 'pedido' })).toBe(true);
    expect(isFilterActive({ ...NO_FILTER, methods: ['GET'] })).toBe(true);
    expect(isFilterActive({ ...NO_FILTER, signature: 'invalid' })).toBe(true);
    expect(isFilterActive({ ...NO_FILTER, schema: 'valid' })).toBe(true);
  });

  it('deve ser o mesmo filtro Quando só a ordem dos métodos ou espaços nas pontas mudam', () => {
    expect(
      sameFilter(
        { ...NO_FILTER, text: ' a ', methods: ['GET', 'POST'] },
        { ...NO_FILTER, text: 'a', methods: ['POST', 'GET'] },
      ),
    ).toBe(true);
    expect(sameFilter(NO_FILTER, { ...NO_FILTER, methods: ['GET'] })).toBe(false);
  });

  it('deve montar o corpo da busca com o match das regras e a ordem da lista', () => {
    expect(
      searchBody(
        { text: ' pedido-42 ', methods: ['POST', 'PUT'], signature: 'invalid', schema: 'valid' },
        3,
      ),
    ).toEqual({
      text: 'pedido-42',
      match: { method: ['POST', 'PUT'], signature: 'invalid', schema: 'valid' },
      sorting: 'newest',
      page: 3,
      per_page: 50,
    });
  });

  it('deve deixar o texto e as condições fora Quando não estão ligados', () => {
    expect(searchBody({ ...NO_FILTER, methods: ['GET'] }, 1)).toEqual({
      match: { method: ['GET'] },
      sorting: 'newest',
      page: 1,
      per_page: 50,
    });
  });

  it('deve aceitar a assinatura ausente no match (filtro "Signature absent")', () => {
    expect(searchBody({ ...NO_FILTER, signature: 'absent' }, 1).match).toEqual({
      signature: 'absent',
    });
  });
});

describe('Dado o "Copy as anzol wait-for" (S10)', () => {
  const target = { server: 'http://localhost:8084', tokenId: 'tok-1', protected: false };

  it('deve levar só o match dos filtros, sem o texto da busca', () => {
    const filter = {
      text: 'pedido',
      methods: ['POST'],
      signature: 'invalid' as const,
      schema: 'any' as const,
    };

    expect(waitForCommand(filter, target)).toBe(
      `anzol wait-for --server 'http://localhost:8084' --token tok-1 --match '{"method":["POST"],"signature":"invalid"}'`,
    );
  });

  it('deve omitir o --match Quando não há filtro rápido', () => {
    expect(waitForCommand(NO_FILTER, target)).toBe(
      `anzol wait-for --server 'http://localhost:8084' --token tok-1`,
    );
  });

  it('deve ler o segredo da variável, nunca o escrever, Quando a URL é protegida', () => {
    expect(waitForCommand(NO_FILTER, { ...target, protected: true })).toBe(
      `anzol wait-for --server 'http://localhost:8084' --token tok-1 --read-secret "$ANZOL_READ_SECRET"`,
    );
  });

  it('deve escapar a aspa simples do servidor como no shell POSIX', () => {
    expect(waitForCommand(NO_FILTER, { ...target, server: "http://a'b" })).toContain(
      `--server 'http://a'\\''b'`,
    );
  });
});

describe('Dado o "Copy CI test"', () => {
  it('deve montar o anzol test com o servidor e o match do filtro, sem token, e a URL entre aspas', () => {
    const filter = { ...NO_FILTER, text: 'pedido', methods: ['POST'] };

    expect(ciTestCommand(filter, 'http://localhost:8084')).toBe(
      `anzol test --server 'http://localhost:8084' --match '{"method":["POST"]}' -- ./trigger.sh '{url}'`,
    );
  });

  it('deve omitir o --match Quando não há filtro que vá nele', () => {
    expect(ciTestCommand(NO_FILTER, 'http://localhost:8084')).toBe(
      `anzol test --server 'http://localhost:8084' -- ./trigger.sh '{url}'`,
    );
  });
});

describe('Dado os filtros na query da rota da Inbox', () => {
  it('deve ler assinatura, schema, métodos e texto', () => {
    expect(
      filterFromParams({ signature: 'invalid', schema: 'valid', methods: 'POST,get', q: 'abc' }),
    ).toEqual({ text: 'abc', methods: ['GET', 'POST'], signature: 'invalid', schema: 'valid' });
  });

  it('deve ignorar o valor que a tela não conhece, parâmetro a parâmetro', () => {
    expect(
      filterFromParams({ signature: 'talvez', schema: 'x', methods: 'POST,FOO', q: null }),
    ).toEqual({ text: '', methods: ['POST'], signature: 'any', schema: 'any' });
    expect(filterFromParams({})).toEqual(NO_FILTER);
  });

  it('deve levar à rota só o que está ligado', () => {
    expect(
      filterToParams({ text: 'abc', methods: ['POST'], signature: 'absent', schema: 'any' }),
    ).toEqual({
      signature: 'absent',
      schema: null,
      methods: 'POST',
      q: 'abc',
      outcome: null,
      rule: null,
      ruleName: null,
      signatureReason: null,
      schemaPath: null,
      answered: null,
      values: null,
      window: null,
    });
    expect(filterToParams(NO_FILTER)).toEqual({
      signature: null,
      schema: null,
      methods: null,
      q: null,
      outcome: null,
      rule: null,
      ruleName: null,
      signatureReason: null,
      schemaPath: null,
      answered: null,
      values: null,
      window: null,
    });
  });
});

const RULE = '11111111-2222-4333-8444-555555555555';

describe('Dado o filtro por desfecho (C2, WM-27)', () => {
  const pix = { ...NO_FILTER, outcome: { type: 'rule' as const, rule: RULE, name: 'Pix' } };

  it('deve ativar o filtro e ir na busca fora do match, sem o nome', () => {
    expect(isFilterActive(pix)).toBe(true);
    expect(searchBody(pix, 1)).toEqual({
      match: {},
      outcome: { type: 'rule', rule: RULE },
      sorting: 'newest',
      page: 1,
      per_page: 50,
    });
    expect(searchBody({ ...NO_FILTER, outcome: { type: 'default' } }, 1).outcome).toEqual({
      type: 'default',
    });
    expect(searchBody(NO_FILTER, 1)).not.toHaveProperty('outcome');
  });

  it('deve comparar o desfecho pelo tipo e pela regra', () => {
    expect(sameFilter(pix, { ...pix, outcome: { ...pix.outcome, name: 'outro nome' } })).toBe(true);
    expect(sameFilter(pix, NO_FILTER)).toBe(false);
    expect(
      sameFilter(pix, {
        ...NO_FILTER,
        outcome: { type: 'rule', rule: '99999999-2222-4333-8444-555555555555', name: 'Pix' },
      }),
    ).toBe(false);
    expect(
      sameFilter(pix, { ...NO_FILTER, outcome: { type: 'near_miss', rule: RULE, name: 'Pix' } }),
    ).toBe(false);
  });

  it('deve ir e voltar pela rota (?outcome=rule&rule=…&ruleName=…)', () => {
    expect(filterToParams(pix)).toMatchObject({ outcome: 'rule', rule: RULE, ruleName: 'Pix' });
    expect(filterFromParams({ outcome: 'rule', rule: RULE, ruleName: 'Pix' })).toEqual(pix);
    expect(filterFromParams({ outcome: 'default' })).toEqual({
      ...NO_FILTER,
      outcome: { type: 'default' },
    });
    // Tipo desconhecido ou regra que não é UUID: sem desfecho.
    expect(filterFromParams({ outcome: 'rule', rule: 'x' })).toEqual(NO_FILTER);
    expect(filterFromParams({ outcome: 'talvez' })).toEqual(NO_FILTER);
  });
});

describe('Dado o filtro pelo motivo exato (M1)', () => {
  const motivo = { ...NO_FILTER, signatureReason: 'timestamp outside tolerance' };
  const raiz = { ...NO_FILTER, schemaPath: '' };

  it('deve ativar o filtro e ir na busca no topo do corpo, fora do match', () => {
    expect(isFilterActive(motivo)).toBe(true);
    expect(isFilterActive(raiz)).toBe(true);
    expect(searchBody({ ...motivo, schemaPath: '/valor' }, 1)).toEqual({
      match: {},
      signature_reason: 'timestamp outside tolerance',
      schema_path: '/valor',
      sorting: 'newest',
      page: 1,
      per_page: 50,
    });
    // A raiz ('') é um caminho, e vai; ausente, nada.
    expect(searchBody(raiz, 1).schema_path).toBe('');
    expect(searchBody(NO_FILTER, 1)).not.toHaveProperty('schema_path');
    expect(searchBody(NO_FILTER, 1)).not.toHaveProperty('signature_reason');
  });

  it('deve comparar o motivo e o caminho, com a raiz diferente de nenhum', () => {
    expect(sameFilter(motivo, { ...motivo })).toBe(true);
    expect(sameFilter(motivo, NO_FILTER)).toBe(false);
    expect(sameFilter(raiz, NO_FILTER)).toBe(false);
    expect(sameFilter(raiz, { ...NO_FILTER, schemaPath: '/a' })).toBe(false);
  });

  it('deve ir e voltar pela rota, com a raiz como parâmetro vazio', () => {
    expect(filterToParams(motivo)).toMatchObject({
      signatureReason: 'timestamp outside tolerance',
      schemaPath: null,
      answered: null,
      values: null,
      window: null,
    });
    expect(filterToParams(raiz)).toMatchObject({ signatureReason: null, schemaPath: '' });
    expect(filterFromParams({ signatureReason: 'signature mismatch', schemaPath: '' })).toEqual({
      ...NO_FILTER,
      signatureReason: 'signature mismatch',
      schemaPath: '',
    });
  });

  it.each([
    ['$.valor', 'JSONPath'],
    ['valor', 'sem / no começo'],
    ['/a~2', '~ sem 0 ou 1'],
    [`/${'x'.repeat(1000)}`, 'mais de 1000 caracteres'],
  ])('deve ignorar o caminho %s da rota (%s), que a busca recusaria', (schemaPath) => {
    expect(filterFromParams({ schemaPath })).toEqual(NO_FILTER);
  });

  it('deve aceitar os escapes ~0 e ~1 e ignorar o motivo vazio', () => {
    expect(filterFromParams({ schemaPath: '/a~0b/c~1d' }).schemaPath).toBe('/a~0b/c~1d');
    expect(filterFromParams({ signatureReason: '' })).toEqual(NO_FILTER);
    expect(filterFromParams({ signatureReason: 'x'.repeat(300) }).signatureReason).toHaveLength(
      200,
    );
  });

  it('não deve levar ao wait-for o que ele não entende, e dizer o quê', () => {
    const tudo = {
      ...NO_FILTER,
      text: 'abc',
      methods: ['POST'],
      signature: 'invalid' as const,
      outcome: { type: 'default' as const },
      signatureReason: 'signature mismatch',
      schemaPath: '',
    };
    const command = waitForCommand(tudo, { server: 'http://x', tokenId: 't', protected: false });

    expect(command).toBe(
      `anzol wait-for --server 'http://x' --token t --match '{"method":["POST"],"signature":"invalid"}'`,
    );
    expect(command).not.toContain('signature_reason');
    expect(command).not.toContain('schema_path');
    expect(outsideWaitFor(tudo)).toEqual(['text', 'outcome', 'reason', 'path']);
    expect(outsideWaitFor({ ...NO_FILTER, methods: ['GET'] })).toEqual([]);
  });

  describe('Dado o filtro pelo status respondido', () => {
    it('deve ler da rota as classes e o status exato, e ignorar o resto', () => {
      expect(filterFromParams({ answered: '4xx,429,2xx' }).answered).toEqual(['4xx', '429', '2xx']);
      expect(filterFromParams({ answered: '9xx,42,abc,,1000' })).toEqual(NO_FILTER);
      expect(filterToParams({ ...NO_FILTER, answered: ['5xx', '503'] }).answered).toBe('5xx,503');
      expect(filterToParams(NO_FILTER).answered).toBeNull();
    });

    it('deve ser filtro ativo, fora do corpo da busca e fora do wait-for', () => {
      const filter = { ...NO_FILTER, methods: ['POST'], answered: ['4xx'] };

      expect(isFilterActive({ ...NO_FILTER, answered: ['2xx'] })).toBe(true);
      expect(sameFilter(filter, { ...filter, answered: ['5xx'] })).toBe(false);
      expect(sameFilter(filter, { ...filter })).toBe(true);
      expect(searchBody(filter, 1)).not.toHaveProperty('answered');
      expect(outsideWaitFor(filter)).toEqual(['answered']);
    });

    it.each([
      [['4xx'], 429, true],
      [['4xx'], 201, false],
      [['2xx', '5xx'], 503, true],
      [['429'], 429, true],
      [['429'], 428, false],
    ])('deve casar %j com o status %d: %s', (answered, status, expected) => {
      expect(answeredMatches(webhookRequest(1, { response: { status } }), answered)).toBe(expected);
    });

    it('deve ler da rota a janela das mais novas, e ignorar a que não é um número positivo', () => {
      expect(filterFromParams({ window: '500', signature: 'invalid' })).toEqual({
        ...NO_FILTER,
        signature: 'invalid',
        window: 500,
      });
      for (const window of ['0', '-3', 'abc', '1.5', '']) {
        expect(filterFromParams({ window })).toEqual(NO_FILTER);
      }
      expect(filterToParams({ ...NO_FILTER, window: 200 }).window).toBe('200');
      expect(filterToParams(NO_FILTER).window).toBeNull();
    });

    it('deve contar a janela como filtro, fora do corpo da busca e fora do wait-for', () => {
      const filter = { ...NO_FILTER, signature: 'invalid' as const, window: 500 };

      expect(isFilterActive({ ...NO_FILTER, window: 500 })).toBe(true);
      expect(sameFilter(filter, { ...filter, window: 200 })).toBe(false);
      expect(searchBody(filter, 1)).not.toHaveProperty('window');
      expect(outsideWaitFor(filter)).toEqual([]);
    });

    it('não deve casar a requisição sem status gravado (falha de rede, gravada antes do campo)', () => {
      const classes = ['2xx', '3xx', '4xx', '5xx'];
      expect(
        answeredMatches(webhookRequest(1, { response: { fault: 'connection_reset' } }), classes),
      ).toBe(false);
      expect(answeredMatches(webhookRequest(1, { response: null }), classes)).toBe(false);
    });
  });
});

describe('Dado os filtros por valor', () => {
  const values: ValueFilter[] = [
    { kind: 'path', name: '', value: '/pedidos' },
    { kind: 'header', name: 'x-loja-event-id', value: 'evt_1' },
    { kind: 'query', name: 'tipo', value: 'pix' },
    { kind: 'body', name: '$.status', value: 'pago' },
    { kind: 'body', name: '$.valor', value: '10' },
  ];

  it('deve levar cada valor para o match da busca e do wait-for', () => {
    const filter = { ...NO_FILTER, values };

    expect(searchBody(filter, 1).match).toEqual({
      path: { equals: '/pedidos' },
      headers: { 'x-loja-event-id': { equals: 'evt_1' } },
      query: { tipo: { equals: 'pix' } },
      body: [
        { jsonPath: { path: '$.status', equals: 'pago' } },
        { jsonPath: { path: '$.valor', equals: '10' } },
      ],
    });
    expect(isFilterActive(filter)).toBe(true);
    expect(outsideWaitFor(filter)).toEqual([]);
  });

  it('deve dizer no endereço só quantos são, e nunca o valor', () => {
    const params = filterToParams({ ...NO_FILTER, values });

    expect(params.values).toBe('5');
    expect(JSON.stringify(params)).not.toContain('evt_1');
    expect(filterToParams(NO_FILTER).values).toBeNull();
    expect(filterFromParams({ values: '5' })).toEqual(NO_FILTER);
  });

  it('deve distinguir os filtros pelos valores', () => {
    const one = { ...NO_FILTER, values: values.slice(0, 1) };

    expect(sameFilter(one, { ...NO_FILTER, values: values.slice(0, 1) })).toBe(true);
    expect(sameFilter(one, { ...NO_FILTER, values: values.slice(1, 2) })).toBe(false);
    expect(sameFilter(one, NO_FILTER)).toBe(false);
  });

  it('deve escrever o chip como a frase das condições de Regras', () => {
    expect(values.map(valueLabel)).toEqual([
      'path = /pedidos',
      'header x-loja-event-id = evt_1',
      'query tipo = pix',
      'body $.status = pago',
      'body $.valor = 10',
    ]);
  });
});
