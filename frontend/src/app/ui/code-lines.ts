/** Pedaço de uma linha com a classe de realce. */
export type CodeTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'text';

export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
  /** No valor escalar do JSON formatado, o JSONPath dele (`$.data.itens[0].sku`). */
  path?: string;
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
 * `JSON.stringify`) com realce próprio, sem o highlight.js, e com cada valor escrito como chegou:
 * número maior que 2^53, escape de texto e chave repetida não mudam. Cada marca cai na linha onde
 * começa o valor do seu JSON Pointer (subindo ao pai quando o caminho não existe, como
 * `required`). Texto que não é JSON, ou com `pretty` desligado, sai como veio, com as marcas na
 * primeira linha.
 */
export function codeLines(
  text: string,
  options: { json: boolean; pretty: boolean; marks?: readonly CodeMark[] },
): CodeLine[] {
  const marks = options.marks ?? [];
  const tree = options.json && options.pretty ? parseRaw(text) : null;
  if (!tree) {
    const lines = text
      .split('\n')
      .map((line): CodeLine => ({ tokens: [{ kind: 'text', text: line }], marks: [] }));
    lines[0].marks.push(...marks.map((mark) => mark.message));
    return lines;
  }
  const writer = new JsonWriter();
  writer.value(tree, '', 0, '', [], '$');
  for (const mark of marks) {
    writer.lines[writer.lineOf(mark.pointer)].marks.push(mark.message);
  }
  return writer.lines;
}

interface RawEntry {
  rawKey: string;
  key: string;
  value: RawNode;
}

/** JSON lido sem converter os valores: cada folha guarda o texto como veio. */
type RawNode =
  | { type: 'object'; entries: RawEntry[] }
  | { type: 'array'; items: RawNode[] }
  | { type: 'scalar'; kind: 'string' | 'number' | 'literal'; raw: string };

/** Árvore do JSON, ou `null` quando o texto não é JSON (quem decide é o `JSON.parse`). */
function parseRaw(text: string): RawNode | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  return new RawReader(text).value();
}

/** Leitor de JSON já validado: só separa as partes, sem conferir a gramática de novo. */
class RawReader {
  private at = 0;

  constructor(private readonly text: string) {}

  value(): RawNode {
    this.space();
    const char = this.text[this.at];
    if (char === '{') {
      const entries: RawEntry[] = [];
      this.list('}', () => {
        const rawKey = this.string();
        this.space();
        this.at++; // ':'
        entries.push({ rawKey, key: JSON.parse(rawKey) as string, value: this.value() });
      });
      return { type: 'object', entries };
    }
    if (char === '[') {
      const items: RawNode[] = [];
      this.list(']', () => items.push(this.value()));
      return { type: 'array', items };
    }
    if (char === '"') {
      return { type: 'scalar', kind: 'string', raw: this.string() };
    }
    const start = this.at;
    while (this.at < this.text.length && !/[\s,\]}]/.test(this.text[this.at])) {
      this.at++;
    }
    const raw = this.text.slice(start, this.at);
    return { type: 'scalar', kind: /^[-\d]/.test(raw) ? 'number' : 'literal', raw };
  }

  /** Itens separados por vírgula até `close`, começando no caractere que abre. */
  private list(close: string, item: () => void): void {
    this.at++;
    this.space();
    while (this.text[this.at] !== close) {
      this.space();
      item();
      this.space();
      if (this.text[this.at] === ',') {
        this.at++;
      }
      this.space();
    }
    this.at++;
  }

  private string(): string {
    const start = this.at++;
    while (this.text[this.at] !== '"') {
      this.at += this.text[this.at] === '\\' ? 2 : 1;
    }
    return this.text.slice(start, ++this.at);
  }

  private space(): void {
    while (/\s/.test(this.text[this.at] ?? '')) {
      this.at++;
    }
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
    node: RawNode,
    pointer: string,
    depth: number,
    suffix: string,
    prefix: CodeToken[] = [],
    path = '$',
  ) {
    const indent = INDENT.repeat(depth);
    const lead: CodeToken[] = [{ kind: 'text', text: indent }, ...prefix];
    if (!this.pointerLines.has(pointer)) {
      this.pointerLines.set(pointer, this.lines.length);
    }
    if (node.type === 'scalar') {
      const scalar: CodeToken = { kind: node.kind, text: node.raw, path };
      this.push([...lead, scalar, ...(suffix ? [punct(suffix)] : [])]);
      return;
    }
    const children =
      node.type === 'array'
        ? node.items.map((item, index) => ({
            key: String(index),
            path: `${path}[${index}]`,
            keyTokens: [] as CodeToken[],
            value: item,
          }))
        : node.entries.map((entry) => ({
            key: entry.key,
            path: /^[A-Za-z_$][\w$]*$/.test(entry.key)
              ? `${path}.${entry.key}`
              : `${path}[${JSON.stringify(entry.key)}]`,
            keyTokens: [
              { kind: 'key', text: entry.rawKey },
              { kind: 'punct', text: ': ' },
            ] as CodeToken[],
            value: entry.value,
          }));
    const [open, close] = node.type === 'array' ? ['[', ']'] : ['{', '}'];
    if (children.length === 0) {
      this.push([...lead, punct(open + close + suffix)]);
      return;
    }
    this.push([...lead, punct(open)]);
    children.forEach((child, index) => {
      const comma = index < children.length - 1 ? ',' : '';
      const childPointer = `${pointer}/${pointerSegment(child.key)}`;
      this.value(child.value, childPointer, depth + 1, comma, child.keyTokens, child.path);
    });
    this.push([{ kind: 'text', text: indent }, punct(close + suffix)]);
  }

  private push(tokens: CodeToken[]): void {
    this.lines.push({ tokens: tokens.filter((token) => token.text !== ''), marks: [] });
  }
}

function punct(text: string): CodeToken {
  return { kind: 'punct', text };
}
