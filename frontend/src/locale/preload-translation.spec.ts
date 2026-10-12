import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSetting } from '../app/settings/preferences';
import { LANGUAGE_KEY, languageOf } from './locale';

const TRANSLATION = 'chunk-TRAD1234.js';
const PAGE =
  '<!doctype html><html lang="en"><head><base href="/"></head><body><app-root></app-root>' +
  '<link rel="modulepreload" href="chunk-CORE5678.js">' +
  '<script src="main-ABCD.js" type="module"></script></body></html>';
/** O `dist` do `ng build`: a página, o `main`, que importa a tradução, e os chunks. */
const BUILD: Record<string, string> = {
  'index.html': PAGE,
  'main-ABCD.js': 'let{translations:e}=await import("./chunk-TRAD1234.js");',
  'chunk-CORE5678.js': 'var t=1;export{t as translate};',
  [TRANSLATION]: 'var a={"1":`Entrada`};export{a as translations};',
};

function distWith(files: Record<string, string>): string {
  const dist = mkdtempSync(join(tmpdir(), 'preload-translation-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dist, name), content);
  }
  return dist;
}

/** O passo do `Dockerfile` depois do `ng build` (o teste roda na pasta do frontend). */
function preload(dist: string): void {
  execFileSync(process.execPath, ['preload-translation.mjs', dist], { stdio: 'pipe' });
}

const pageOf = (dist: string) => readFileSync(join(dist, 'index.html'), 'utf8');

describe('Dado o index.html do build depois do preload-translation.mjs', () => {
  let page: string;

  beforeAll(() => {
    const dist = distWith(BUILD);
    preload(dist);
    page = pageOf(dist);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.head.replaceChildren();
  });

  /** Roda o que a página põe no `<head>` e devolve o chunk que ela mandou pedir, se mandou. */
  function preloaded(stored: string | null, browser: string[]): string | null {
    localStorage.clear();
    if (stored !== null) {
      localStorage.setItem(LANGUAGE_KEY, stored);
    }
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(browser);
    document.head.replaceChildren();
    const scripts = new DOMParser()
      .parseFromString(page, 'text/html')
      .head.querySelectorAll('script');
    for (const script of scripts) {
      const running = document.createElement('script');
      running.textContent = script.textContent;
      document.head.append(running);
    }
    return document.head.querySelector('link[rel="modulepreload"]')?.getAttribute('href') ?? null;
  }

  it.each([
    ['o navegador está em português e nada foi escolhido', null, ['pt-BR', 'en']],
    ['o pt-BR foi escolhido em Settings e o navegador está em inglês', '"pt-BR"', ['en-US']],
  ])('deve pedir o chunk da tradução Quando %s', (_caso, stored, browser) => {
    expect(preloaded(stored, browser)).toBe(TRANSLATION);
  });

  it.each([
    ['o navegador está em inglês e nada foi escolhido', null, ['en-US', 'pt-BR']],
    ['o inglês foi escolhido em Settings e o navegador está em português', '"en"', ['pt-BR']],
    ['o navegador não tem idioma da tela', null, ['de-DE', 'fr']],
  ])('não deve pedir o chunk da tradução Quando %s', (_caso, stored, browser) => {
    expect(preloaded(stored, browser)).toBeNull();
  });

  it('deve pedir a tradução exatamente nos casos em que o main.ts escolhe o pt-BR', () => {
    const storedValues = [
      null,
      '"pt-BR"',
      '"en"',
      '"klingon"',
      '"PT-BR"',
      '"pt"',
      'pt-BR',
      'undefined',
      'null',
      '',
      '1',
      'true',
      '["pt-BR"]',
      '{"language":"pt-BR"}',
    ];
    const browsers = [
      [],
      ['pt-BR'],
      ['pt-PT'],
      ['pt'],
      ['PT-br'],
      ['pt_BR'],
      ['ptx'],
      ['en-US'],
      ['EN'],
      ['en-US', 'pt-BR'],
      ['pt-BR', 'en-US'],
      ['de-DE', 'en-GB', 'pt-BR'],
      ['de-DE', 'pt-BR', 'en'],
      ['de-DE', 'fr'],
      ['fr-pt'],
    ];
    const different: string[] = [];

    for (const stored of storedValues) {
      for (const browser of browsers) {
        const asked = preloaded(stored, browser) === TRANSLATION;
        const chosen = languageOf(readSetting(LANGUAGE_KEY, null), navigator.languages) === 'pt-BR';
        if (asked !== chosen) {
          different.push(`localStorage ${stored}, navegador ${browser.join(',')}`);
        }
      }
    }

    expect(different).toEqual([]);
  });

  it('deve deixar o resto da página como o build gerou', () => {
    const added = /<script>[^<]*<\/script><\/head>/.exec(page)?.[0] ?? '';

    expect(page.replace(added, '</head>')).toBe(PAGE);
    expect(added).toContain(TRANSLATION);
  });
});

describe('Dado um build em que a tradução não está num chunk só', () => {
  it.each([
    ['nenhum chunk a exporta', { [TRANSLATION]: 'var a={};export{a as t};' }],
    ['dois chunks a exportam', { 'chunk-ES999999.js': BUILD[TRANSLATION] }],
  ])('deve falhar sem mexer na página Quando %s', (_caso, changed) => {
    const dist = distWith({ ...BUILD, ...changed });

    expect(() => preload(dist)).toThrow(/esperava um chunk exportando "translations"/);
    expect(pageOf(dist)).toBe(PAGE);
  });
});
