import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { changedFields, diffRules, mergeRules } from './rule-diff';

describe('Dado a diferença do import (E-07)', () => {
  it('deve separar iguais, alteradas, apagadas e novas pelo id (o nome pode repetir)', () => {
    const salvas = [rule(1), rule(2), rule(3, { name: 'Rule 1' })];
    const arquivo = [
      rule(1),
      rule(2, { response: { ...rule(2).response, status: 503 } }),
      { ...rule(4), id: undefined },
      rule(5),
    ];

    const diff = diffRules(salvas, arquivo);

    expect(diff.unchanged.map(({ id }) => id)).toEqual(['r1']);
    expect(diff.changed).toEqual([{ rule: arquivo[1], fields: ['response.status 202 → 503'] }]);
    expect(diff.removed.map(({ id }) => id)).toEqual(['r3']);
    expect(diff.added).toEqual([arquivo[2], arquivo[3]]);
    expect(mergeRules(salvas, diff)).toEqual([...salvas, arquivo[2], arquivo[3]]);
  });

  it('deve tratar null, vazio e ausente como iguais (o arquivo pode vir sem os padrões do servidor)', () => {
    const semCenario: Rule = { ...rule(1) };
    delete semCenario.scenario;
    const escrita = { ...semCenario, response: { status: 201 } };

    expect(changedFields(rule(1), escrita)).toEqual([]);
  });

  it('deve dizer de → para em valor simples e só o grupo quando a forma muda', () => {
    const antes = rule(1);
    const depois = rule(1, {
      name: 'Pix pago',
      match: { ...antes.match, path: { prefix: '/pix' } },
    });

    expect(changedFields(antes, depois)).toEqual(['name "Rule 1" → "Pix pago"', 'match.path']);
  });

  it('deve mostrar o padrão do servidor como valor Quando o campo volta a ele', () => {
    const antes = rule(1, { response: { status: 503 } });

    expect(changedFields(antes, rule(1))).toEqual(['response.status 503 → 201']);
    expect(changedFields(antes, { ...rule(1), response: {} })).toEqual([
      'response.status 503 → 200',
    ]);
  });

  it('deve contar como nova a segunda regra do arquivo com o mesmo id', () => {
    const diff = diffRules([rule(1)], [rule(1), rule(1, { name: 'Outra' })]);

    expect(diff.unchanged).toHaveLength(1);
    expect(diff.added.map(({ name }) => name)).toEqual(['Outra']);
  });
});
