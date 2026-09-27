/** Como o corpo é mostrado: JSON pelo `app-code-view`, XML/HTML com o highlight.js sob demanda. */
export type BodyLanguage = 'json' | 'xml' | 'text';

/**
 * Detecta a linguagem do corpo sem o highlight.js (fora do pacote da Inbox): JSON pelo
 * `JSON.parse`; XML ou HTML por começar com `<` e o `DOMParser` ler sem erro (ou ser um documento
 * HTML); o resto é texto.
 */
export function detectLanguage(content: string | null): BodyLanguage {
  const text = content?.trim() ?? '';
  if (text === '') {
    return 'text';
  }
  try {
    JSON.parse(text);
    return 'json';
  } catch {
    // não é JSON
  }
  if (!text.startsWith('<') || !text.endsWith('>')) {
    return 'text';
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length === 0) {
    return 'xml';
  }
  return /^<(!doctype\s+html|html)[\s>]/i.test(text) ? 'xml' : 'text';
}

/**
 * Formata o corpo como o "Format JSON/XML" do app atual: reindenta JSON (2 espaços) ou XML.
 * Qualquer outra coisa volta como veio.
 */
export function formatContent(content: string | null): string {
  if (!content) {
    return '';
  }
  switch (detectLanguage(content)) {
    case 'json':
      return prettyJson(content);
    case 'xml':
      return prettyXml(content);
    default:
      return content;
  }
}

/**
 * HTML com destaque de sintaxe de XML/HTML (o highlight.js escapa o texto). O highlight.js vem por
 * `import()`, num pedaço à parte: só quem abre um corpo XML o baixa.
 */
export async function highlightXml(content: string): Promise<string> {
  const [{ default: hljs }, { default: xml }] = await Promise.all([
    import('highlight.js/lib/core'),
    import('highlight.js/lib/languages/xml'),
  ]);
  if (!hljs.getLanguage('xml')) {
    hljs.registerLanguage('xml', xml);
  }
  return hljs.highlight(content, { language: 'xml' }).value;
}

/**
 * Reindenta JSON válido sem reconverter valores: números maiores que 2^53 saem exatamente como
 * chegaram (o app atual usa json-bigint para isso). Texto inválido volta como veio.
 */
export function prettyJson(text: string): string {
  try {
    if (typeof JSON.parse(text) === 'string') {
      return text;
    }
  } catch {
    return text;
  }
  let out = '';
  let depth = 0;
  const newline = () => `\n${'  '.repeat(depth)}`;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      let end = i + 1;
      while (text[end] !== '"') {
        end += text[end] === '\\' ? 2 : 1;
      }
      out += text.slice(i, end + 1);
      i = end;
    } else if (char === '{' || char === '[') {
      const close = char === '{' ? '}' : ']';
      const next = text.slice(i + 1).search(/\S/) + i + 1;
      if (text[next] === close) {
        out += char + close;
        i = next;
      } else {
        depth++;
        out += char + newline();
      }
    } else if (char === '}' || char === ']') {
      depth--;
      out += newline() + char;
    } else if (char === ',') {
      out += `,${newline()}`;
    } else if (char === ':') {
      out += ': ';
    } else if (!/\s/.test(char)) {
      out += char;
    }
  }
  return out;
}

/** Reindenta XML com 2 espaços, no mesmo algoritmo do `pretty-data` usado pelo app atual. */
export function prettyXml(text: string): string {
  const parts = text.replace(/>\s*</g, '><').replace(/</g, '~::~<').split('~::~');
  const tagName = (part: string) => /^<\/?([\w:.,-]+)/.exec(part)?.[1];
  let depth = 0;
  let out = '';
  const newline = (level: number) => `\n${'  '.repeat(Math.max(level, 0))}`;
  parts.forEach((part, index) => {
    const previous = parts[index - 1] ?? '';
    const opens = /<\w/.test(part);
    const closes = part.includes('</');
    const selfCloses = part.includes('/>');
    if (/^<\w/.test(previous) && /^<\/\w/.test(part) && tagName(previous) === tagName(part)) {
      out += part;
      depth--;
    } else if (opens && !closes && !selfCloses) {
      out += newline(depth++) + part;
    } else if ((opens && closes) || selfCloses || part.startsWith('<?')) {
      out += newline(depth) + part;
    } else if (closes) {
      out += newline(--depth) + part;
    } else {
      out += part;
    }
  });
  return out.startsWith('\n') ? out.slice(1) : out;
}
