import { languageOf, loadLocale } from './locale';

describe('Dado o idioma da tela (tradução em runtime)', () => {
  it.each([
    ['o escolhido em Settings vence o navegador', 'pt-BR', ['en-US'], 'pt-BR'],
    ['inglês escolhido vence um navegador em português', 'en', ['pt-BR'], 'en'],
    ['sem escolha, vale o navegador em português', null, ['pt-BR', 'en'], 'pt-BR'],
    ['português de Portugal também cai no pt-BR', null, ['pt-PT'], 'pt-BR'],
    [
      'sem escolha, o primeiro idioma conhecido do navegador',
      null,
      ['de-DE', 'en-GB', 'pt-BR'],
      'en',
    ],
    ['navegador sem idioma conhecido cai no inglês', null, ['de-DE', 'fr'], 'en'],
    ['escolha gravada que não existe é ignorada', 'klingon', ['pt-BR'], 'pt-BR'],
    ['sem escolha e sem idioma do navegador', null, [], 'en'],
  ])('deve escolher o idioma certo Quando %s', (_caso, chosen, browser, expected) => {
    expect(languageOf(chosen, browser)).toBe(expected);
  });

  afterEach(() => (document.documentElement.lang = ''));

  it('deve marcar o idioma no <html> Quando a tradução é carregada', async () => {
    await loadLocale('pt-BR');

    expect(document.documentElement.lang).toBe('pt-BR');
  });
});
