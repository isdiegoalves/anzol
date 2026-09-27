import { Rule, RuleRef, evaluationOrder } from './rule';

/** Regra salva que continuaria respondendo, antes do rascunho, e em quantas mensagens. */
export interface EarlierRule {
  id: string;
  name: string;
  count: number;
}

/**
 * O que o rascunho mudaria nas mensagens que ele casa (S8): quantas passariam a ter a resposta
 * dele e quantas continuariam com a regra que respondeu na época, por vir antes na avaliação.
 */
export interface PriorityPreview {
  draft: number;
  /** Das que passariam ao rascunho, quantas eram da resposta padrão (RULES-21). */
  fromDefault: number;
  earlier: EarlierRule[];
}

/**
 * Prévia que respeita a prioridade, no cliente. O `rules/test` diz só quais mensagens o rascunho
 * casa; para cada uma, a regra que respondeu na época (`rule` gravado na mensagem) ainda vem antes
 * do rascunho? O rascunho entra na lista salva na posição `draftIndex` (editando) ou no fim (nova),
 * e a ordem é a do servidor: menor prioridade primeiro, empate pela lista.
 *
 * Responde o rascunho quando a mensagem foi respondida pela resposta padrão, pela própria regra em
 * edição, por uma regra que hoje vem depois dele, desligada ou apagada, ou quando a mensagem não
 * está na janela lida (`answeredBy` sem ela). O estado dos cenários não entra, como no `rules/test`.
 */
export function priorityPreview(
  rules: readonly Rule[],
  draft: Rule,
  draftIndex: number | null,
  matched: readonly string[],
  answeredBy: ReadonlyMap<string, RuleRef | null | undefined>,
): PriorityPreview {
  const list = [...rules];
  const at = draftIndex ?? list.length;
  list[at] = draft;
  const position = new Map(evaluationOrder(list).map((index, order) => [index, order]));
  const draftPosition = position.get(at) ?? 0;

  let answeredByDraft = 0;
  let fromDefault = 0;
  const earlier = new Map<string, EarlierRule>();
  for (const uuid of matched) {
    const ref = answeredBy.get(uuid);
    const index = ref ? list.findIndex((rule, i) => i !== at && rule.id === ref.id) : -1;
    const before =
      index >= 0 && list[index].enabled !== false && (position.get(index) ?? 0) < draftPosition;
    if (ref && before) {
      const entry = earlier.get(ref.id) ?? { id: ref.id, name: list[index].name, count: 0 };
      entry.count++;
      earlier.set(ref.id, entry);
    } else {
      answeredByDraft++;
      if (ref === null) {
        fromDefault++;
      }
    }
  }
  return {
    draft: answeredByDraft,
    fromDefault,
    earlier: [...earlier.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    ),
  };
}
