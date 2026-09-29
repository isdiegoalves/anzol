import { UrlSegment } from '@angular/router';
import {
  checksMatcher,
  compareMatcher,
  inboxMatcher,
  insightsMatcher,
  outboundMatcher,
  ruleMatcher,
  routes,
  rulesMatcher,
} from './app.routes';

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

describe('Dado o casamento da rota da aba de saída', () => {
  it('deve casar e dar o token Quando a URL é /{token}/outbound', () => {
    const result = outboundMatcher(segments(TOKEN, 'outbound'));

    expect(result?.posParams?.['tokenId'].path).toBe(TOKEN);
  });

  it.each([
    ['token que não é UUID', ['abc', 'outbound']],
    ['a aba de regras', [TOKEN, 'rules']],
    ['segmento a mais', [TOKEN, 'outbound', 'x']],
  ])('não deve casar Quando a URL tem %s', (_caso, paths) => {
    expect(outboundMatcher(segments(...paths))).toBeNull();
  });
});

describe('Dado as rotas novas da interface (item 14)', () => {
  const posParams = (result: ReturnType<typeof compareMatcher>) =>
    result &&
    Object.fromEntries(Object.entries(result.posParams ?? {}).map(([k, v]) => [k, v.path]));

  it.each([
    ['Checks', checksMatcher, [TOKEN, 'checks']],
    ['Insights', insightsMatcher, [TOKEN, 'insights']],
  ])('deve casar %s com o token', (_caso, matcher, paths) => {
    expect(posParams(matcher(segments(...paths)))).toEqual({ tokenId: TOKEN });
    expect(matcher(segments('abc', paths[1]))).toBeNull();
    expect(matcher(segments(...paths, 'x'))).toBeNull();
  });

  it.each([
    ['uma regra', [TOKEN, 'rules', 'r-1'], { tokenId: TOKEN, ruleId: 'r-1' }],
    ['a regra nova', [TOKEN, 'rules', 'new'], { tokenId: TOKEN, ruleId: 'new' }],
  ])('deve casar %s', (_caso, paths, esperado) => {
    expect(posParams(ruleMatcher(segments(...paths)))).toEqual(esperado);
  });

  it('não deve casar a regra Quando falta o id ou o segundo segmento não é rules', () => {
    expect(ruleMatcher(segments(TOKEN, 'rules'))).toBeNull();
    expect(ruleMatcher(segments(TOKEN, 'regras', 'x'))).toBeNull();
  });

  it('deve casar o Compare com as duas mensagens e recusar id que não é UUID', () => {
    expect(posParams(compareMatcher(segments(TOKEN, 'compare', REQUEST, REQUEST)))).toEqual({
      tokenId: TOKEN,
      a: REQUEST,
      b: REQUEST,
    });
    expect(compareMatcher(segments(TOKEN, 'compare', REQUEST, 'x'))).toBeNull();
    expect(compareMatcher(segments(TOKEN, 'compare', REQUEST))).toBeNull();
  });
});

describe('Dado a saída de Regras com alterações não salvas (E-04)', () => {
  it.each([
    ['a lista', rulesMatcher],
    ['a regra aberta', ruleMatcher],
  ])('deve perguntar à página antes de sair d%s', async (_caso, matcher) => {
    const guard = routes.find((route) => route.matcher === matcher)?.canDeactivate?.[0] as (
      page: unknown,
    ) => Promise<boolean>;
    const canLeave = vi.fn(() => Promise.resolve(false));

    const result = await guard({ canLeave });

    expect(canLeave).toHaveBeenCalled();
    expect(result).toBe(false);
  });
});

describe('Dado a saída de uma rota cuja página não está na tela (URL inexistente ou trancada)', () => {
  it.each([
    ['Regras', rulesMatcher],
    ['uma regra aberta', ruleMatcher],
    ['Verificações', checksMatcher],
  ])('deve deixar sair de %s sem perguntar a ninguém', async (_caso, matcher) => {
    const guard = routes.find((route) => route.matcher === matcher)?.canDeactivate?.[0] as (
      page: unknown,
    ) => boolean | Promise<boolean>;

    expect(await guard(null)).toBe(true);
  });
});
