import {
  BODY_LIMIT,
  bodyPair,
  canonicalJson,
  compareHeaders,
  compareQuery,
  compareRequestLine,
} from './request-diff';

describe('Dado o JSON canônico do diff', () => {
  it('deve dar o mesmo texto Quando só a ordem das chaves muda, em qualquer nível', () => {
    const a = '{"b":1,"a":{"y":[{"q":1,"p":2}],"x":null}}';
    const b = '{"a":{"x":null,"y":[{"p":2,"q":1}]},"b":1}';

    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('deve ordenar as chaves e indentar com 2 espaços', () => {
    expect(canonicalJson('{"b":true,"a":[1,"dois",{}],"c":{"z":[],"y":1.5}}')).toBe(
      [
        '{',
        '  "a": [',
        '    1,',
        '    "dois",',
        '    {}',
        '  ],',
        '  "b": true,',
        '  "c": {',
        '    "y": 1.5,',
        '    "z": []',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  it('deve pôr chaves numéricas em ordem de texto, como as outras Quando o objeto mistura "10", "2" e "a"', () => {
    expect(canonicalJson('{"a":0,"2":0,"10":0}')).toBe('{\n  "10": 0,\n  "2": 0,\n  "a": 0\n}');
  });

  it('deve manter a ordem dos arrays Quando os itens mudam de posição', () => {
    expect(canonicalJson('[2,1]')).not.toBe(canonicalJson('[1,2]'));
  });

  it('deve escapar texto como o JSON Quando há aspas e quebra de linha', () => {
    expect(canonicalJson('{"k\\"ey":"a\\nb"}')).toBe('{\n  "k\\"ey": "a\\nb"\n}');
  });

  it('deve devolver null Quando o conteúdo não é JSON ou está vazio', () => {
    expect(canonicalJson('nome=Ana')).toBeNull();
    expect(canonicalJson('{"a":')).toBeNull();
    expect(canonicalJson('')).toBeNull();
    expect(canonicalJson(null)).toBeNull();
  });
});

describe('Dado os corpos das duas mensagens', () => {
  it('deve comparar a forma canônica Quando os dois são JSON', () => {
    expect(bodyPair('{"b":1,"a":2}', '{"a":2,"b":1}')).toEqual({
      a: '{\n  "a": 2,\n  "b": 1\n}',
      b: '{\n  "a": 2,\n  "b": 1\n}',
      json: true,
      truncated: false,
    });
  });

  it('deve comparar o texto como chegou Quando só um dos dois é JSON', () => {
    expect(bodyPair('{"a":1}', 'a=1')).toEqual({
      a: '{"a":1}',
      b: 'a=1',
      json: false,
      truncated: false,
    });
  });

  it('deve tratar corpo ausente como vazio', () => {
    expect(bodyPair(null, 'x')).toMatchObject({ a: '', b: 'x', json: false });
  });

  it('deve cortar em 1 MB e avisar Quando um dos corpos passa do limite', () => {
    const grande = 'x'.repeat(BODY_LIMIT + 10);

    const pair = bodyPair(grande, 'y');

    expect(pair.a).toHaveLength(BODY_LIMIT);
    expect(pair.b).toBe('y');
    expect(pair.truncated).toBe(true);
  });
});

describe('Dado os headers das duas mensagens', () => {
  it('deve casar nomes sem diferenciar maiúsculas e classificar igual, diferente e ausente', () => {
    const a = {
      'Content-Type': ['application/json'],
      'X-Retry': ['1'],
      'X-Only-A': ['a'],
    };
    const b = {
      'content-type': ['application/json'],
      'x-retry': ['2'],
      'X-Only-B': ['b'],
    };

    expect(compareHeaders(a, b)).toEqual([
      { name: 'Content-Type', a: 'application/json', b: 'application/json', status: 'equal' },
      { name: 'X-Only-A', a: 'a', b: null, status: 'only-a' },
      { name: 'X-Only-B', a: null, b: 'b', status: 'only-b' },
      { name: 'X-Retry', a: '1', b: '2', status: 'different' },
    ]);
  });

  it('deve juntar os valores de um header repetido, na ordem em que chegaram', () => {
    expect(compareHeaders({ accept: ['a', 'b'] }, { Accept: ['b', 'a'] })).toEqual([
      { name: 'accept', a: 'a, b', b: 'b, a', status: 'different' },
    ]);
  });

  it('deve juntar numa linha os nomes que só diferem na caixa dentro da mesma mensagem', () => {
    expect(compareHeaders({ 'X-A': ['1'], 'x-a': ['2'] }, { 'x-A': ['1, 2'] })).toEqual([
      { name: 'X-A', a: '1, 2', b: '1, 2', status: 'equal' },
    ]);
  });

  it('deve tratar headers ausentes como nenhum header', () => {
    expect(compareHeaders(null, { host: ['x'] })).toEqual([
      { name: 'host', a: null, b: 'x', status: 'only-b' },
    ]);
  });
});

describe('Dado método e URL das duas mensagens', () => {
  it('deve marcar o que mudou', () => {
    expect(
      compareRequestLine(
        { method: 'POST', url: 'http://x/t?a=1' },
        { method: 'PUT', url: 'http://x/t?a=1' },
      ),
    ).toEqual([
      { name: 'Method', a: 'POST', b: 'PUT', status: 'different' },
      { name: 'URL', a: 'http://x/t?a=1', b: 'http://x/t?a=1', status: 'equal' },
    ]);
  });
});

describe('Dado a query string das duas mensagens', () => {
  it('deve diferenciar maiúsculas no nome e mostrar lista como JSON', () => {
    expect(compareQuery({ id: '1', tags: ['a', 'b'] }, { Id: '1', tags: ['a', 'b'] })).toEqual([
      { name: 'Id', a: null, b: '1', status: 'only-b' },
      { name: 'id', a: '1', b: null, status: 'only-a' },
      { name: 'tags', a: '["a","b"]', b: '["a","b"]', status: 'equal' },
    ]);
  });
});
