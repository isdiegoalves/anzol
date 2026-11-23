import fc from 'fast-check';
import { ruleArbitrary } from '../../testing/rule-arbitraries';
import { RULE_DEFAULT_PRIORITY, RULE_DEFAULT_STATUS, Rule } from './rule';
import { changedFields, diffRules } from './rule-diff';

const ids = fc.constantFrom('r1', 'r2', 'r3', '');

function withoutDefaults(rule: Rule): Rule {
  const copy: Rule = { ...rule, response: { ...rule.response } };
  delete copy.enabled;
  delete copy.priority;
  delete copy.chance;
  delete copy.scenario;
  delete copy.response?.status;
  delete copy.response?.body;
  delete copy.response?.template;
  return copy;
}

function withDefaults(rule: Rule): Rule {
  return {
    ...rule,
    enabled: true,
    priority: RULE_DEFAULT_PRIORITY,
    chance: null,
    scenario: null,
    response: { ...rule.response, status: RULE_DEFAULT_STATUS, body: '', template: false },
  };
}

function isSubsequence(part: readonly Rule[], whole: readonly Rule[]): boolean {
  let at = 0;
  for (const rule of part) {
    at = whole.indexOf(rule, at) + 1;
    if (at === 0) {
      return false;
    }
  }
  return true;
}

describe('Dado propriedades da diferença do import (E-07)', () => {
  it('deve achar a regra igual a ela mesma depois de exportada e importada em JSON', () => {
    fc.assert(
      fc.property(ruleArbitrary(), (rule) => {
        expect(changedFields(rule, JSON.parse(JSON.stringify(rule)) as Rule)).toEqual([]);
      }),
    );
  });

  it('deve tratar o padrão do servidor, null e o campo ausente como o mesmo valor', () => {
    fc.assert(
      fc.property(ruleArbitrary(), (rule) => {
        expect(changedFields(withDefaults(rule), withoutDefaults(rule))).toEqual([]);
        expect(changedFields(withoutDefaults(rule), withDefaults(rule))).toEqual([]);
      }),
    );
  });

  it('deve ignorar o id e achar mudança nos dois sentidos ou em nenhum', () => {
    fc.assert(
      fc.property(ruleArbitrary(), ruleArbitrary(), (a, b) => {
        expect(changedFields(a, { ...a, id: `${a.id ?? ''}-outro` })).toEqual([]);
        expect(changedFields(a, b).length === 0).toBe(changedFields(b, a).length === 0);
      }),
    );
  });

  it('deve pôr cada regra do arquivo em um só grupo, na ordem do arquivo', () => {
    fc.assert(
      fc.property(
        fc.array(ruleArbitrary(ids), { maxLength: 5 }),
        fc.array(ruleArbitrary(ids), { maxLength: 5 }),
        (saved, incoming) => {
          const diff = diffRules(saved, incoming);
          const changed = diff.changed.map(({ rule }) => rule);
          const savedIds = new Set(saved.map(({ id }) => id).filter(Boolean));
          const matched = new Set(incoming.map(({ id }) => id).filter((id) => savedIds.has(id)));
          const firstWithSavedId = (rule: Rule, i: number) =>
            savedIds.has(rule.id) && incoming.findIndex(({ id }) => id === rule.id) === i;

          expect(diff.added).toEqual(incoming.filter((rule, i) => !firstWithSavedId(rule, i)));
          expect([...diff.unchanged, ...changed, ...diff.added]).toHaveLength(incoming.length);
          for (const group of [diff.unchanged, changed, diff.added]) {
            expect(isSubsequence(group, incoming)).toBe(true);
          }
          expect(diff.changed.every(({ fields }) => fields.length > 0)).toBe(true);
          expect(diff.removed).toEqual(saved.filter(({ id }) => !id || !matched.has(id)));
        },
      ),
    );
  });

  it('deve achar iguais todas as regras quando o arquivo é o export das salvas', () => {
    fc.assert(
      fc.property(fc.array(ruleArbitrary(), { maxLength: 5 }), (rules) => {
        const saved = rules.map((rule, i) => ({ ...rule, id: `r${i}` }));

        const diff = diffRules(saved, JSON.parse(JSON.stringify(saved)) as Rule[]);

        expect(diff.unchanged).toHaveLength(saved.length);
        expect([...diff.changed, ...diff.removed, ...diff.added]).toEqual([]);
      }),
    );
  });
});
