import { diffArrays } from 'diff';

/** Linha do diff, com o número dela em cada lado (`null` no lado onde ela não existe). */
export interface DiffLine {
  kind: 'equal' | 'added' | 'removed';
  text: string;
  lineA: number | null;
  lineB: number | null;
}

/** Trecho de linhas iguais escondido pelo "Only differences". */
export interface SkippedLines {
  kind: 'skipped';
  count: number;
}

export type DiffRow = DiffLine | SkippedLines;

/**
 * Teto do Myers: dois corpos grandes e sem nada em comum custam O(N·D) e travariam a aba. Passou
 * disso, a A inteira sai como removida e a B inteira como adicionada.
 */
const DIFF_TIMEOUT_MS = 2000;

/**
 * Diff por linha (jsdiff, algoritmo de Myers): `removed` só está em A, `added` só em B. Compara
 * as listas de linhas, e não o texto, para a última linha sem `\n` não virar diferença.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const changes = diffArrays(linesA, linesB, { timeout: DIFF_TIMEOUT_MS }) ?? [
    { value: linesA, added: false, removed: true, count: linesA.length },
    { value: linesB, added: true, removed: false, count: linesB.length },
  ];
  const rows: DiffLine[] = [];
  let lineA = 1;
  let lineB = 1;
  for (const change of changes) {
    for (const text of change.value) {
      if (change.added) {
        rows.push({ kind: 'added', text, lineA: null, lineB: lineB++ });
      } else if (change.removed) {
        rows.push({ kind: 'removed', text, lineA: lineA++, lineB: null });
      } else {
        rows.push({ kind: 'equal', text, lineA: lineA++, lineB: lineB++ });
      }
    }
  }
  return rows;
}

/** Um lado de uma linha do diff lado a lado. */
export interface SideCell {
  line: number;
  text: string;
}

/**
 * Linha do diff lado a lado: `changed` junta uma removida de A com a adicionada de B na mesma
 * altura; `removed`/`added` ficam com o outro lado vazio.
 */
export interface SideRow {
  kind: 'equal' | 'changed' | 'removed' | 'added';
  a: SideCell | null;
  b: SideCell | null;
}

/**
 * As linhas do diff unificado em duas colunas: cada bloco de removidas seguido de adicionadas é
 * pareado na ordem (a primeira removida com a primeira adicionada); a sobra fica sozinha no seu
 * lado. Os trechos escondidos pelo "Only differences" passam como estão.
 */
export function sideBySide(rows: readonly DiffRow[]): (SideRow | SkippedLines)[] {
  const result: (SideRow | SkippedLines)[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  const cell = (row: DiffLine, line: number | null): SideCell => ({
    line: line ?? 0,
    text: row.text,
  });
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      const [left, right] = [removed.at(i), added.at(i)];
      result.push({
        kind: left && right ? 'changed' : left ? 'removed' : 'added',
        a: left ? cell(left, left.lineA) : null,
        b: right ? cell(right, right.lineB) : null,
      });
    }
    removed = [];
    added = [];
  };
  for (const row of rows) {
    if (row.kind === 'removed') {
      if (added.length > 0) {
        flush();
      }
      removed.push(row);
    } else if (row.kind === 'added') {
      added.push(row);
    } else {
      flush();
      result.push(
        row.kind === 'skipped'
          ? { ...row }
          : { kind: 'equal', a: cell(row, row.lineA), b: cell(row, row.lineB) },
      );
    }
  }
  flush();
  return result;
}

/** Cada sequência de linhas iguais vira um marcador com quantas foram escondidas. */
export function onlyDifferences(rows: readonly DiffLine[]): DiffRow[] {
  const result: DiffRow[] = [];
  for (const row of rows) {
    const last = result.at(-1);
    if (row.kind !== 'equal') {
      result.push(row);
    } else if (last?.kind === 'skipped') {
      last.count++;
    } else {
      result.push({ kind: 'skipped', count: 1 });
    }
  }
  return result;
}
