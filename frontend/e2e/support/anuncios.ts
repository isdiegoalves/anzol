import { Page } from '@playwright/test';
import { expect } from './fixtures';

export interface Anuncio {
  texto: string;
  /** Nome do `role="group"` em volta da região viva, ou "". */
  regiao: string;
  nome: string;
  papel: string;
  /** A região apareceu no DOM já com o texto: o leitor de tela não a anuncia. */
  nasceuComTexto: boolean;
}

/**
 * Grava cada texto não vazio que uma região viva (`status`, `alert`, `aria-live`) recebe desde a carga. O que
 * está sob `aria-hidden="true"` não conta, como para o leitor de tela.
 */
export async function escutarAnuncios(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const janela = window as unknown as { __anuncios: unknown[] };
    janela.__anuncios = [];
    const VIVAS = '[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]';
    const vistos = new WeakMap<Element, string>();
    const texto = (el: Element): string => {
      if (el.closest('[aria-hidden="true"]')) {
        return '';
      }
      const copia = el.cloneNode(true) as Element;
      copia.querySelectorAll('[aria-hidden="true"]').forEach((no) => no.remove());
      return (copia.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    const nome = (el: Element): string => {
      const rotulo = el.getAttribute('aria-label');
      if (rotulo) {
        return rotulo;
      }
      const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
      return ids
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    };
    const varrer = (): void => {
      for (const el of document.querySelectorAll(VIVAS)) {
        const atual = texto(el);
        const antes = vistos.get(el);
        if (antes === atual) {
          continue;
        }
        vistos.set(el, atual);
        if (atual) {
          janela.__anuncios.push({
            texto: atual,
            regiao: nome(el.closest('[role="group"]') ?? el),
            nome: nome(el),
            papel: el.getAttribute('role') ?? `aria-live=${el.getAttribute('aria-live')}`,
            nasceuComTexto: antes === undefined,
          });
        }
      }
    };
    new MutationObserver(varrer).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'role', 'aria-live', 'aria-label'],
    });
  });
}

export function anunciados(page: Page): Promise<Anuncio[]> {
  return page.evaluate(
    () => (window as unknown as { __anuncios?: Anuncio[] }).__anuncios ?? [],
  ) as Promise<Anuncio[]>;
}

export async function limparAnuncios(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __anuncios: unknown[] }).__anuncios = [];
  });
}

async function comTexto(page: Page, texto: RegExp): Promise<Anuncio[]> {
  return (await anunciados(page)).filter((anuncio) => texto.test(anuncio.texto));
}

/**
 * A frase foi anunciada uma vez só, por uma região que já existia vazia. A espera de 1,2 s cobre a janela de 1 s
 * dos resumos, para pegar a repetição por outra região.
 */
export async function expectUmAnuncio(
  page: Page,
  texto: RegExp,
  regiao?: RegExp,
): Promise<Anuncio> {
  await expect
    .poll(async () => (await comTexto(page, texto)).length, {
      message: `anúncio ${String(texto)}`,
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(1_200);
  const achados = await comTexto(page, texto);
  expect(
    achados.map((a) => `${a.papel} "${a.regiao}": ${a.texto}`),
    `uma ação, um anúncio: ${String(texto)}`,
  ).toHaveLength(1);
  const [anuncio] = achados;
  expect(anuncio.nasceuComTexto, 'a região viva existe vazia antes de receber o texto').toBe(false);
  if (regiao) {
    // Região viva com nome faz o leitor de tela falar o nome no lugar do texto: o nome fica no grupo em volta.
    expect(anuncio.nome, 'a região viva não tem nome').toBe('');
    expect(anuncio.regiao, 'o grupo em volta da região que anuncia').toMatch(regiao);
  }
  return anuncio;
}

export async function expectSemAnuncio(page: Page, texto: RegExp): Promise<void> {
  const achados = await comTexto(page, texto);
  expect(
    achados.map((a) => `${a.papel} "${a.regiao}": ${a.texto}`),
    `não deve anunciar ${String(texto)}`,
  ).toEqual([]);
}
