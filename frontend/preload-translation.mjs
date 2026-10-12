#!/usr/bin/env node
// Depois do `ng build`: põe no index.html o trecho que pede o chunk da tradução junto com o `main` para quem vai
// ver a tela em pt-BR. O `ng build` não emite esse preload: o chunk só é importado depois que o `main` roda.
//   node preload-translation.mjs dist/frontend
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Roda no index.html, antes do `main` chegar. Repete a escolha do idioma do `main.ts` (o `languageOf` de
 * `src/locale/locale.ts` sobre a preferência lida pelo `readSetting`), que só existe dentro do pacote:
 * `src/locale/preload-translation.spec.ts` falha quando as duas divergem.
 */
function preloadTranslation(chunk) {
  let chosen;
  try {
    chosen = JSON.parse(localStorage.getItem('language'));
  } catch {}
  const browser = navigator.languages
    .map((tag) => tag.toLowerCase().split('-')[0])
    .find((base) => base === 'en' || base === 'pt');
  if (chosen === 'pt-BR' || (chosen !== 'en' && browser === 'pt')) {
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = chunk;
    document.head.append(link);
  }
}

const [dist] = process.argv.slice(2);
const translations = readdirSync(dist).filter(
  (name) =>
    /^chunk-.*\.js$/.test(name) &&
    /export\s*\{[^}]*\btranslations\b/.test(readFileSync(join(dist, name), 'utf8')),
);
if (translations.length !== 1) {
  console.error(
    `preload-translation: esperava um chunk exportando "translations" em ${dist}, achei ${translations.length}`,
  );
  process.exit(1);
}
const page = join(dist, 'index.html');
const script = `<script>(${preloadTranslation})(${JSON.stringify(translations[0])})</script>`;
writeFileSync(
  page,
  readFileSync(page, 'utf8').replace('</head>', () => `${script}</head>`),
);
