import { diffLines, onlyDifferences, sideBySide } from './line-diff';

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

describe('Dado o diff lado a lado', () => {
  it('deve parear a removida com a adicionada na ordem, na mesma altura', () => {
    expect(sideBySide(diffLines('a\nb\nc\nd', 'a\nB\nB2\nd'))).toEqual([
      { kind: 'equal', a: { line: 1, text: 'a' }, b: { line: 1, text: 'a' } },
      { kind: 'changed', a: { line: 2, text: 'b' }, b: { line: 2, text: 'B' } },
      { kind: 'changed', a: { line: 3, text: 'c' }, b: { line: 3, text: 'B2' } },
      { kind: 'equal', a: { line: 4, text: 'd' }, b: { line: 4, text: 'd' } },
    ]);
  });

  it('deve deixar a sobra sozinha no seu lado e passar os trechos escondidos', () => {
    expect(sideBySide(onlyDifferences(diffLines('a\nx\nb', 'a\nb\ny')))).toEqual([
      { kind: 'skipped', count: 1 },
      { kind: 'removed', a: { line: 2, text: 'x' }, b: null },
      { kind: 'skipped', count: 1 },
      { kind: 'added', a: null, b: { line: 3, text: 'y' } },
    ]);
  });

  it('deve abrir outro par Quando uma removida vem depois de adicionadas', () => {
    const rows = [
      { kind: 'added' as const, text: 'n', lineA: null, lineB: 1 },
      { kind: 'removed' as const, text: 'o', lineA: 1, lineB: null },
    ];

    expect(sideBySide(rows).map((row) => row.kind)).toEqual(['added', 'removed']);
  });
});
