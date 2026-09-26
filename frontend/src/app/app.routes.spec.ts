import { UrlSegment } from '@angular/router';
import { inboxMatcher, rulesMatcher } from './app.routes';

const TOKEN = '3dbd68f4-8890-4f56-affb-c7c9b297e666';
const REQUEST = '0691864a-71ef-4de5-953b-518660fe6287';

const segments = (...paths: string[]) => paths.map((path) => new UrlSegment(path, {}));
const params = (paths: string[]) => {
  const result = inboxMatcher(segments(...paths));
  return (
    result &&
    Object.fromEntries(Object.entries(result.posParams ?? {}).map(([k, v]) => [k, v.path]))
  );
};

describe('Dado o casamento de rotas da tela principal', () => {
  it.each([
    ['a raiz', [], {}],
    ['só o token', [TOKEN], { tokenId: TOKEN }],
    [
      'token, mensagem e página',
      [TOKEN, REQUEST, '3'],
      { tokenId: TOKEN, requestId: REQUEST, page: '3' },
    ],
  ])('deve casar com os parâmetros certos Quando a URL é %s', (_caso, paths, esperado) => {
    expect(params(paths)).toEqual(esperado);
  });

  it.each([
    ['token que não é UUID', ['abc']],
    ['mensagem que não é UUID', [TOKEN, 'abc', '1']],
    ['página não numérica', [TOKEN, REQUEST, 'x']],
    ['dois segmentos', [TOKEN, REQUEST]],
    ['página vazia', [TOKEN, REQUEST, '']],
  ])('não deve casar Quando a URL tem %s', (_caso, paths) => {
    expect(params(paths)).toBeNull();
  });
});

describe('Dado o casamento da rota da aba de regras', () => {
  it('deve casar e dar o token Quando a URL é /{token}/rules', () => {
    const result = rulesMatcher(segments(TOKEN, 'rules'));

    expect(result?.posParams?.['tokenId'].path).toBe(TOKEN);
  });

  it.each([
    ['token que não é UUID', ['abc', 'rules']],
    ['outro segundo segmento', [TOKEN, 'regras']],
    ['só o token', [TOKEN]],
    ['segmento a mais', [TOKEN, 'rules', 'x']],
  ])('não deve casar Quando a URL tem %s', (_caso, paths) => {
    expect(rulesMatcher(segments(...paths))).toBeNull();
  });
});
