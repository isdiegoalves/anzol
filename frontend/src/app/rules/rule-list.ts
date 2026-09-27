import { Rule, RuleFlag } from './rule';
import { Diagnosis } from './rule-shadow';

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
  // URL sem mensagens: "Answered 0 of the last 0" não diz nada (WM-29).
  const hits =
    window === 0
      ? $localize`No requests yet`
      : $localize`Answered ${answered}:answered: of the last ${window}:window:${nearText}:nearMisses:`;
  return transition ? `${transition} · ${hits}` : hits;
}

/** Detalhe da resposta padrão no fim da lista (C, RULES-09): tipo do corpo e atraso da URL. */
export function defaultResponseDetail(contentType: string | null, timeout: number): string {
  const delay = timeout > 0 ? $localize`${timeout}:seconds: s delay` : $localize`no delay`;
  return [$localize`When no rule matches`, ...(contentType ? [contentType] : []), delay].join(
    ' · ',
  );
}

/** Posição efetiva para o leitor de tela: "Position 3 of 7"; desligada, fora da ordem. */
export function positionLabel(position: number | null, total: number): string {
  return position === null
    ? $localize`Not in the order while off`
    : $localize`Position ${position}:position: of ${total}:total:`;
}

/** Título do "P5": o número continua (RULES-01/13), e diz como ele ordena. */
export function priorityTitle(priority: number): string {
  return $localize`Priority ${priority}:priority: · lower answers first; ties keep the list order`;
}

/** Título do "#3": o empate de prioridade, ou a frase curta do modelo. */
export function orderTitle(ties: readonly string[]): string {
  return ties.length
    ? $localize`Same priority as ${ties.join(', ')}:names:; the list order decides.`
    : checkedInOrder();
}

/** A frase curta do modelo mental (tooltip da posição e do selo "Catch-all"). */
export function checkedInOrder(): string {
  return $localize`Checked top to bottom; the first match answers.`;
}

export function catchAllFlag(): RuleFlag {
  return {
    label: 'catch-all',
    text: $localize`:rule flag|The rule has no condition and answers whatever is left:Catch-all`,
    detail: checkedInOrder(),
  };
}

/** O selo do diagnóstico, com a causa no título. */
export function diagnosisFlag(diagnosis: Diagnosis): RuleFlag {
  switch (diagnosis.kind) {
    case 'never':
      return {
        label: 'never',
        text: $localize`:rule flag|The rule can never match:Never matches`,
        detail:
          diagnosis.cause === 'state'
            ? $localize`Probably: the state can be set by hand`
            : diagnosisLine(diagnosis),
      };
    case 'shadowed':
      return {
        label: 'shadowed',
        text: $localize`:rule flag:Shadowed by ${diagnosis.by.name}:name:`,
        detail: diagnosisLine(diagnosis),
      };
    case 'likely':
      return {
        label: 'likely',
        text: $localize`:rule flag:Likely shadowed by ${diagnosis.by.name}:name:`,
        detail: diagnosisLine(diagnosis),
      };
  }
}

/** Linha 3 do item com diagnóstico: a causa, no lugar dos hits. */
export function diagnosisLine(diagnosis: Diagnosis): string {
  switch (diagnosis.kind) {
    case 'never':
      if (diagnosis.cause === 'state') {
        return $localize`No enabled rule leads to state "${diagnosis.state}:state:" — probably a typo.`;
      }
      return diagnosis.cause === 'signature'
        ? $localize`This URL does not check signatures.`
        : $localize`This URL has no schema.`;
    case 'shadowed':
      return $localize`Never answers: "${diagnosis.by.name}:name:" comes first and matches everything this rule matches.`;
    case 'likely':
      return $localize`In the last test, every request it would match was answered by "${diagnosis.by.name}:name:", which comes first.`;
  }
}

/** Título do "OFF" de uma regra desligada que, ligada, ficaria sombreada. */
export function wouldBeShadowed(by: Rule): string {
  return $localize`Would be shadowed by ${by.name}:name: if turned on`;
}

/** Linha 3 da regra desligada agora há pouco (WM-20); a que já estava desligada diz só que não roda. */
export function offLine(justTurnedOff: boolean): string {
  return justTurnedOff
    ? $localize`Off · what it answered now goes to the next matching rule, or the default response.`
    : $localize`Not checked while off`;
}

/** Filtro da lista (WM-03): texto e os dois chips. */
export interface RuleFilter {
  text: string;
  noHits: boolean;
  off: boolean;
}

export const NO_FILTER: RuleFilter = { text: '', noHits: false, off: false };

export function isFiltering(filter: RuleFilter): boolean {
  return filter.text.trim() !== '' || filter.noHits || filter.off;
}

/**
 * A regra passa no filtro: o texto (sem caixa) no nome, na linha do match (caminho), no cenário ou
 * num selo; "No hits" = nenhuma resposta na janela; "Off" = desligada.
 */
export function passesFilter(
  item: { rule: Rule; match: string; flags: readonly RuleFlag[] },
  filter: RuleFilter,
  answered: number | null,
): boolean {
  const text = filter.text.trim().toLowerCase();
  const haystack = [item.rule.name, item.match, item.rule.scenario?.name ?? '']
    .concat(item.flags.map((flag) => flag.text))
    .join('\n')
    .toLowerCase();
  return (
    (!text || haystack.includes(text)) &&
    (!filter.noHits || answered === 0) &&
    (!filter.off || item.rule.enabled === false)
  );
}
