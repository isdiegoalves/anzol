import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import {
  exampleFields,
  exampleHeader,
  isJsonBody,
  jsonErrorLine,
  readAs,
  regexMatches,
  valueAtPath,
} from './rule-example';

describe('Dado a mensagem de exemplo do editor (WM-16, E-12)', () => {
  const pedido = webhookRequest(1, {
    url: `http://localhost/${TOKEN_ID}/pagamentos?env=prod`,
    headers: { 'x-tenant': ['acme'], 'content-type': ['application/json'] },
    query: { env: 'prod' },
    content: '{"id":"p2","status":"pago","valor":10,"itens":[{"sku":"a"}],"x y":true}',
  });

  it('deve listar cabeçalhos, query e folhas do corpo com o JSONPath e o literal JSON', () => {
    expect(exampleFields(pedido).map(({ kind, path, display }) => [kind, path, display])).toEqual([
      ['header', 'x-tenant', 'acme'],
      ['header', 'content-type', 'application/json'],
      ['query', 'env', 'prod'],
      ['body', '$.id', '"p2"'],
      ['body', '$.status', '"pago"'],
      ['body', '$.valor', '10'],
      ['body', '$.itens[0].sku', '"a"'],
      ['body', "$['x y']", 'true'],
    ]);
  });

  it('deve parar em 60 campos e em 4 níveis do corpo', () => {
    const muitos = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]));
    const fundo = { a: { b: { c: { d: { e: 1 } } } } };

    expect(
      exampleFields(
        webhookRequest(1, { headers: {}, query: null, content: JSON.stringify(muitos) }),
      ),
    ).toHaveLength(60);
    expect(
      exampleFields(
        webhookRequest(1, { headers: {}, query: null, content: JSON.stringify(fundo) }),
      ),
    ).toEqual([]);
  });

  it('deve achar o cabeçalho sem caixa, com _ valendo -', () => {
    expect(exampleHeader(pedido, 'X_Tenant')).toBe('acme');
    expect(exampleHeader(pedido, 'x-outro')).toBeNull();
  });

  it.each([
    ['pago', 'pix pago', false],
    ['.*pago', 'pix pago', true],
    ['pix.pago', 'pix\npago', true],
    ['(?=pix).*', 'pix pago', null],
    ['(a)\\1', 'aa', null],
    ['a++', 'aaa', null],
    ['([a-z', 'x', null],
  ])(
    'deve conferir a regex %s contra %j como o valor inteiro (ou não conferir)',
    (regex, valor, esperado) => {
      expect(regexMatches(regex, valor)).toBe(esperado);
    },
  );

  it('deve ler JSONPath simples e recusar o resto', () => {
    const corpo = pedido.content ?? '';
    expect(valueAtPath(corpo, '$.status')).toEqual({ kind: 'found', value: 'pago' });
    expect(valueAtPath(corpo, '$.itens[0].sku')).toEqual({ kind: 'found', value: 'a' });
    expect(valueAtPath(corpo, "$['x y']")).toEqual({ kind: 'found', value: true });
    expect(valueAtPath(corpo, '$.nada')).toEqual({ kind: 'missing' });
    expect(valueAtPath(corpo, '$..sku')).toEqual({ kind: 'unsupported' });
    expect(valueAtPath('não é json', '$.a')).toEqual({ kind: 'missing' });
  });

  it('deve dizer como o "Equals (JSON)" leu o valor', () => {
    expect(readAs('10')).toEqual({ kind: 'number', text: '10' });
    expect(readAs('"pago"')).toEqual({ kind: 'text', text: 'pago' });
    expect(readAs('pago')).toEqual({ kind: 'text', text: 'pago' });
    expect(readAs('{"a":1}')).toEqual({ kind: 'json' });
    expect(readAs(' ')).toBeNull();
  });

  it('deve achar a linha do JSON quebrado só Quando o corpo parece JSON', () => {
    expect(jsonErrorLine('{"a":\n')).toBe(2);
    expect(jsonErrorLine('{\n"a": 1,\n}')).toBe(3);
    expect(jsonErrorLine('{"a":1}')).toBeNull();
    expect(jsonErrorLine('ok')).toBeNull();
  });

  it('deve reconhecer corpo JSON, ignorando os {{…}} do template', () => {
    expect(isJsonBody('{"a":1}', false)).toBe(true);
    expect(isJsonBody('{"id": {{seq}}}', false)).toBe(false);
    expect(isJsonBody('{"id": {{seq}}}', true)).toBe(true);
    expect(isJsonBody('"texto"', false)).toBe(false);
  });
});
