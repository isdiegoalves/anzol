import { Rule } from '../app/rules/rule';

/** Regra no formato normalizado que o servidor devolve, com id derivado de `n`. */
export function rule(n: number, overrides: Partial<Rule> = {}): Rule {
  return {
    id: `r${n}`,
    name: `Rule ${n}`,
    enabled: true,
    priority: 5,
    match: {
      method: ['POST'],
      path: { equals: `/r${n}` },
      query: {},
      headers: {},
      body: [],
    },
    scenario: null,
    response: {
      status: 200 + n,
      headers: {},
      body: '',
      template: false,
      delay: null,
      dribble: null,
      fault: null,
    },
    ...overrides,
  };
}
