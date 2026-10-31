import { faultName, pipelineOf, routeOf } from '../pipeline/pipeline';
import { decryptionState, target } from '../pipeline/server-phrases';
import { CapturedRequest } from '../requests/webhook-request';
import {
  FAULT_SHORT_LABELS,
  RULE_DEFAULT_PRIORITY,
  Rule,
  RuleFault,
  evaluationOrder,
} from '../rules/rule';
import { RequestFilter } from '../search/request-filter';
import { SignatureProvider, Token, signatureProviderLabel } from '../token/token';
import { joinPath, reverseLine } from './pulse';

/**
 * O circuito da URL (proposta-1 §3, demo combinada): remetente → assinatura → schema → decifra → regras na ordem de
 * avaliação → resposta → reenvio. Tudo derivado da URL, das regras e das mensagens carregadas; nenhuma API nova. A
 * geometria é a da demo: um palco de 1248 × 120, linha principal em y = 60, escada de regras em x = 860.
 */
export interface CircuitInput {
  token: Token;
  /** O apelido da URL ("Pagamentos"), no nome acessível do desenho. */
  name: string;
  /** As regras da URL; `null` enquanto não chegaram (nem a escada nem "sem regras" aparecem). */
  rules: readonly Rule[] | null;
  /** A leitura das regras falhou: o circuito diz isso, e não "sem regras" com anomalias que talvez uma regra pegue. */
  rulesUnavailable?: boolean;
  /**
   * A escala do palco na faixa (`stageFit`); abaixo de 1 a escada se abre para cada linha seguir com 24 px de alvo
   * na tela (WCAG 2.5.8).
   */
  scale?: number;
  /** As mensagens que contam: as carregadas, sem filtro. */
  requests: readonly CapturedRequest[];
  /** A mensagem aberta: o caminho dela vai em tinta cheia. */
  selected: CapturedRequest | null;
  /** O filtro da lista: o nó dele leva o contorno de filtro. */
  filter: RequestFilter;
  /** No modo fluxo, quantas chegaram no último segundo: o medidor "N/s" ao lado do Remetente (F2). */
  meter?: number | null;
}

export type GlyphTone = 'ok' | 'bad' | 'near';

export interface CircuitGlyph {
  text: string;
  tone: GlyphTone;
}

/** Os tipos de rótulo da demo: título (12 px), nome da regra (12 px) e os de dado (mono 11 px). */
export type LabelKind =
  'title' | 'name' | 'sub' | 'gl' | 'note' | 'data' | 'ann' | 'near' | 'meter';

/** Um contador do rótulo: o número, que rola até o novo na chegada (C-6), e o texto em volta dele. */
export interface CircuitCount {
  value: number;
  before: string;
  after: string;
}

export interface CircuitLabel {
  key: string;
  x: number;
  y: number;
  /** Âncora horizontal: centro, esquerda ou direita do ponto. */
  align: 'c' | 'l' | 'r';
  kind: LabelKind;
  text: string;
  /** Tinta fraca (`--app-ink-2`). */
  muted: boolean;
  /** Régua de 2 px na margem: a falha em vermelho de revisão, o "quase" em âmbar. */
  rule: 'bad' | 'near' | null;
  glyph?: CircuitGlyph;
  /** O número do cartão do detalhe que corresponde ao nó (① ② ③). */
  badge?: string;
  /** O texto tem um contador: `text` é o texto inteiro, com o número. */
  count?: CircuitCount;
  /**
   * O que a mensagem aberta mostra no nó (o IP, o ✓/✗, a resposta) aparece quando o pulso chega a ele: o número de
   * saltos até o nó (0 no Remetente).
   */
  reveal?: number;
}

export interface CircuitEdge {
  id: string;
  d: string;
}

export interface CircuitMark {
  id: string;
  x: number;
  y: number;
  r: number;
  /** No caminho da mensagem aberta: contorno em tinta. */
  on: boolean;
  /** Os saltos do pulso até o nó, no caminho da mensagem aberta. */
  reveal?: number;
}

export interface CircuitNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Nome acessível: o nó, o que ele mostra e o que o Enter faz. */
  label: string;
  /** O que clicar põe no filtro; `null` nos nós que mostram todas. */
  filter: Partial<RequestFilter> | null;
  /** O que clicar de novo tira. */
  off: Partial<RequestFilter> | null;
  /** O filtro do nó está ligado (`aria-pressed`); `null` nos nós sem filtro. */
  pressed: boolean | null;
  /** O Enter abre o painel Filtros em vez de filtrar ("+N regras": as regras de lá têm chip lá, D-F1-15). */
  opens?: 'filters';
}

/** Um trecho de "caminho: …" (a linha do celular); `bad` é o ✗ de verificação, em vermelho de revisão. */
export interface PathPart {
  text: string;
  bad: boolean;
}

export interface CircuitView {
  edges: CircuitEdge[];
  /** As arestas do caminho da mensagem aberta (vazio sem mensagem). */
  route: string[];
  /**
   * O caminho da mensagem aberta em saltos, como o pulso o percorre (F2): o desenho de cada salto, na direção da
   * viagem, e em que salto cada aresta do caminho acende (1 no fim do primeiro).
   */
  hops: string[];
  lit: Record<string, number>;
  junctions: (readonly [number, number])[];
  marks: CircuitMark[];
  labels: CircuitLabel[];
  nodes: CircuitNode[];
  /** O `aria-label` do desenho: a URL, os nós e o caminho da mensagem aberta. */
  description: string;
  /** "caminho: assinatura ✓ → …" da mensagem aberta; `null` sem mensagem. */
  path: PathPart[] | null;
}

const MAIN_Y = 60;
/** Os saltos do pulso até a escada: Remetente → Assinatura → Schema → Decifra → linha da regra. */
const LADDER_HOPS = 4;
/** A linha do "quase casou", acima da escada e da Resposta (y = 24), em qualquer número de regras. */
const NEAR_Y = 9;
const X = {
  sender: 80,
  signature: 280,
  schema: 460,
  decryption: 640,
  ladder: 860,
  collector: 1060,
  response: 1140,
  resend: 1220,
} as const;
/**
 * Linhas da escada (com "padrão"), de 24 em 24 px a partir de y = 24, como na demo: cada nó da escada tem um alvo de
 * 24 px (WCAG 2.5.8). Com mais regras, as que não cabem viram "+N regras".
 */
const MAX_ROWS = 4;
const ROW_STEP = 24;
const ROW_TOP = 24;
const CIRCLED = ['①', '②', '③', '④'];

const PROVIDER_HEADERS: Record<Exclude<SignatureProvider, 'generic'>, string> = {
  stripe: 'Stripe-Signature',
  github: 'X-Hub-Signature-256',
  shopify: 'X-Shopify-Hmac-Sha256',
  slack: 'X-Slack-Signature',
};

/** As palavras do circuito: funções, porque a tradução carrega antes de elas rodarem. */
function words() {
  return {
    sender: $localize`:circuit node:Sender`,
    signature: $localize`:circuit node:Signature`,
    schema: $localize`:circuit node:Schema`,
    decryption: $localize`:circuit node:Decryption`,
    response: $localize`:circuit node:Response`,
    resend: $localize`:circuit node:Resend`,
    outbound: $localize`:circuit node, the Outbound destination where resends go:Outbound`,
    default: $localize`:circuit ladder, the URL's default response:default`,
    defaultResponse: $localize`:circuit node, the URL's default response:Default response`,
    noRules: $localize`:circuit, the URL has no rules:no rules`,
    unavailable: $localize`:circuit, the URL rules could not be read:rules unavailable`,
    signatureOff: $localize`:circuit signature|Signature check turned off:off`,
    schemaOff: $localize`:circuit schema|Schema check turned off:off`,
    decryptionOff: $localize`:circuit decryption|Decryption turned off:off`,
  };
}

interface Row {
  id: string;
  y: number;
  name: string;
  /** O nome no `aria-label` ("Regra P1 Assinatura inválida"). */
  spoken: string;
  rules: Rule[];
  ann: Omit<CircuitLabel, 'key' | 'x' | 'y' | 'align' | 'kind'>;
  filter: Partial<RequestFilter> | null;
  off: Partial<RequestFilter> | null;
  pressed: boolean | null;
  hint: string;
  /** A anotação entra no nome acessível; não quando `spoken` já diz o que ela diz. */
  annSpoken?: boolean;
  opens?: 'filters';
}

const priorityOf = (rule: Rule) => rule.priority ?? RULE_DEFAULT_PRIORITY;
const pLabel = (rule: Rule) => `P${priorityOf(rule)}`;

function signatureBad(request: CapturedRequest): boolean {
  return !!request.signature && !request.signature.valid;
}

function schemaBad(request: CapturedRequest): boolean {
  return !!request.schema && !request.schema.valid;
}

function decryptionBad(request: CapturedRequest): boolean {
  const state = request.decryption?.state;
  return state === 'invalid' || state === 'unknown_kid';
}

/** A regra pega a anomalia pela condição: a falha que ela responde é dela, e não do nó de verificação. */
function catches(rule: Rule | undefined, check: 'signature' | 'schema' | 'decryption'): boolean {
  const match = rule?.match;
  if (check === 'signature') {
    return match?.signature === 'invalid' || match?.signature === 'absent';
  }
  if (check === 'schema') {
    return match?.schema === 'invalid';
  }
  return match?.decryption === 'invalid' || match?.decryption === 'unknown_kid';
}

function catchesAny(rule: Rule): boolean {
  return catches(rule, 'signature') || catches(rule, 'schema') || catches(rule, 'decryption');
}

/** O dialeto do `$schema` da URL; o servidor valida em 2020-12 quando ele não vem. */
function dialectOf(token: Token): string {
  const uri = token.schema?.['$schema'];
  const match = typeof uri === 'string' ? /draft[/-](\d{4}-\d{2}|\d+)/.exec(uri) : null;
  if (!match) {
    return '2020-12';
  }
  return /^\d{4}-/.test(match[1]) ? match[1] : `draft-${match[1].padStart(2, '0')}`;
}

function signatureHeader(token: Token): string {
  const config = token.signature;
  if (!config) {
    return '';
  }
  return config.provider === 'generic' ? (config.header ?? '') : PROVIDER_HEADERS[config.provider];
}

function faultShort(fault: string): string {
  return FAULT_SHORT_LABELS[fault as RuleFault] ?? fault;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase() + text.slice(1);
}

/** O estado da assinatura, do schema e da decifra nas palavras de "faltou: …" (os mesmos ids das frases). */
function signatureWord(state: string): string {
  const states: Record<string, string> = {
    valid: $localize`:signature state|:valid`,
    invalid: $localize`:signature state|:invalid`,
    absent: $localize`:signature state|:absent`,
  };
  return states[state] ?? state;
}

function schemaWord(state: string): string {
  const states: Record<string, string> = {
    valid: $localize`:schema state|:valid`,
    invalid: $localize`:schema state|:invalid`,
  };
  return states[state] ?? state;
}

/**
 * A condição que faltou, curta, a partir da frase do servidor (`signature: expected invalid, got valid` → "signature
 * invalid"). Frase que a tabela não conhece: o alvo dela (o que vem antes dos dois-pontos).
 */
export function missingCondition(original: string): string {
  let parts: RegExpExecArray | null;
  if ((parts = /^signature: expected (\w+)/.exec(original))) {
    return $localize`:near miss in the circuit, the condition that failed:signature ${signatureWord(parts[1])}:state:`;
  }
  if ((parts = /^schema: expected (\w+)/.exec(original))) {
    return $localize`:near miss in the circuit, the condition that failed:schema ${schemaWord(parts[1])}:state:`;
  }
  if ((parts = /^decryption: expected (\w+)/.exec(original))) {
    return $localize`:near miss in the circuit, the condition that failed:decryption ${decryptionState(parts[1])}:state:`;
  }
  if ((parts = /^method: expected (?:one of )?(.+?), got /.exec(original))) {
    return $localize`:near miss in the circuit, the condition that failed:method ${parts[1]}:method:`;
  }
  if ((parts = /^path: expected prefix (".*"), got /s.exec(original))) {
    return $localize`:near miss in the circuit, the condition that failed:path starts with ${parts[1]}:prefix:`;
  }
  if ((parts = /^path: expected (?:to match )?(".*"), got /s.exec(original))) {
    return $localize`:near miss in the circuit, the condition that failed:path ${parts[1]}:path:`;
  }
  if ((parts = /^(query|header|body) (.+?): /s.exec(original))) {
    return target(parts[1], parts[2]);
  }
  if ((parts = /^scenario (.+?): /s.exec(original))) {
    return $localize`:near miss in the circuit, the condition that failed:scenario ${parts[1]}:name:`;
  }
  return original.split(': ')[0];
}

function missingText(failed: readonly string[]): string {
  const [first = ''] = failed;
  const more = failed.length > 1 ? ` +${failed.length - 1}` : '';
  return `${missingCondition(first)}${more}`;
}

/** O que o nó mostra da mensagem aberta: o resultado da verificação, com o glifo. */
interface Result {
  glyph: CircuitGlyph;
  text: string;
  bad: boolean;
  /** "assinatura ✓" na frase do caminho. */
  word: string;
}

function signatureResult(request: CapturedRequest): Result {
  const name = $localize`:circuit path phrase:signature`;
  const signature = request.signature;
  if (!signature) {
    const text = $localize`:circuit signature result|:not checked`;
    return { glyph: { text: '–', tone: 'ok' }, text, bad: false, word: `${name} –` };
  }
  const provider = signatureProviderLabel(signature.provider);
  const state = pipelineOf(request).signature.state;
  const states: Record<string, string> = {
    valid: $localize`:circuit signature result|:valid`,
    invalid: $localize`:circuit signature result|:invalid`,
    stale: $localize`:circuit signature result|:stale`,
    absent: $localize`:circuit signature result|:absent`,
  };
  const bad = !signature.valid;
  return {
    glyph: { text: bad ? '✗' : '✓', tone: bad ? 'bad' : 'ok' },
    text: `${states[state] ?? state} · ${provider}`,
    bad,
    word: `${name} ${bad ? '✗' : '✓'}`,
  };
}

function schemaResult(request: CapturedRequest, token: Token): Result {
  const name = $localize`:circuit path phrase:schema`;
  const schema = request.schema;
  if (!schema) {
    const text = $localize`:circuit schema result|:not checked`;
    return { glyph: { text: '–', tone: 'ok' }, text, bad: false, word: `${name} –` };
  }
  return schema.valid
    ? {
        glyph: { text: '✓', tone: 'ok' },
        text: `${$localize`:circuit schema result|:valid`} · ${dialectOf(token)}`,
        bad: false,
        word: `${name} ✓`,
      }
    : {
        glyph: { text: '✗', tone: 'bad' },
        text: $localize`:circuit schema result|:invalid`,
        bad: true,
        word: `${name} ✗`,
      };
}

function decryptionResult(request: CapturedRequest): Result | null {
  const state = request.decryption?.state;
  if (!state) {
    return null;
  }
  const name = $localize`:circuit path phrase:decryption`;
  const bad = decryptionBad(request);
  const texts: Record<string, string> = {
    valid: $localize`:circuit decryption result|:valid`,
    invalid: $localize`:circuit decryption result|:invalid`,
    unknown_kid: $localize`:circuit decryption result|:unknown key`,
    absent: $localize`:circuit decryption result|:plaintext`,
  };
  const glyph = bad ? '✗' : state === 'valid' ? '✓' : '–';
  return {
    glyph: { text: glyph, tone: bad ? 'bad' : 'ok' },
    text: texts[state] ?? state,
    bad,
    word: `${name} ${glyph}`,
  };
}

/** As linhas da escada, de y = 24 para baixo (a primeira junto do "quase", em y = 9), a `step` uma da outra. */
function rowYs(count: number, step: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((ROW_TOP + i * step) * 10) / 10);
}

function plain(label: Pick<CircuitLabel, 'text' | 'glyph'>): string {
  return [label.glyph?.text, label.text].filter(Boolean).join(' ');
}

/** O lugar do número na frase traduzida: a frase vem com ele, e o contador entra ali. */
const COUNT = '\u0001';

/** A frase com o contador no lugar de `COUNT`: o texto inteiro, para ler, e as partes, para desenhar. */
function counted(phrase: string, value: number): { text: string; count: CircuitCount } {
  const at = phrase.indexOf(COUNT);
  const before = at < 0 ? phrase : phrase.slice(0, at);
  const after = at < 0 ? '' : phrase.slice(at + COUNT.length);
  return { text: `${before}${value}${after}`, count: { value, before, after } };
}

/** "401 · " e o contador: a anotação de uma linha da escada. */
function tally(before: string, value: number): { text: string; count: CircuitCount } {
  return { text: `${before}${value}`, count: { value, before, after: '' } };
}

/**
 * A espessura da aresta no modo fluxo (demo, `thickness`): de 1 px a 3 px pelo número de chegadas que passaram por
 * ela, em escala de log (256 enchem), em quartos de pixel.
 */
export function flowWidth(count: number): number {
  return Math.round((1 + 2 * Math.min(1, Math.log2(1 + count) / Math.log2(257))) * 4) / 4;
}

export function circuitOf(input: CircuitInput): CircuitView {
  const w = words();
  const { token, selected, filter } = input;
  const rules = input.rules
    ? evaluationOrder(input.rules)
        .map((index) => input.rules?.[index] as Rule)
        .filter((rule) => rule.enabled !== false)
    : null;
  const ruleById = new Map((input.rules ?? []).map((rule) => [rule.id ?? '', rule]));
  const withRules = !!rules && rules.length > 0;
  const decrypts = !!token.e2ee;
  const showDecryption = withRules || decrypts;
  const unavailable = !rules && !!input.rulesUnavailable;
  // Com o palco encolhido, as linhas se afastam para o alvo de cada uma seguir com 24 px na tela.
  const rowStep = ROW_STEP / Math.min(1, input.scale ?? 1);
  /** A mensagem aberta não passou pelas regras: nem respondida por uma, nem com a mais próxima gravada. */
  const bypassed = !!selected && withRules && !selected.rule && !selected.near_miss;
  // As regras ligadas, na ordem; as que cabem têm linha própria, as outras dividem a linha "+N regras".
  const enabled = rules ?? [];
  const visible = enabled.length + 1 > MAX_ROWS ? enabled.slice(0, MAX_ROWS - 2) : enabled;
  const hidden = enabled.slice(visible.length);
  const enabledById = new Map(enabled.map((rule) => [rule.id ?? '', rule]));
  const inLadder = new Map(visible.map((rule) => [rule.id ?? '', rule]));

  // Contagens das mensagens carregadas: por regra, pela padrão e as anomalias que nenhuma regra pegou.
  const byRule = new Map<string, number>();
  let byDefault = 0;
  let signatureCount = 0;
  let schemaCount = 0;
  let decryptionCount = 0;
  for (const request of input.requests) {
    // A anomalia conta na linha da regra que a pegou só se a regra tem linha na escada para mostrá-la.
    const answered = request.rule ? inLadder.get(request.rule.id) : undefined;
    if (request.rule) {
      byRule.set(request.rule.id, (byRule.get(request.rule.id) ?? 0) + 1);
    } else {
      byDefault++;
    }
    signatureCount += signatureBad(request) && !catches(answered, 'signature') ? 1 : 0;
    schemaCount += schemaBad(request) && !catches(answered, 'schema') ? 1 : 0;
    decryptionCount += decryptionBad(request) && !catches(answered, 'decryption') ? 1 : 0;
  }

  const pipeline = selected ? pipelineOf(selected, { token }) : null;
  const signature = selected ? signatureResult(selected) : null;
  const schema = selected ? schemaResult(selected, token) : null;
  const decryption = selected ? decryptionResult(selected) : null;
  // Os números dos cartões do detalhe, na ordem deles: assinatura, schema, decifra (se veio), resposta.
  const badges = new Map<string, string>();
  if (pipeline) {
    ['signature', 'schema', ...(pipeline.decryption ? ['decryption'] : []), 'response'].forEach(
      (id, i) => badges.set(id, CIRCLED[i]),
    );
  }

  const edges: CircuitEdge[] = [];
  const route: string[] = [];
  const junctions: (readonly [number, number])[] = [];
  const marks: CircuitMark[] = [];
  const labels: CircuitLabel[] = [];
  const nodes: CircuitNode[] = [];
  const onPath = new Set<string>();
  /** Os saltos do pulso (as arestas de cada um, na ordem) e as do coletor que ele sobe, de baixo para cima. */
  const hopIds: string[][] = [];
  const upward = new Set<string>();
  const label = (
    key: string,
    x: number,
    y: number,
    align: CircuitLabel['align'],
    kind: LabelKind,
    text: string,
    extra: Partial<CircuitLabel> = {},
  ) => labels.push({ key, x, y, align, kind, text, muted: false, rule: null, ...extra });
  const edge = (id: string, d: string) => edges.push({ id, d });

  const showAll = $localize`:circuit node without a filter:Enter shows all in the list.`;
  const filters = (description: string) =>
    $localize`:circuit node with a filter:Enter filters the list: ${description}:filter:.`;
  const opensFilters = $localize`:circuit node that opens the Filters panel:Enter opens Filters.`;

  // Nós principais: título em y = 40, subtítulo em 76, o resultado da mensagem em 92, a anotação em 108.
  interface Main {
    id: string;
    x: number;
    title: string;
    sub: string;
    subMuted: boolean;
    result: Result | null;
    count: number;
    filter: Partial<RequestFilter> | null;
    off: Partial<RequestFilter> | null;
    pressed: boolean | null;
    filterText: string;
  }
  const mains: Main[] = [
    {
      id: 'sender',
      x: X.sender,
      title: w.sender,
      sub: selected?.ip ?? '—',
      subMuted: !selected,
      result: null,
      count: 0,
      filter: null,
      off: null,
      pressed: null,
      filterText: '',
    },
    {
      id: 'signature',
      x: X.signature,
      title: w.signature,
      sub: token.signature ? signatureHeader(token) : w.signatureOff,
      subMuted: true,
      result: signature,
      count: signatureCount,
      filter: token.signature ? { signature: 'invalid' } : null,
      off: token.signature ? { signature: 'any' } : null,
      pressed: token.signature
        ? filter.signature === 'invalid' || filter.signature === 'absent'
        : null,
      filterText: $localize`:circuit filter:signature invalid`,
    },
    {
      id: 'schema',
      x: X.schema,
      title: w.schema,
      sub: token.schema ? 'JSON Schema' : w.schemaOff,
      subMuted: true,
      result: schema,
      count: schemaCount,
      filter: token.schema ? { schema: 'invalid' } : null,
      off: token.schema ? { schema: 'any' } : null,
      pressed: token.schema ? filter.schema === 'invalid' : null,
      filterText: $localize`:circuit filter:schema invalid`,
    },
    ...(showDecryption
      ? [
          {
            id: 'decryption',
            x: X.decryption,
            title: w.decryption,
            sub: token.e2ee ? token.e2ee.path : w.decryptionOff,
            subMuted: true,
            result: decryption,
            count: decryptionCount,
            filter: decrypts ? { decryption: 'invalid' as const } : null,
            off: decrypts ? { decryption: null } : null,
            pressed: decrypts
              ? filter.decryption === 'invalid' || filter.decryption === 'unknown_kid'
              : null,
            filterText: $localize`:circuit filter:decryption invalid`,
          },
        ]
      : []),
  ];
  const spokenOf = (parts: (string | null | undefined)[]) =>
    parts.filter((part): part is string => !!part && part !== '—').join('; ');
  // O medidor do modo fluxo, ao lado do título do Remetente (demo, `rem:meter`).
  const meter =
    input.meter !== null && input.meter !== undefined
      ? counted(
          $localize`:circuit meter, requests that arrived in the last second:${COUNT}:count:/s`,
          input.meter,
        )
      : null;
  mains.forEach((main, index) => {
    marks.push({ id: main.id, x: main.x, y: MAIN_Y, r: 4, on: false, reveal: index });
    label(`${main.id}:title`, main.x, 40, 'c', 'title', main.title, {
      ...(badges.has(main.id) && { badge: badges.get(main.id) }),
    });
    label(`${main.id}:sub`, main.x, 76, 'c', 'sub', main.sub, {
      muted: main.subMuted,
      ...(main.id === 'sender' && selected && { reveal: 0 }),
    });
    const parts: (string | null)[] = [main.sub];
    if (main.id === 'sender' && meter) {
      label('sender:meter', X.sender + 36, 40, 'l', 'meter', meter.text, { count: meter.count });
      parts.push(meter.text);
    }
    if (main.result) {
      label(`${main.id}:gl`, main.x, 92, 'c', 'gl', main.result.text, {
        glyph: main.result.glyph,
        rule: main.result.bad ? 'bad' : null,
        reveal: index,
      });
      parts.push(plain(main.result));
    }
    if (main.count > 0 && !unavailable) {
      const note = { glyph: { text: '✗', tone: 'bad' as const }, text: String(main.count) };
      label(`${main.id}:note`, main.x, 108, 'c', 'note', note.text, {
        glyph: note.glyph,
        rule: 'bad',
        count: { value: main.count, before: '', after: '' },
      });
      parts.push(plain(note));
    }
    const state = spokenOf(parts);
    nodes.push({
      id: main.id,
      x: main.x - 62,
      y: 28,
      w: 124,
      h: 90,
      label: `${main.title}${state ? `: ${state}` : ''}. ${main.filter ? filters(main.filterText) : showAll}`,
      filter: main.filter,
      off: main.off,
      pressed: main.pressed,
    });
  });

  edge('rs', `M${X.sender},${MAIN_Y} H${X.signature}`);
  edge('ss', `M${X.signature},${MAIN_Y} H${X.schema}`);
  const pre = ['rs', 'ss'];

  // A resposta da mensagem aberta: o status (ou a falha de rede) e quem respondeu, em tinta neutra.
  // Quem respondeu, igual no desenho e na frase: "P1" para regra da escada, o nome gravado para a que saiu dela.
  const answeredRule = selected?.rule ? enabledById.get(selected.rule.id) : undefined;
  const whoAnswered = selected?.rule
    ? answeredRule
      ? pLabel(answeredRule)
      : selected.rule.name
    : w.default;
  const responseData = (() => {
    if (!selected) {
      return null;
    }
    const who = whoAnswered;
    const fault = selected.response?.fault;
    const status = selected.response?.status;
    return `${fault ? faultShort(fault) : (status ?? '—')} · ${who}`;
  })();

  let rows: Row[] = [];
  // Sem mensagem aberta e sem regras, responde a padrão; com as regras por saber, não se diz.
  const noMessage = rules ? `${w.default} · ${token.default_status}` : '—';
  if (!withRules) {
    // R1: sem regras, a linha vai do Schema (ou da Decifra) direto à Resposta.
    if (decrypts) {
      edge('sd', `M${X.schema},${MAIN_Y} H${X.decryption}`);
      edge('dr', `M${X.decryption},${MAIN_Y} H${X.response}`);
      pre.push('sd', 'dr');
    } else {
      edge('sr', `M${X.schema},${MAIN_Y} H${X.response}`);
      pre.push('sr');
    }
    if (rules) {
      label('none', X.ladder, 76, 'c', 'sub', w.noRules, { muted: true });
    } else if (unavailable) {
      label('unavailable', X.ladder, 76, 'c', 'sub', w.unavailable, { muted: true });
    }
    marks.push({ id: 'response', x: X.response, y: MAIN_Y, r: 4, on: false, reveal: pre.length });
    label('response:data', X.response, 24, 'c', 'data', responseData ?? noMessage, {
      muted: !selected,
      ...(selected && { reveal: pre.length }),
    });
    label('response:title', X.response, 40, 'c', 'title', w.response, {
      ...(badges.has('response') && { badge: badges.get('response') }),
    });
    nodes.push({
      id: 'response',
      x: 1078,
      y: 12,
      w: 124,
      h: 58,
      label: `${w.response}: ${responseData ?? noMessage}. ${showAll}`,
      filter: null,
      off: null,
      pressed: null,
    });
    if (selected) {
      route.push(...pre);
      hopIds.push(...pre.map((id) => [id]));
      ['sender', 'signature', 'schema', ...(decrypts ? ['decryption'] : []), 'response'].forEach(
        (id) => onPath.add(id),
      );
    }
  } else {
    edge('sd', `M${X.schema},${MAIN_Y} H${X.decryption}`);
    pre.push('sd');
    const ys = rowYs(visible.length + (hidden.length > 0 ? 1 : 0) + 1, rowStep);
    const count = (list: readonly Rule[]) =>
      list.reduce((sum, rule) => sum + (byRule.get(rule.id ?? '') ?? 0), 0);
    const outcome = filter.outcome ?? null;
    const near = selected && !selected.rule ? selected.near_miss : null;
    rows = visible.map((rule, i): Row => {
      const hits = count([rule]);
      const fault = rule.response?.fault;
      const status = rule.response?.status ?? 200;
      const ann = fault
        ? hits > 0
          ? {
              glyph: { text: '⚡', tone: 'bad' as const },
              ...tally(`${lowerFirst(faultName(fault))} · `, hits),
              muted: false,
              rule: 'bad' as const,
            }
          : { text: faultShort(fault), muted: true, rule: null }
        : hits > 0
          ? catchesAny(rule)
            ? {
                glyph: { text: '✗', tone: 'bad' as const },
                ...tally(`${status} · `, hits),
                muted: false,
                rule: 'bad' as const,
              }
            : { ...tally(`${status} · `, hits), muted: false, rule: null }
          : { text: String(status), muted: true, rule: null };
      const name = `${pLabel(rule)} ${rule.name}`;
      return {
        id: `rule:${rule.id ?? i}`,
        y: ys[i],
        name,
        spoken: $localize`:circuit node, a rule of the ladder:Rule ${name}:name:`,
        rules: [rule],
        ann,
        filter: rule.id ? { outcome: { type: 'rule', rule: rule.id, name: rule.name } } : null,
        off: rule.id ? { outcome: null } : null,
        pressed: rule.id ? outcome?.type === 'rule' && outcome.rule === rule.id : null,
        hint: $localize`:circuit filter:answered by ${pLabel(rule)}:rule:`,
      };
    });
    if (hidden.length > 0) {
      const hits = count(hidden);
      const name =
        hidden.length === 1
          ? $localize`:circuit ladder, rules that do not fit:+1 rule`
          : $localize`:circuit ladder, rules that do not fit:+${hidden.length}:count: rules`;
      // A regra escondida que respondeu à mensagem aberta (ou quase casou com ela) aparece no lugar da contagem
      // (F1-A01): o caminho passa por esta linha, e ela diz por quem.
      const answeredHere = selected?.rule
        ? hidden.find((rule) => rule.id === selected.rule?.id)
        : undefined;
      const nearHere = near ? hidden.find((rule) => rule.id === near.id) : undefined;
      const among = answeredHere ?? nearHere;
      const amongName = among ? `${pLabel(among)} ${among.name}` : '';
      const fault = selected?.response?.fault;
      const answer = fault ? faultShort(fault) : String(selected?.response?.status ?? '—');
      rows.push({
        id: 'more',
        y: ys[visible.length],
        name,
        spoken: answeredHere
          ? $localize`:circuit ladder, rules that do not fit, with the hidden rule that answered the open request:${name}:rules:, among them ${amongName}:rule:, which answered: ${answer}:answer:`
          : nearHere
            ? $localize`:circuit ladder, rules that do not fit, with the hidden rule that almost matched the open request:${name}:rules:, among them ${amongName}:rule:, which almost matched`
            : name,
        rules: hidden,
        ann: answeredHere
          ? { text: `${amongName} · ${answer}`, muted: false, rule: null }
          : nearHere
            ? { glyph: { text: '◔', tone: 'near' }, text: amongName, muted: false, rule: 'near' }
            : hits > 0
              ? { ...tally('', hits), muted: false, rule: null }
              : { text: '', muted: true, rule: null },
        annSpoken: !among,
        filter: null,
        off: null,
        pressed: null,
        hint: '',
        opens: 'filters',
      });
    }
    rows.push({
      id: 'default',
      y: ys[ys.length - 1],
      name: w.default,
      spoken: w.defaultResponse,
      rules: [],
      ann:
        byDefault > 0
          ? { ...tally(`${token.default_status} · `, byDefault), muted: false, rule: null }
          : { text: String(token.default_status), muted: true, rule: null },
      filter: { outcome: { type: 'default' } },
      off: { outcome: null },
      pressed: outcome?.type === 'default',
      hint: $localize`:circuit filter:answered by the default response`,
    });

    // A escada: entra por cima (12 px acima da primeira linha), desce pela espinha e sai pelo coletor.
    const top = rows[0].y - 12;
    edge(
      'br',
      `M${X.decryption},${MAIN_Y} H686 Q690,${MAIN_Y} 690,${MAIN_Y - 4} V${top + 4} Q690,${top} 694,${top} H856 Q860,${top} 860,${top + 4} V${rows[0].y}`,
    );
    rows.forEach((row, i) => {
      if (i < rows.length - 1) {
        edge(`s${i}`, `M${X.ladder},${row.y} V${rows[i + 1].y}`);
      }
      edge(`x${i}`, `M${X.ladder},${row.y} H${X.collector}`);
    });
    const stops = [...new Set([...rows.map((row) => row.y), MAIN_Y])].sort((a, b) => a - b);
    stops.forEach((y, i) => {
      if (i < stops.length - 1) {
        edge(`c${i}`, `M${X.collector},${y} V${stops[i + 1]}`);
      }
      if (i > 0 && i < stops.length - 1) {
        junctions.push([X.collector, y]);
      }
    });
    edge('out', `M${X.collector},${MAIN_Y} H${X.response}`);
    edge('rv', `M${X.response},${MAIN_Y} H${X.resend}`);

    // O "quase casou" da mensagem aberta, em âmbar, na linha acima da escada (a da demo, y = 9).
    let nearText: string | null = null;
    if (near) {
      const nearRule = ruleById.get(near.id);
      const at = rows.findIndex((row) => row.rules.some((rule) => rule.id === near.id));
      const missing = missingText(near.failed);
      nearText =
        at === 0
          ? $localize`:circuit, the rule that almost matched:near · missing: ${missing}:missing:`
          : $localize`:circuit, the rule that almost matched:near ${nearRule ? pLabel(nearRule) : near.name}:rule: · missing: ${missing}:missing:`;
      label('near', 872, NEAR_Y, 'l', 'near', nearText, {
        glyph: { text: '◔', tone: 'near' },
        rule: 'near',
        reveal: LADDER_HOPS,
      });
    }

    rows.forEach((row) => {
      marks.push({ id: row.id, x: X.ladder, y: row.y, r: 3, on: false, reveal: LADDER_HOPS });
      label(`${row.id}:name`, 850, row.y, 'r', 'name', row.name);
      if (row.ann.text) {
        label(`${row.id}:ann`, 872, row.y, 'l', 'ann', row.ann.text, row.ann);
      }
      const nearHere = near && row.rules.some((rule) => rule.id === near.id) ? nearText : null;
      const state = spokenOf([row.annSpoken === false ? null : plain(row.ann), nearHere]);
      const h = rowStep;
      nodes.push({
        id: row.id,
        x: 704,
        y: row.y - h / 2,
        w: 340,
        h,
        label: `${row.spoken}${state ? `: ${state}` : ''}. ${row.opens ? opensFilters : row.filter ? filters(row.hint) : showAll}`,
        filter: row.filter,
        off: row.off,
        pressed: row.pressed,
        ...(row.opens && { opens: row.opens }),
      });
    });

    // A mensagem cuja regra saiu da escada para na decifra (3 saltos); as outras chegam à Resposta em 5.
    const answered = selected?.rule
      ? rows.findIndex((row) => row.rules.some((rule) => rule.id === selected.rule?.id))
      : rows.length - 1;
    const responseHops = bypassed || answered >= 0 ? LADDER_HOPS + 1 : LADDER_HOPS - 1;
    marks.push({ id: 'response', x: X.response, y: MAIN_Y, r: 4, on: false, reveal: responseHops });
    marks.push({ id: 'resend', x: X.resend, y: MAIN_Y, r: 4, on: false });
    label('response:data', X.response, 24, 'c', 'data', responseData ?? '—', {
      muted: !selected,
      ...(selected && { reveal: responseHops }),
    });
    label('response:title', X.response, 40, 'c', 'title', w.response, {
      ...(badges.has('response') && { badge: badges.get('response') }),
    });
    const responses =
      input.requests.length === 1
        ? { text: $localize`:circuit, requests the URL answered:1 response` }
        : counted(
            $localize`:circuit, requests the URL answered:${COUNT}:count: responses`,
            input.requests.length,
          );
    if (input.requests.length > 0) {
      label('response:sub', X.response, 76, 'c', 'sub', responses.text, {
        muted: true,
        ...('count' in responses && { count: responses.count }),
      });
    }
    label('resend:title', X.resend, 40, 'c', 'title', w.resend);
    label('resend:sub', X.resend, 76, 'c', 'sub', w.outbound, { muted: true });
    nodes.push(
      {
        id: 'response',
        x: 1078,
        y: 12,
        w: 106,
        h: 76,
        label: `${w.response}: ${spokenOf([responseData, input.requests.length > 0 ? responses.text : null]) || '—'}. ${showAll}`,
        filter: null,
        off: null,
        pressed: null,
      },
      {
        id: 'resend',
        x: 1188,
        y: 28,
        w: 58,
        h: 60,
        label: `${w.resend}: ${w.outbound}. ${showAll}`,
        filter: null,
        off: null,
        pressed: null,
      },
    );

    if (selected) {
      route.push(...pre);
      hopIds.push(...pre.map((id) => [id]));
      ['sender', 'signature', 'schema', 'decryption'].forEach((id) => onPath.add(id));
      const at = answered;
      if (bypassed) {
        // Gravada sem passar pelas regras (antes delas, ou com todas desligadas): direto à Resposta.
        edge('skip', `M${X.decryption},${MAIN_Y} H${X.collector}`);
        route.push('skip', 'out');
        hopIds.push(['skip'], ['out']);
      } else if (at >= 0) {
        // Regra que não existe mais (ou desligada): o caminho para na decifra; a Resposta diz quem respondeu.
        const descent = ['br', ...Array.from({ length: at }, (_, i) => `s${i}`)];
        const from = stops.indexOf(rows[at].y);
        const main = stops.indexOf(MAIN_Y);
        const [a, b] = from < main ? [from, main] : [main, from];
        const collector = Array.from({ length: b - a }, (_, i) => `c${a + i}`);
        if (from > main) {
          // Abaixo da linha principal, o pulso sobe o coletor.
          collector.reverse();
          collector.forEach((id) => upward.add(id));
        }
        const exit = [`x${at}`, ...collector, 'out'];
        route.push(...descent, ...exit);
        hopIds.push(descent, exit);
        rows.slice(0, at + 1).forEach((row) => onPath.add(row.id));
      }
      onPath.add('response');
    }
  }
  for (const mark of marks) {
    mark.on = onPath.has(mark.id);
  }

  // O nome acessível do desenho e a frase "caminho: …" (a linha do celular), como na demo.
  let path: PathPart[] | null = null;
  const nodeCount = nodes.length;
  let description = $localize`:circuit description:URL circuit ${input.name}:name: with ${nodeCount}:count: nodes.`;
  if (selected && signature && schema) {
    const parts: PathPart[] = [
      { text: signature.word, bad: signature.bad },
      { text: schema.word, bad: schema.bad },
      ...(decryption ? [{ text: decryption.word, bad: decryption.bad }] : []),
    ];
    const at = selected.rule ? enabledIndex(enabled, selected.rule.id) : -1;
    const fault = selected.response?.fault;
    const answer = fault ? lowerFirst(faultName(fault)) : String(selected.response?.status ?? '—');
    if (selected.rule && at >= 0) {
      enabled.slice(0, at).forEach((rule) => parts.push({ text: `${pLabel(rule)} ✗`, bad: false }));
      parts.push({ text: `${whoAnswered} ✓ → ${answer}`, bad: false });
    } else if (selected.rule) {
      parts.push({ text: `${whoAnswered} ✓ → ${answer}`, bad: false });
    } else {
      if (!bypassed) {
        (rules ?? []).forEach((rule) => parts.push({ text: `${pLabel(rule)} ✗`, bad: false }));
      }
      const status = selected.response?.status ?? '—';
      parts.push({
        text: $localize`:circuit path phrase:default response ${status}:status:`,
        bad: false,
      });
    }
    path = parts;
    const where = routeOf(selected.url).split('?')[0];
    const phrase = parts.map((part) => part.text).join(' → ');
    const near = withRules && !selected.rule && selected.near_miss;
    const nearRule = near ? ruleById.get(near.id) : undefined;
    const nearName = near ? (nearRule ? `${pLabel(nearRule)} ${nearRule.name}` : near.name) : '';
    description +=
      ' ' +
      (near
        ? $localize`:circuit description:Open request: ${selected.method}:method: ${where}:route: from ${selected.ip}:ip:; path: ${phrase}:path:; near match: ${nearName}:rule:.`
        : $localize`:circuit description:Open request: ${selected.method}:method: ${where}:route: from ${selected.ip}:ip:; path: ${phrase}:path:.`);
  } else {
    description += ' ' + $localize`:circuit description:No request open.`;
  }

  // O caminho em saltos, para o pulso: o desenho de cada salto e o salto em que cada aresta acende.
  const drawn = new Map(edges.map((each) => [each.id, each.d]));
  const lit: Record<string, number> = {};
  const hops = hopIds.map((ids, i) => {
    ids.forEach((id) => (lit[id] = i + 1));
    return joinPath(
      ids.map((id) => {
        const d = drawn.get(id) ?? '';
        return upward.has(id) ? reverseLine(d) : d;
      }),
    );
  });

  return { edges, route, hops, lit, junctions, marks, labels, nodes, description, path };
}

function enabledIndex(rules: readonly Rule[], id: string): number {
  return rules.findIndex((rule) => rule.id === id);
}
