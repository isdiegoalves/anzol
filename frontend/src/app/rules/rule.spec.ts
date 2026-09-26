import { Rule, evaluationOrder, matchSummary } from './rule';

const rule = (fields: Partial<Rule>): Rule => ({ name: 'r', ...fields });

describe('Dado o resumo do match na lista de regras', () => {
  it.each([
    [
      'método e caminho igual',
      { method: ['POST'], path: { equals: '/pagamentos' } },
      'POST /pagamentos',
    ],
    [
      'dois métodos e prefixo',
      { method: ['GET', 'HEAD'], path: { prefix: '/api' } },
      'GET, HEAD /api*',
    ],
    ['sem método e regex', { path: { regex: '^/v\\d+' } }, 'ANY ~ ^/v\\d+'],
    ['lista de métodos vazia e sem caminho', { method: [] }, 'ANY (any path)'],
  ])('deve resumir %s', (_caso, match, esperado) => {
    expect(matchSummary(rule({ match }))).toBe(esperado);
  });

  it('deve resumir como qualquer método e caminho Quando a regra não tem match', () => {
    expect(matchSummary(rule({}))).toBe('ANY (any path)');
  });
});

describe('Dado a ordem em que o servidor avalia as regras', () => {
  it('deve pôr a menor prioridade primeiro e manter a ordem da lista no empate', () => {
    const rules = [
      rule({ priority: 5 }),
      rule({ priority: 1 }),
      rule({}), // sem prioridade vale 5
      rule({ priority: 1 }),
    ];

    expect(evaluationOrder(rules)).toEqual([1, 3, 0, 2]);
  });

  it('deve devolver lista vazia Quando não há regras', () => {
    expect(evaluationOrder([])).toEqual([]);
  });
});
