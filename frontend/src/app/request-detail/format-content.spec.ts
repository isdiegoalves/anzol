import { formatContent, highlightContent, prettyJson, prettyXml } from './format-content';

describe('Dado o corpo de uma mensagem com "Format JSON/XML" ligado', () => {
  it('deve indentar com 2 espaços e preservar número maior que 2^53 Quando o corpo é JSON', () => {
    const corpo = '{"a":12345678901234567890,"b":[1,2],"c":"it\'s"}';

    expect(formatContent(corpo)).toBe(
      '{\n  "a": 12345678901234567890,\n  "b": [\n    1,\n    2\n  ],\n  "c": "it\'s"\n}',
    );
  });

  it('deve indentar XML como o pretty-data do app atual Quando o corpo é XML', () => {
    expect(formatContent('<a><b>1</b><c/></a>')).toBe('<a>\n  <b>1</b>\n  <c/>\n</a>');
  });

  it('deve devolver o texto como veio Quando o corpo é formulário', () => {
    expect(formatContent('f1=v1&f2=')).toBe('f1=v1&f2=');
  });

  it.each([
    ['nulo', null],
    ['vazio', ''],
  ])('deve devolver texto vazio Quando o corpo é %s', (_caso, corpo) => {
    expect(formatContent(corpo)).toBe('');
  });
});

describe('Dado o reindentador de JSON', () => {
  it.each([
    ['objeto vazio', '{ }', '{}'],
    ['lista vazia', '{"a":[ ]}', '{\n  "a": []\n}'],
    ['aspas e vírgula escapadas na string', '{"a":"x\\",y"}', '{\n  "a": "x\\",y"\n}'],
    ['número solto', ' 42 ', '42'],
  ])('deve reproduzir o JSON.stringify(…, 2) Quando o JSON tem %s', (_caso, entrada, esperado) => {
    expect(prettyJson(entrada)).toBe(esperado);
  });

  it.each([
    ['malformado', '{"a":'],
    ['string JSON', '"texto"'],
  ])('deve devolver a entrada intacta Quando o JSON é %s', (_caso, entrada) => {
    expect(prettyJson(entrada)).toBe(entrada);
  });
});

describe('Dado o reindentador de XML', () => {
  it('deve manter a declaração e aninhar os filhos Quando o XML tem prólogo', () => {
    expect(prettyXml('<?xml version="1.0"?><r><i>1</i><i>2</i></r>')).toBe(
      '<?xml version="1.0"?>\n<r>\n  <i>1</i>\n  <i>2</i>\n</r>',
    );
  });
});

describe('Dado o destaque de sintaxe', () => {
  it('deve escapar o HTML do corpo Quando o conteúdo tem tags', () => {
    expect(highlightContent('<script>x</script>')).not.toContain('<script>');
  });

  it('deve marcar as chaves do JSON Quando o conteúdo é JSON', () => {
    expect(highlightContent('{"a": 1}')).toContain('<span class="hljs-attr">&quot;a&quot;</span>');
  });
});
