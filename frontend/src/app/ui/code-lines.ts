/** Pedaço de uma linha com a classe de realce. */
export type CodeTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'text';

export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
}

/** Marca numa posição do JSON (JSON Pointer, `""` é a raiz), como os erros de schema. */
export interface CodeMark {
  pointer: string;
  message: string;
}

export interface CodeLine {
  tokens: CodeToken[];
  /** Mensagens das marcas que caem nesta linha. */
  marks: string[];
}

const INDENT = '  ';

/**
 * Linhas do texto para o `app-code-view`. JSON válido sai formatado (2 espaços, como o
 * `JSON.stringify`) com realce próprio, sem o highlight.js; cada marca cai na linha onde começa o
 * valor do seu JSON Pointer (subindo ao pai quando o caminho não existe, como `required`). Texto que
 * não é JSON, ou com `pretty` desligado, sai como veio, com as marcas na primeira linha.
 */
export function codeLines(
  text: string,
  options: { json: boolean; pretty: boolean; marks?: readonly CodeMark[] },
): CodeLine[] {
  const marks = options.marks ?? [];
  const parsed = options.json && options.pretty ? parseJson(text) : NOT_JSON;
  if (parsed === NOT_JSON) {
    const lines = text
      .split('\n')
      .map((line): CodeLine => ({ tokens: [{ kind: 'text', text: line }], marks: [] }));
    lines[0].marks.push(...marks.map((mark) => mark.message));
    return lines;
  }
  const writer = new JsonWriter();
  writer.value(parsed, '', 0, '');
  for (const mark of marks) {
    writer.lines[writer.lineOf(mark.pointer)].marks.push(mark.message);
  }
  return writer.lines;
}

const NOT_JSON = Symbol('not json');

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

/** Escapa um segmento de JSON Pointer (RFC 6901). */
function pointerSegment(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

class JsonWriter {
  readonly lines: CodeLine[] = [];
  private readonly pointerLines = new Map<string, number>();

  lineOf(pointer: string): number {
    let current = pointer;
    while (!this.pointerLines.has(current) && current !== '') {
      current = current.slice(0, current.lastIndexOf('/'));
    }
    return this.pointerLines.get(current) ?? 0;
  }

  /** Escreve o valor começando na linha atual (depois de `prefix`, ex.: a chave). */
  value(
    value: unknown,
    pointer: string,
    depth: number,
    suffix: string,
    prefix: CodeToken[] = [],
  ): void {
    const indent = INDENT.repeat(depth);
    const lead: CodeToken[] = [{ kind: 'text', text: indent }, ...prefix];
    this.pointerLines.set(pointer, this.lines.length);
    if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
      const entries: [string, unknown][] = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.entries(value as Record<string, unknown>);
      const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
      if (entries.length === 0) {
        this.push([...lead, punct(open + close + suffix)]);
        return;
      }
      this.push([...lead, punct(open)]);
      entries.forEach(([key, item], index) => {
        const comma = index < entries.length - 1 ? ',' : '';
        const childPointer = `${pointer}/${pointerSegment(key)}`;
        const keyTokens: CodeToken[] = Array.isArray(value)
          ? []
          : [
              { kind: 'key', text: JSON.stringify(key) },
              { kind: 'punct', text: ': ' },
            ];
        this.value(item, childPointer, depth + 1, comma, keyTokens);
      });
      this.push([{ kind: 'text', text: indent }, punct(close + suffix)]);
      return;
    }
    this.push([...lead, scalar(value), ...(suffix ? [punct(suffix)] : [])]);
  }

  private push(tokens: CodeToken[]): void {
    this.lines.push({ tokens: tokens.filter((token) => token.text !== ''), marks: [] });
  }
}

function punct(text: string): CodeToken {
  return { kind: 'punct', text };
}

function scalar(value: unknown): CodeToken {
  if (typeof value === 'string') {
    return { kind: 'string', text: JSON.stringify(value) };
  }
  if (typeof value === 'number') {
    return { kind: 'number', text: JSON.stringify(value) };
  }
  return { kind: 'literal', text: JSON.stringify(value) };
}
