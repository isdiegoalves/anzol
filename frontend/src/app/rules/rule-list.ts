import { Rule } from './rule';

/** Regra na posição em que o servidor a avalia, com o índice dela na lista salva. */
export interface ListedRule {
  rule: Rule;
  index: number;
}

/** Linha da tabela de regras: cabeçalho de um grupo de cenário ou uma regra. */
export type ListRow<T extends ListedRule> =
  { kind: 'group'; scenario: string; key: string } | { kind: 'rule'; item: T; position: number };

/**
 * As linhas da lista na ordem de avaliação (C, RULES-07): cada sequência de regras seguidas do
 * mesmo cenário ganha um cabeçalho antes dela. `position` é a posição da regra na ordem (a das
 * setas e da alça), que o cabeçalho não conta.
 */
export function listRows<T extends ListedRule>(ordered: readonly T[]): ListRow<T>[] {
  const rows: ListRow<T>[] = [];
  let current: string | null = null;
  ordered.forEach((item, position) => {
    const scenario = item.rule.scenario?.name || null;
    if (scenario && scenario !== current) {
      rows.push({ kind: 'group', scenario, key: `group:${position}:${scenario}` });
    }
    current = scenario;
    rows.push({ kind: 'rule', item, position });
  });
  return rows;
}

/**
 * Linha 3 da regra (C, RULES-01): "Answered 41 of the last 200 · 1 near miss", com a transição
 * do cenário na frente quando a regra tem uma.
 */
export function hitsLine(
  answered: number,
  near: number,
  window: number,
  transition: string | null,
): string {
  const nearText =
    near === 0
      ? ''
      : near === 1
        ? $localize` · 1 near miss`
        : $localize` · ${near}:count: near misses`;
  const hits = $localize`Answered ${answered}:answered: of the last ${window}:window:${nearText}:nearMisses:`;
  return transition ? `${transition} · ${hits}` : hits;
}

/** Detalhe da resposta padrão no fim da lista (C, RULES-09): tipo do corpo e atraso da URL. */
export function defaultResponseDetail(contentType: string | null, timeout: number): string {
  const delay = timeout > 0 ? $localize`${timeout}:seconds: s delay` : $localize`no delay`;
  return [$localize`When no rule matches`, ...(contentType ? [contentType] : []), delay].join(
    ' · ',
  );
}
