import { jsonTokens } from './json-tokens';

const pieces = (text: string) => jsonTokens(text).map(({ kind, text }) => [kind, text]);
const colored = (text: string) => pieces(text).filter(([kind]) => kind !== 'text');

describe('Dado o texto de um editor de JSON (jsonTokens)', () => {
  it('deve separar chave, texto, número, literal e pontuação', () => {
    expect(colored('{"id": 42, "pago": true, "nome": "Ana", "x": null}')).toEqual([
      ['punct', '{'],
      ['key', '"id"'],
      ['punct', ':'],
      ['number', '42'],
      ['punct', ','],
      ['key', '"pago"'],
      ['punct', ':'],
      ['literal', 'true'],
      ['punct', ','],
      ['key', '"nome"'],
      ['punct', ':'],
      ['string', '"Ana"'],
      ['punct', ','],
      ['key', '"x"'],
      ['punct', ':'],
      ['literal', 'null'],
      ['punct', '}'],
    ]);
  });

  it('deve tratar como chave o texto seguido de dois-pontos, mesmo com espaço ou quebra antes', () => {
    expect(colored('"a" : "b"\n"c"\n:1')).toEqual([
      ['key', '"a"'],
      ['punct', ':'],
      ['string', '"b"'],
      ['key', '"c"'],
      ['punct', ':'],
      ['number', '1'],
    ]);
  });

  it('deve ler número negativo, decimal e com expoente, e as aspas escapadas dentro do texto', () => {
    expect(colored('[-1.5e+3, "a \\" b"]')).toEqual([
      ['punct', '['],
      ['number', '-1.5e+3'],
      ['punct', ','],
      ['string', '"a \\" b"'],
      ['punct', ']'],
    ]);
  });

  it('deve parar no fim da linha o texto sem as aspas de fechar', () => {
    expect(colored('{"type": "obj\n"required": []')).toEqual([
      ['punct', '{'],
      ['key', '"type"'],
      ['punct', ':'],
      ['string', '"obj'],
      ['key', '"required"'],
      ['punct', ':'],
      ['punct', '[]'],
    ]);
  });

  it('não deve colorir como literal a palavra que só começa com um', () => {
    expect(colored('nullable truex')).toEqual([]);
  });

  it.each([
    '',
    '{{"type": ',
    '{\n  "type": "object",\n  "required": ["id"]\n}\n',
    'isto não é JSON: -, "aberto',
    '\t{"a":\r\n1}',
  ])('deve devolver o texto inteiro, na ordem, sem perder caractere: %j', (text) => {
    expect(
      jsonTokens(text)
        .map((token) => token.text)
        .join(''),
    ).toBe(text);
  });
});
