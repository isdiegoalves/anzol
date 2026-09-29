import { routeOf } from '../pipeline/pipeline';
import { waitCaveat, waitPhrase } from '../pipeline/retry-wait';
import { localDate, parseUtc } from '../request-detail/dates';
import { Grouped, TrailSeal, trailOf, waitsOf } from './event-key';
import { CapturedRequest, WebhookRequest, signatureState } from './webhook-request';

/** Quanto do fim do caminho fica sempre à vista: o corte, com reticências, é no meio. */
export const ROUTE_TAIL = 14;

/** A tentativa, na linha 1 do item recuado: "attempt 3", a hora com segundos e "+5 s". */
export interface AttemptView {
  number: string;
  time: string;
  gap: string;
  /** O início do nome acessível: "Attempt 3 of 3, 5 s after the previous, ". */
  prefix: string;
  /** No teto da limpeza, o número é a posição entre as guardadas. */
  title: string | null;
}

/** A linha de um evento com 2 ou mais tentativas carregadas. */
export interface EventView {
  value: string;
  newest: WebhookRequest;
  /** As tentativas carregadas (para achar a linha de uma requisição recolhida no evento). */
  ids: string[];
  method: string;
  route: string;
  head: string;
  tail: string;
  time: string;
  when: string;
  trail: TrailSeal[];
  /** "3 attempts in 12 s" (ou "kept", ou "loaded · more may be on the next page"). */
  count: string;
  /** Os problemas somados, a parte que casa com o filtro, as que chegaram antes da espera. */
  notes: string[];
  label: string;
  expanded: boolean;
}

/** Uma linha da lista virtual; `id` é a chave do `trackBy` e do foco. */
export type ListRow<Item> =
  | {
      kind: 'item';
      id: string;
      item: Item;
      /** O valor da chave, no lugar do `#id` (evento de uma tentativa só). */
      value: string | null;
      attempt: AttemptView | null;
      /** O evento a que a tentativa pertence (linha recuada). */
      event: string | null;
      /** A tentativa casa com o filtro (com filtro, as que casam ficam destacadas). */
      hit: boolean;
    }
  | { kind: 'event'; id: string; event: EventView }
  | { kind: 'wait'; id: string; text: string; before: boolean }
  | { kind: 'more'; id: string; event: string; text: string }
  | { kind: 'note'; id: string; text: string };

/** O que a montagem das linhas precisa saber da tela. */
export interface RowContext<Item> {
  itemOf: (request: WebhookRequest) => Item;
  expanded: ReadonlySet<string>;
  showingAll: ReadonlySet<string>;
  compact: boolean;
  filtering: boolean;
  /** A URL está no teto da limpeza automática: as tentativas mais antigas podem ter sido cortadas. */
  kept: boolean;
  /** A requisição mais antiga carregada, quando há página seguinte (o evento pode continuar nela). */
  cut: string | null;
  askedBy: (answer: CapturedRequest) => unknown;
  language: string;
}

export function timeOf(at: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(parseUtc(at));
}

/** "22 s", "4 min", "3 h". */
function duration(seconds: number): string {
  if (seconds < 120) {
    return $localize`${seconds}:seconds: s`;
  }
  return seconds < 7200
    ? $localize`${Math.round(seconds / 60)}:minutes: min`
    : $localize`${Math.round(seconds / 3600)}:hours: h`;
}

/** O selo como a tela o escreve: "429", "429✗", "429 ×14". */
export function sealText(seal: TrailSeal, marked: boolean): string {
  return `${seal.text}${marked && seal.mark ? '✗' : ''}${seal.count > 1 ? ` ×${seal.count}` : ''}`;
}

function countOf(attempts: readonly WebhookRequest[], context: RowContext<unknown>): string {
  const n = attempts.length;
  if (context.cut !== null && attempts[0].uuid === context.cut) {
    return $localize`${n}:count: attempts loaded · more may be on the next page`;
  }
  if (context.kept) {
    return $localize`${n}:count: attempts kept`;
  }
  const seconds = Math.max(
    0,
    Math.round(
      (parseUtc(attempts[n - 1].created_at).getTime() -
        parseUtc(attempts[0].created_at).getTime()) /
        1000,
    ),
  );
  return $localize`${n}:count: attempts in ${duration(seconds)}:duration:`;
}

/** Os problemas de verificação somados, sem julgar: o Anzol relata. */
function problemsOf(attempts: readonly CapturedRequest[]): string[] {
  const state = (request: CapturedRequest) =>
    request.signature ? signatureState(request.signature) : null;
  const invalid = attempts.filter((request) => state(request) === 'invalid').length;
  const absent = attempts.filter((request) => state(request) === 'absent').length;
  const schema = attempts.filter((request) => request.schema?.valid === false).length;
  return [
    ...(invalid === 0
      ? []
      : [
          invalid === 1
            ? $localize`1 signature does not match`
            : $localize`${invalid}:count: signatures do not match`,
        ]),
    ...(absent === 0 ? [] : [$localize`no signature in ${absent}:count:`]),
    ...(schema === 0
      ? []
      : [
          schema === 1
            ? $localize`1 with a schema error`
            : $localize`${schema}:count: with schema errors`,
        ]),
  ];
}

/**
 * As linhas da lista agrupada: o item solto; o evento, e embaixo dele, expandido, as tentativas da
 * mais nova para a mais antiga (com o veredito do `Retry-After`) e a ressalva. Com mais de 6
 * tentativas (4 no celular), a expansão mostra as mais novas, "… N more attempts" e as mais antigas.
 */
export function rowsOf<Item>(
  grouped: readonly Grouped[],
  context: RowContext<Item>,
): ListRow<Item>[] {
  const rows: ListRow<Item>[] = [];
  for (const entry of grouped) {
    if (entry.kind === 'request') {
      rows.push({
        kind: 'item',
        id: entry.request.uuid,
        item: context.itemOf(entry.request),
        value: entry.value,
        attempt: null,
        event: null,
        hit: false,
      });
      continue;
    }
    const { value, attempts, matching } = entry;
    const waits = waitsOf(attempts, context.askedBy);
    const early = waits.filter((wait) => wait?.wait?.verdict === 'before').length;
    const newest = attempts[attempts.length - 1];
    const route = routeOf(newest.url);
    const cut = Math.max(route.length - ROUTE_TAIL, 0);
    const trail = trailOf(attempts);
    const expanded = context.expanded.has(value);
    const notes = [
      ...problemsOf(attempts),
      ...(context.filtering && matching.size < attempts.length
        ? [$localize`${matching.size}:matching: of ${attempts.length}:count: attempts match`]
        : []),
      ...(early === 0
        ? []
        : [
            early === 1
              ? $localize`1 attempt came before the asked wait`
              : $localize`${early}:count: attempts came before the asked wait`,
          ]),
    ];
    const count = countOf(attempts, context);
    const time = timeOf(newest.created_at, context.language);
    const answers = trail.map((seal) => sealText(seal, false)).join(' ');
    const problems = notes.map((note) => `${note}, `).join('');
    rows.push({
      kind: 'event',
      id: `event:${value}`,
      event: {
        value,
        newest,
        ids: attempts.map((attempt) => attempt.uuid),
        method: newest.method,
        route,
        head: route.slice(0, cut),
        tail: route.slice(cut),
        time,
        when: localDate(newest.created_at, context.language),
        trail,
        count,
        notes,
        label: $localize`Event ${value}:value:, ${newest.method}:method: ${route}:route:, ${count}:count:, answers ${answers}:answers:, ${problems}:problems:newest at ${time}:time:. Open the newest attempt`,
        expanded,
      },
    });
    if (!expanded) {
      continue;
    }
    const total = attempts.length;
    const [head, tail] = context.compact ? [2, 1] : [3, 2];
    const collapse = !context.showingAll.has(value) && total > (context.compact ? 4 : 6);
    const shown = [...attempts.keys()].reverse();
    const visible = collapse ? [...shown.slice(0, head), -1, ...shown.slice(-tail)] : shown;
    for (const i of visible) {
      if (i < 0) {
        const hidden = total - head - tail;
        rows.push({
          kind: 'more',
          id: `more:${value}`,
          event: value,
          text: $localize`… ${hidden}:hidden: more attempts. Show all ${total}:total: attempts`,
        });
        continue;
      }
      const request = attempts[i];
      const wait = waits[i];
      const gap = wait?.gap ?? null;
      rows.push({
        kind: 'item',
        id: request.uuid,
        item: context.itemOf(request),
        value: null,
        event: value,
        hit: context.filtering && matching.has(request.uuid),
        attempt: {
          number: $localize`attempt ${i + 1}:number:`,
          time: timeOf(request.created_at, context.language),
          gap: gap === null ? '' : $localize`+${gap}:seconds: s`,
          prefix:
            gap === null
              ? $localize`Attempt ${i + 1}:number: of ${total}:total:, `
              : $localize`Attempt ${i + 1}:number: of ${total}:total:, ${gap}:seconds: s after the previous, `,
          title: context.kept
            ? $localize`Position among the attempts kept. Older ones may have been cut by auto cleanup.`
            : null,
        },
      });
      if (wait?.wait) {
        rows.push({
          kind: 'wait',
          id: `wait:${request.uuid}`,
          text: waitPhrase(wait.wait),
          before: wait.wait.verdict === 'before',
        });
      }
    }
    const asked = waits.find((wait) => wait?.wait)?.wait?.asked;
    if (asked !== undefined) {
      rows.push({ kind: 'note', id: `note:${value}`, text: waitCaveat(asked) });
    } else if (waits.some((wait) => wait?.notFixed)) {
      rows.push({
        kind: 'note',
        id: `note:${value}`,
        text: $localize`The wait asked is not a fixed number of seconds, so only the interval is shown.`,
      });
    }
  }
  return rows;
}
