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
