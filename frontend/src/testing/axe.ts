import axe from 'axe-core';

/** As regras WCAG 2.2 A/AA do E2E (`e2e/support/a11y.ts`); as de boa prática olham a página inteira e ficam com ele. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Axe num componente renderizado (docs/padroes-angular.md §7): nenhuma violação WCAG 2.2 A/AA.
 * Contraste fica com o E2E: o jsdom não calcula cor nem leiaute.
 */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const { violations } = await axe.run(container, {
    runOnly: { type: 'tag', values: TAGS },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(
    violations.map(
      (v) =>
        `${v.impact} ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`,
    ),
  ).toEqual([]);
}
