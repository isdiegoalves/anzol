/** Trecho de uma linha: texto, `código` ou **negrito**. */
export interface MdInline {
  kind: 'text' | 'code' | 'strong';
  text: string;
}

/** Bloco do markdown simples que o modelo escreve: parágrafo, título, lista ou código. */
export type MdBlock =
  | { kind: 'paragraph'; content: MdInline[] }
  | { kind: 'heading'; content: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'code'; text: string };

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const INDENTED = /^\s{2,}\S/;
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*/g;

/**
 * Markdown mínimo, feito à mão: parágrafos (quebras de linha mantidas), títulos `#`, listas
 * `-`/`*`/`1.`, blocos de código cercados por ``` e, na linha, `código` e **negrito**. O resultado
 * é uma árvore de texto que o template interpola: nada do texto do modelo vira HTML.
 */
export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) {
        code.push(lines[i]);
      }
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', content: parseInline(heading[1]) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = !!numbered;
      if (paragraph.length > 0 || (list && list.ordered !== ordered)) {
        flush();
      }
      list ??= { ordered, items: [] };
      list.items.push(item[1].trim());
      continue;
    }
    if (list && INDENTED.test(line)) {
      list.items[list.items.length - 1] += `\n${line.trim()}`;
      continue;
    }
    if (list) {
      flush();
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

export function parseInline(text: string): MdInline[] {
  const parts: MdInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) {
      parts.push({ kind: 'text', text: text.slice(last, match.index) });
    }
    parts.push(
      match[1] !== undefined
        ? { kind: 'code', text: match[1] }
        : { kind: 'strong', text: match[2] },
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: 'text', text: text.slice(last) });
  }
  return parts;
}
