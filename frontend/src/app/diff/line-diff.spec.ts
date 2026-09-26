import { diffLines, onlyDifferences } from './line-diff';

describe('Dado o diff de linhas', () => {
  it('deve marcar a linha removida da A e a adicionada na B, com o número em cada lado', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'equal', text: 'a', lineA: 1, lineB: 1 },
      { kind: 'removed', text: 'b', lineA: 2, lineB: null },
      { kind: 'added', text: 'B', lineA: null, lineB: 2 },
      { kind: 'equal', text: 'c', lineA: 3, lineB: 3 },
    ]);
  });

  it('deve dar só linhas iguais Quando os textos são iguais', () => {
    expect(diffLines('x\ny', 'x\ny').every((line) => line.kind === 'equal')).toBe(true);
  });

  it('deve esconder as iguais e contar quantas Quando é "Only differences"', () => {
    const rows = diffLines('1\n2\n3\n4\n5', '1\n2\nX\n4\n5');

    expect(onlyDifferences(rows)).toEqual([
      { kind: 'skipped', count: 2 },
      { kind: 'removed', text: '3', lineA: 3, lineB: null },
      { kind: 'added', text: 'X', lineA: null, lineB: 3 },
      { kind: 'skipped', count: 2 },
    ]);
  });
});
