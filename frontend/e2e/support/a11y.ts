import { Page, expect } from '@playwright/test';

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
  const { violations } = await (await axe(page)).analyze();
  const graves = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.impact} ${v.id} (${v.help}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    );
  expect(graves, `axe em ${contexto}`).toEqual([]);
}
