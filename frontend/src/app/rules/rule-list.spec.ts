import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { defaultResponseDetail, hitsLine, listRows } from './rule-list';

const cenario = (n: number, name: string): Rule =>
  rule(n, { scenario: { name, requiredState: 'Started' } });

describe('Dado as regras na ordem de avaliação (listRows, RULES-07)', () => {
  const shape = (rules: Rule[]) =>
    listRows(rules.map((r, index) => ({ rule: r, index }))).map((row) =>
      row.kind === 'group' ? `[${row.scenario}]` : row.item.rule.name,
    );

  it('deve pôr um cabeçalho antes de cada sequência de regras do mesmo cenário', () => {
    expect(
      shape([rule(1), cenario(2, 'entrega'), cenario(3, 'entrega'), rule(4), cenario(5, 'outro')]),
    ).toEqual(['Rule 1', '[entrega]', 'Rule 2', 'Rule 3', 'Rule 4', '[outro]', 'Rule 5']);
  });

  it('deve abrir um cabeçalho novo Quando o mesmo cenário volta depois de outra regra', () => {
    expect(shape([cenario(1, 'e'), rule(2), cenario(3, 'e')])).toEqual([
      '[e]',
      'Rule 1',
      'Rule 2',
      '[e]',
      'Rule 3',
    ]);
  });

  it('deve dar a cada linha a posição dela na ordem (para as setas e a alça)', () => {
    const rows = listRows([cenario(1, 'e'), rule(2)].map((r, index) => ({ rule: r, index })));

    expect(rows.flatMap((row) => (row.kind === 'rule' ? [row.position] : []))).toEqual([0, 1]);
  });
});

describe('Dado os hits de uma regra (hitsLine, RULES-01)', () => {
  it.each([
    [41, 0, 200, null, 'Answered 41 of the last 200'],
    [5, 1, 200, null, 'Answered 5 of the last 200 · 1 near miss'],
    [0, 3, 1, null, 'Answered 0 of the last 1 · 3 near misses'],
    [2, 0, 9, 'Started → falhou 1', 'Started → falhou 1 · Answered 2 of the last 9'],
  ])(
    'deve dizer %i respondidas e %i near misses na janela de %i',
    (answered, near, window, transition, line) => {
      expect(hitsLine(answered, near, window, transition)).toBe(line);
    },
  );
});

describe('Dado a resposta padrão da URL (defaultResponseDetail, RULES-09)', () => {
  it.each([
    ['text/plain', 0, 'When no rule matches · text/plain · no delay'],
    ['application/json', 3, 'When no rule matches · application/json · 3 s delay'],
    [null, 0, 'When no rule matches · no delay'],
  ])('deve dizer o tipo %s e o atraso %i', (contentType, timeout, detail) => {
    expect(defaultResponseDetail(contentType, timeout)).toBe(detail);
  });
});
