import { Locator, Page, expect } from '@playwright/test';

/**
 * Axe no E2E (CA-2 do item 14): WCAG 2.2 A/AA, e o teste falha em violação `serious` ou `critical`.
 *
 * `@axe-core/playwright` é dependência que a E0 instala (§2 do plano do item 14). O import é dinâmico para que,
 * sem o pacote, só os testes de acessibilidade falhem, com um motivo claro, e não a carga de toda a suíte.
 */
export const TAGS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const PACOTE = '@axe-core/playwright';

interface Violacao {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target: unknown[] }[];
}

interface Analise {
  withTags(tags: string[]): Analise;
  analyze(): Promise<{ violations: Violacao[] }>;
}

type AxeBuilder = new (opcoes: { page: Page }) => Analise;

async function axe(page: Page): Promise<Analise> {
  let modulo: { default?: AxeBuilder };
  try {
    modulo = (await import(PACOTE)) as { default?: AxeBuilder };
  } catch (erro) {
    throw new Error(`${PACOTE} não está instalado; a E0 do item 14 instala a dependência.`, {
      cause: erro,
    });
  }
  const Construtor = modulo.default ?? (modulo as unknown as AxeBuilder);
  return new Construtor({ page }).withTags(TAGS_WCAG);
}

/** Roda o axe na página inteira e exige zero violações `serious`/`critical`, listando as que houver. */
export async function expectSemViolacoesGraves(page: Page, contexto: string): Promise<void> {
  // O axe mede cor no meio de uma transição (ex.: o `mat-error` em fade-in) e acusaria contraste falso. Espera as
  // animações finitas acabarem; as infinitas (um spinner) não acabam e não entram na conta.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animacao) =>
          animacao.playState !== 'running' || animacao.effect?.getTiming().iterations === Infinity,
      ),
  );
  // O snackbar do Material começa com opacidade 0 (antes da classe de entrada) e só depois anima até 1; nesse meio o
  // `getAnimations()` pode estar vazio. Espera todo snackbar na tela estar opaco (os que saem somem do DOM).
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.mat-mdc-snack-bar-container')].every(
      (snackbar) => getComputedStyle(snackbar).opacity === '1',
    ),
  );
  const { violations } = await (await axe(page)).analyze();
  const graves = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.impact} ${v.id} (${v.help}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    );
  expect(graves, `axe em ${contexto}`).toEqual([]);
}

/**
 * Os alvos de clique ou toque dentro da região menores que `minimo` px em largura ou altura (WCAG 2.5.8 com 24,
 * toque com 44), como "papel "nome" L×A". Campo de texto vale pela caixa que o envolve sozinha; link no meio de uma
 * frase fica de fora (a exceção "em linha" da 2.5.8), e a caixa de marcar vale pelo rótulo.
 */
export function alvosMenores(regiao: Locator, minimo: number): Promise<string[]> {
  return regiao.evaluate((raiz, limite) => {
    const seletor =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], ' +
      '[role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="separator"][tabindex]';
    const menores: string[] = [];
    for (const el of raiz.querySelectorAll<HTMLElement>(seletor)) {
      if (el.closest('[aria-hidden="true"], [inert]') || (el as HTMLButtonElement).disabled) {
        continue;
      }
      const estilo = getComputedStyle(el);
      if (
        estilo.display === 'none' ||
        estilo.visibility === 'hidden' ||
        estilo.pointerEvents === 'none'
      ) {
        continue;
      }
      let caixa = el.getBoundingClientRect();
      if (el.matches('input[type="checkbox"], input[type="radio"]')) {
        const rotulo =
          el.closest('label') ??
          (el.id ? raiz.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        caixa = rotulo?.getBoundingClientRect() ?? caixa;
      } else if (el.matches('input, textarea, select')) {
        let envolve: HTMLElement = el;
        while (envolve.parentElement && envolve.parentElement !== raiz) {
          const pai = envolve.parentElement;
          const doPai = pai.getBoundingClientRect();
          if (
            pai.querySelectorAll(seletor).length !== 1 ||
            doPai.height > 72 ||
            doPai.width > caixa.width + 96
          ) {
            break;
          }
          envolve = pai;
        }
        caixa = envolve.getBoundingClientRect();
      }
      if (caixa.width <= 2 || caixa.height <= 2) {
        continue;
      }
      const emLinha =
        el.tagName === 'A' &&
        [...(el.parentElement?.childNodes ?? [])].some(
          (no) => no.nodeType === Node.TEXT_NODE && (no.textContent ?? '').trim().length > 1,
        );
      if (!emLinha && (caixa.width < limite || caixa.height < limite)) {
        const nome = (el.getAttribute('aria-label') ?? el.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        menores.push(
          `${el.getAttribute('role') ?? el.tagName.toLowerCase()} "${nome.slice(0, 60)}" ${Math.round(caixa.width)}×${Math.round(caixa.height)}`,
        );
      }
    }
    return menores;
  }, minimo);
}
