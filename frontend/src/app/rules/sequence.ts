import { PathMatcher, RULE_DEFAULT_PRIORITY, Rule, SCENARIO_STARTED } from './rule';
import { catchAllPlacement } from './rule-shadow';

/** O que o assistente pede (WM-32): as condições uma vez, "responder A por N vezes, depois B". */
export interface SequenceSpec {
  methods: string[];
  path: PathMatcher | null;
  /** Quantas vezes a primeira resposta sai antes da final (1–20). */
  times: number;
  first: { status: number; body: string; retryAfter?: number | null };
  /** A resposta que fica: a última regra não define estado novo. */
  final: { status: number; body: string };
  scenario: string;
}

/** Teto de regras por URL (o servidor responde 422 acima dele). */
export const RULES_MAX = 100;
export const TIMES_MAX = 20;
/** "{scenario} 20/21" cabe nos 100 caracteres do nome da regra. */
export const SCENARIO_NAME_MAX = 94;
export const RETRY_AFTER_MAX = 3600;

/** Os estados da sequência: Started, "{name} 2" … "{name} N+1" (nomes de estado não se traduzem). */
export function sequenceStates(scenario: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? SCENARIO_STARTED : `${scenario} ${i + 1}`,
  );
}

/**
 * As N+1 regras encadeadas: "{name} i/n" exige o estado i e leva ao i+1; a última exige o estado
 * a que a penúltima leva e não define estado novo, então a resposta final fica (contrato de
 * cenário). Todas com a mesma prioridade e as mesmas condições.
 */
export function sequenceRules(spec: SequenceSpec, priority: number): Rule[] {
  const count = spec.times + 1;
  const states = sequenceStates(spec.scenario, count);
  const retryAfter = spec.first.retryAfter;
  return states.map((state, i) => {
    const last = i === count - 1;
    const answer = last ? spec.final : spec.first;
    const headers: Record<string, string> =
      last || retryAfter == null ? {} : { 'Retry-After': String(retryAfter) };
    return {
      name: `${spec.scenario} ${i + 1}/${count}`,
      enabled: true,
      priority,
      match: { method: spec.methods, path: spec.path, query: {}, headers: {}, body: [] },
      scenario: last
        ? { name: spec.scenario, requiredState: state }
        : { name: spec.scenario, requiredState: state, newState: states[i + 1] },
      response: {
        status: answer.status,
        headers,
        body: answer.body,
      },
    };
  });
}

/** O nome do cenário sugerido: o último pedaço do caminho ("/api/pagamentos" → "pagamentos"). */
export function suggestScenarioName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? 'sequence';
}

/**
 * A lista com as regras da sequência contíguas, antes da primeira pega-tudo ligada e com a
 * prioridade dela (E-01), ou no fim com P5.
 */
export function insertSequence(
  rules: readonly Rule[],
  spec: SequenceSpec,
): { rules: Rule[]; priority: number } {
  const placement = catchAllPlacement(rules);
  const priority = placement?.priority ?? RULE_DEFAULT_PRIORITY;
  const next = [...rules];
  next.splice(placement?.index ?? next.length, 0, ...sequenceRules(spec, priority));
  return { rules: next, priority };
}
