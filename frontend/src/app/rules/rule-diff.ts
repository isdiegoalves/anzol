import { RULE_DEFAULT_PRIORITY, RULE_DEFAULT_STATUS, Rule } from './rule';

/** Teto de regras por URL no servidor (`RuleParser`). */
export const RULES_MAX = 100;

/** Regra do arquivo com o mesmo id de uma salva, e os campos que mudaram. */
export interface ChangedRule {
  rule: Rule;
  /** `response.status 503 → 200` quando os dois lados são valor simples; senão, só o caminho. */
  fields: string[];
}

/** O que o import mudaria, comparando por id (o nome pode repetir). */
export interface RulesDiff {
  unchanged: Rule[];
  changed: ChangedRule[];
  /** Salvas que o arquivo não traz: somem no "Replace". */
  removed: Rule[];
  /** Sem id, ou com id que nenhuma salva tem: entram no "Merge". */
  added: Rule[];
}

type Leaf = string | number | boolean;

/** Padrões do servidor: o campo com esse valor vale o mesmo que ausente. */
const DEFAULTS: Record<string, Leaf> = {
  enabled: true,
  priority: RULE_DEFAULT_PRIORITY,
  'response.status': RULE_DEFAULT_STATUS,
  'response.body': '',
  'response.template': false,
};

/**
 * Folhas do JSON por caminho em pontos (`match.body.0.contains`). `null`, objeto e lista vazios e
 * os padrões do servidor não geram folha: valem o mesmo que o campo ausente (o servidor devolve
 * uns e o arquivo escrito à mão, outros).
 */
function leaves(value: unknown, path = '', into = new Map<string, Leaf>()): Map<string, Leaf> {
  if (value === null || value === undefined) {
    return into;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      leaves(child, path ? `${path}.${key}` : key, into);
    }
    return into;
  }
  if (DEFAULTS[path] !== value) {
    into.set(path, value as Leaf);
  }
  return into;
}

function show(value: Leaf): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Campos que mudaram de `saved` para `incoming`, na ordem da regra salva. Vários do mesmo grupo
 * (`match.path.equals` → `match.path.prefix`) viram só o grupo.
 */
export function changedFields(saved: Rule, incoming: Rule): string[] {
  const before = leaves(saved);
  const after = leaves(incoming);
  const paths = [...new Set([...before.keys(), ...after.keys()])].filter(
    (path) => path !== 'id' && before.get(path) !== after.get(path),
  );
  const fields: string[] = [];
  for (const path of paths) {
    const a = before.get(path) ?? DEFAULTS[path];
    const b = after.get(path) ?? DEFAULTS[path];
    const group = path.split('.').slice(0, 2).join('.');
    if (a !== undefined && b !== undefined) {
      fields.push(`${path} ${show(a)} → ${show(b)}`);
    } else if (!fields.includes(group)) {
      fields.push(group);
    }
  }
  return fields;
}

/** Diferença entre as regras salvas e as do arquivo, por id (E-07; a mesma da CLI e do MCP). */
export function diffRules(saved: readonly Rule[], incoming: readonly Rule[]): RulesDiff {
  const byId = new Map(saved.filter((rule) => rule.id).map((rule) => [rule.id, rule]));
  const seen = new Set<string>();
  const diff: RulesDiff = { unchanged: [], changed: [], removed: [], added: [] };
  for (const rule of incoming) {
    const match = rule.id ? byId.get(rule.id) : undefined;
    if (!match || seen.has(rule.id ?? '')) {
      diff.added.push(rule);
      continue;
    }
    seen.add(rule.id ?? '');
    const fields = changedFields(match, rule);
    if (fields.length === 0) {
      diff.unchanged.push(rule);
    } else {
      diff.changed.push({ rule, fields });
    }
  }
  diff.removed = saved.filter((rule) => !rule.id || !seen.has(rule.id));
  return diff;
}

/** "Merge": as salvas como estão, e depois as novas do arquivo. */
export function mergeRules(saved: readonly Rule[], diff: RulesDiff): Rule[] {
  return [...saved, ...diff.added];
}
