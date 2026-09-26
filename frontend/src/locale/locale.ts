import { loadTranslations } from '@angular/localize';

/** Idiomas da tela. O inglês é o dos textos no código; os outros vêm de uma tradução. */
export const LANGUAGES = ['en', 'pt-BR'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Chave do `localStorage` com o idioma escolhido em Settings (JSON, como as outras preferências). */
export const LANGUAGE_KEY = 'language';

/**
 * O idioma escolhido em Settings; sem escolha, o primeiro do navegador que a tela tem (`pt-PT`
 * também cai no pt-BR); senão inglês.
 */
export function languageOf(chosen: unknown, browser: readonly string[]): Language {
  if (LANGUAGES.includes(chosen as Language)) {
    return chosen as Language;
  }
  for (const tag of browser) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'en') {
      return 'en';
    }
    if (base === 'pt') {
      return 'pt-BR';
    }
  }
  return 'en';
}

/**
 * Carrega a tradução antes do `bootstrapApplication` (tradução em runtime: um build só). A tradução
 * vem por `import()`, em chunk próprio: quem usa a tela em inglês não a baixa. O app continua
 * importado estaticamente pelo `main.ts`, para o orçamento do pacote inicial medir o que conta.
 */
export async function loadLocale(language: Language): Promise<void> {
  document.documentElement.lang = language;
  if (language === 'pt-BR') {
    const { translations } = await import('./pt-BR');
    loadTranslations(translations);
  }
}
