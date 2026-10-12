import { Locator, Page, expect } from '@playwright/test';

/**
 * Axe no E2E: WCAG 2.2 A/AA e as regras de boa prática do axe (marcos, níveis de título), e o teste falha em
 * qualquer violação, seja qual for o impacto.
 *
 * O import do `@axe-core/playwright` é dinâmico para que, sem o pacote, só os testes de acessibilidade falhem, com
 * um motivo claro, e não a carga de toda a suíte.
 */
export const TAGS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// A regra `region` pede todo o conteúdo dentro de um marco. O que o Material abre por cima (menu, aviso, lista
// suspensa) fica no `.cdk-overlay-container`, fora de todos por construção do CDK: para a regra ele vale como região,
// ao lado do que o axe já aceita assim (o diálogo e o `svg`).
const VALE_COMO_REGIAO = 'dialog, [role=dialog], [role=alertdialog], svg, .cdk-overlay-container';

const PACOTE = '@axe-core/playwright';

// O `MatSnackBar` guarda o conteúdo do aviso num `aria-hidden` pelos primeiros 150 ms, e o botão dele ("Undo") conta
// como foco escondido; depois disso o Material tira o atributo, e o aviso é medido inteiro.
const AVISO_AINDA_NAO_ANUNCIADO = '.mat-mdc-snack-bar-label > [aria-hidden="true"]';

/** O que abre por cima da página e pode fechar antes de o teste acabar: diálogo, folha, menu e lista suspensa. */
const POR_CIMA = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

interface Violacao {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target: unknown[] }[];
}

interface Analise {
  withTags(tags: string[]): Analise;
  exclude(seletor: string): Analise;
  setLegacyMode(legado: boolean): Analise;
  analyze(): Promise<{ violations: Violacao[] }>;
}

type AxeBuilder = new (opcoes: { page: Page; axeSource: string }) => Analise;

async function axe(page: Page): Promise<Analise> {
  let modulo: { default?: AxeBuilder };
  let nucleo: { default?: { source: string }; source?: string };
  try {
    modulo = (await import(PACOTE)) as { default?: AxeBuilder };
    nucleo = (await import('axe-core')) as typeof nucleo;
  } catch (erro) {
    throw new Error(`${PACOTE} não está instalado: rode npm ci em frontend/.`, { cause: erro });
  }
  const Construtor = modulo.default ?? (modulo as unknown as AxeBuilder);
  // Modo legado: o axe não abre a aba em branco em que junta os resultados. No meio de um teste ela apareceria para
  // quem espera a aba nova de um link.
  // A opção de uma conferência não entra pelo construtor: vai junto com o código do axe que ele injeta na página.
  const ajuste = { checks: [{ id: 'region', options: { regionMatcher: VALE_COMO_REGIAO } }] };
  const fonte = (nucleo.default ?? nucleo).source ?? '';
  return new Construtor({ page, axeSource: `${fonte}\n;axe.configure(${JSON.stringify(ajuste)});` })
    .withTags([...TAGS_WCAG, 'best-practice'])
    .exclude(AVISO_AINDA_NAO_ANUNCIADO)
    .setLegacyMode(true);
}

// O axe é um só por documento, e duas medidas ao mesmo tempo se atropelam: cada página tem a sua fila.
const filas = new WeakMap<Page, Promise<unknown>>();

function naFila<T>(page: Page, medida: () => Promise<T>): Promise<T> {
  const resultado = (filas.get(page) ?? Promise.resolve()).then(medida, medida);
  filas.set(
    page,
    resultado.catch(() => undefined),
  );
  return resultado;
}

/** Roda o axe na página inteira e exige zero violações, listando as que houver. */
export async function expectSemViolacoes(page: Page, contexto: string): Promise<void> {
  expect(await naFila(page, () => medir(page)), `axe em ${contexto}`).toEqual([]);
}

async function medir(page: Page): Promise<string[]> {
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
  const snackbars = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.mat-mdc-snack-bar-container')].map((snackbar) =>
        Number(getComputedStyle(snackbar).opacity),
      ),
    );
  const antes = await snackbars();
  let achadas = await violacoes(page);
  const depois = await snackbars();
  // O snackbar que começa a sair durante a medição é medido no meio do fade: espera ele sumir e mede de novo. O que
  // segue opaco do começo ao fim é medido de verdade.
  if (depois.length < antes.length || depois.some((opacidade) => opacidade < 1)) {
    await page.waitForFunction(
      () => document.querySelectorAll('.mat-mdc-snack-bar-container').length === 0,
    );
    achadas = await violacoes(page);
  }
  return achadas;
}

async function violacoes(page: Page): Promise<string[]> {
  const { violations } = await (await axe(page)).analyze();
  return violations.map(
    (v) => `${v.impact} ${v.id} (${v.help}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

interface JanelaVigiada {
  __abriuPorCima(): Promise<void>;
  __olharPorCima?(): Promise<unknown>;
}

export interface PorCima {
  /** Espera as medidas a caminho e entrega o que elas acharam desde a última vez. */
  colher(): Promise<string[]>;
  /** Deixa de medir o que abrir daqui em diante e espera a medida que já começou acabar. */
  parar(): Promise<void>;
}

/**
 * Mede com o axe cada diálogo, folha, menu ou lista suspensa que abre, sem parar o teste. Como o teste segue agindo
 * enquanto o axe roda, só conta a violação que duas medidas seguidas viram: a que pega uma animação no meio não se
 * repete.
 */
export async function vigiarOQueAbrePorCima(page: Page): Promise<PorCima> {
  const achadas = new Set<string>();
  let pedida = false;
  let parado = false;
  await page.exposeBinding('__abriuPorCima', () => {
    if (pedida || parado) {
      return;
    }
    pedida = true;
    naFila(page, async () => {
      pedida = false;
      if (parado) {
        return;
      }
      const primeira = await medir(page);
      if (primeira.length > 0 && !parado) {
        const segunda = await medir(page);
        primeira.filter((violacao) => segunda.includes(violacao)).forEach((v) => achadas.add(v));
      }
    }).catch(() => undefined); // a página fechou ou recarregou no meio da medida
  });
  await page.addInitScript((seletor) => {
    const janela = window as unknown as JanelaVigiada;
    const vistos = new WeakSet<Element>();
    let marcado = false;
    const olhar = () => {
      marcado = false;
      const novos = [...document.querySelectorAll(seletor)].filter(
        (aberto) => !vistos.has(aberto) && aberto.getClientRects().length > 0,
      );
      novos.forEach((aberto) => vistos.add(aberto));
      return Promise.all(novos.map(() => janela.__abriuPorCima()));
    };
    janela.__olharPorCima = olhar;
    new MutationObserver(() => {
      if (!marcado) {
        marcado = true;
        setTimeout(() => void olhar(), 100);
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'hidden', 'class', 'style'],
    });
  }, POR_CIMA);
  return {
    async colher() {
      // A página avisa com 100 ms de atraso. O que abriu logo antes da colheita ainda não pediu a medida: sem
      // este pedido ela começaria depois, sem ninguém esperar, e pegaria o contexto fechando no fim do teste.
      await page.evaluate(() => (window as unknown as JanelaVigiada).__olharPorCima?.());
      await naFila(page, () => Promise.resolve());
      const vistas = [...achadas];
      achadas.clear();
      return vistas;
    },
    async parar() {
      parado = true;
      await naFila(page, () => Promise.resolve());
    },
  };
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
