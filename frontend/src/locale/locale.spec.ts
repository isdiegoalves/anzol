import { clearTranslations } from '@angular/localize';
import { readFileSync } from 'node:fs';
import { languageOf, loadLocale } from './locale';
import { translations } from './pt-BR';

/** Fonte das mensagens, gerada por `npx ng extract-i18n` (o teste roda na pasta do frontend). */
const messages = (
  JSON.parse(readFileSync('src/locale/messages.json', 'utf8')) as {
    translations: Record<string, string>;
  }
).translations;
/** Placeholders ({$PH}, {$INTERPOLATION}, tags) e as partes do ICU, que a tradução mantém. */
const placeholders = (text: string) =>
  (
    text.match(/\{\$[A-Za-z0-9_]+\}|VAR_PLURAL|VAR_SELECT|\{INTERPOLATION(?:_\d+)?\}/g) ?? []
  ).sort();

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

  afterEach(() => {
    document.documentElement.lang = '';
    clearTranslations();
  });

  it('deve marcar o idioma no <html> e traduzir o $localize Quando a tradução é carregada', async () => {
    await loadLocale('pt-BR');

    expect(document.documentElement.lang).toBe('pt-BR');
    expect($localize`Inbox`).toBe('Entrada');
    const count = 3;
    expect($localize`${count}:count: new requests arrived`).toBe('3 requisições novas chegaram');
    // Os chips de filtro da Inbox (os nomes da E4 em inglês).
    expect($localize`Signature absent`).toBe('Sem assinatura');
    expect($localize`Schema invalid`).toBe('Schema inválido');
  });

  it('deve ficar em inglês Quando o idioma é en', async () => {
    await loadLocale('en');

    expect(document.documentElement.lang).toBe('en');
    expect($localize`Inbox`).toBe('Inbox');
  });
});

describe('Dado o arquivo pt-BR e as mensagens extraídas (ng extract-i18n)', () => {
  it('deve traduzir toda mensagem da tela', () => {
    const missing = Object.entries(messages)
      .filter(([id]) => !(id in translations))
      .map(([, text]) => text);

    expect(missing).toEqual([]);
  });

  it('deve manter os placeholders e o ICU de cada mensagem', () => {
    const different = Object.entries(messages)
      .filter(([id]) => id in translations)
      .filter(([id, text]) => placeholders(text).join() !== placeholders(translations[id]).join())
      .map(([, text]) => text);

    expect(different).toEqual([]);
  });

  // Os verbos das ações são verbos: "Share" do detalhe é "Compartilhar" (e não "Parcela").
  it.each([
    ['Share', 'Compartilhar'],
    ['Copy', 'Copiar'],
    ['Copy payload', 'Copiar payload'],
    ['Copy As', 'Copiar como'],
    ['Explain', 'Explicar'],
  ])('deve traduzir a ação "%s" como "%s"', (source, expected) => {
    const ids = Object.entries(messages)
      .filter(([, text]) => text === source)
      .map(([id]) => id);

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.map((id) => translations[id])).toEqual(ids.map(() => expected));
  });

  it('não deve guardar traduções de mensagens que saíram da tela', () => {
    expect(Object.keys(translations).filter((id) => !(id in messages))).toEqual([]);
  });
});
