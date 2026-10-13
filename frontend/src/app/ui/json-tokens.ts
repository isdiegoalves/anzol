import { CodeToken, CodeTokenKind } from './code-lines';

/** Texto entre aspas (até o fim da linha, se não fecha), número, literal, pontuação e o resto. */
const PIECE =
  /("(?:[^"\\\n]|\\.)*"?)(?=\s*(:)?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:]+)|[^\s"{}[\],:]+|\s+/g;

/**
 * Os pedaços do texto de um editor de JSON, com a classe de realce de cada um. Não confere a
 * gramática: o texto pela metade de quem está digitando sai inteiro e na ordem, e cada pedaço leva a
 * cor do que parece ser.
 */
export function jsonTokens(text: string): CodeToken[] {
  return Array.from(text.matchAll(PIECE), ([piece, string, colon, number, literal, punct]) => ({
    kind: kindOf(string, colon, number, literal, punct),
    text: piece,
  }));
}

function kindOf(
  string: string | undefined,
  colon: string | undefined,
  number: string | undefined,
  literal: string | undefined,
  punct: string | undefined,
): CodeTokenKind {
  if (string) {
    return colon ? 'key' : 'string';
  }
  if (number) {
    return 'number';
  }
  if (literal) {
    return 'literal';
  }
  return punct ? 'punct' : 'text';
}
