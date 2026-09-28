import {
  RetryWait,
  retryWait,
  secondsBetween,
  waitCaveat,
  waitPhrase,
} from '../pipeline/retry-wait';

/** Uma requisição que chegou para a conferência, na ordem de chegada. */
export interface Arrival {
  /** `created_at` da requisição. */
  at: string;
  /** O que a URL respondeu: o status, ou a falha de rede. */
  answer: string;
  /** A regra que respondeu, ou `null` (resposta padrão). */
  rule: string | null;
  /** O `Retry-After` que a regra que respondeu tem **agora**; o que não é inteiro fixo não confere. */
  asked: unknown;
}

export interface CheckRow {
  attempt: number;
  at: string;
  /** Segundos desde a tentativa anterior; `null` na primeira. */
  gap: number | null;
  answer: string;
  rule: string | null;
  /** A espera contra o que a resposta anterior pedia; `null` sem veredito. */
  wait: RetryWait | null;
  phrase: string;
}

export interface RetryCheck {
  /** O que aconteceu, sem julgar. */
  summary: string;
  /** Quantas chegaram antes da espera pedida (aviso); vazio sem nenhuma. */
  early: string;
  rows: CheckRow[];
  /** A ressalva da espera pedida; vazia sem `Retry-After` fixo. */
  caveat: string;
}

/**
 * A conferência do retry (R1): a trilha das respostas contra o programado e o intervalo de cada
 * tentativa contra o `Retry-After` da resposta anterior, com os três vereditos da E1. "As
 * programmed" só sai com a sequência fechada, as respostas batendo e nenhuma chegada antes da
 * espera pedida.
 *
 * `programmed` são as respostas da sequência, na ordem; a última fica.
 */
export function retryCheck(
  arrivals: readonly Arrival[],
  programmed: readonly string[],
): RetryCheck {
  if (arrivals.length === 0) {
    return { summary: '', early: '', rows: [], caveat: '' };
  }
  const rows = arrivals.map((arrival, i): CheckRow => {
    const previous = arrivals[i - 1];
    const wait = previous ? retryWait(previous.at, arrival.at, previous.asked) : null;
    return {
      attempt: i + 1,
      at: arrival.at,
      gap: previous ? secondsBetween(previous.at, arrival.at) : null,
      answer: arrival.answer,
      rule: arrival.rule,
      wait,
      phrase: wait ? waitPhrase(wait) : '',
    };
  });
  const early = rows.filter((row) => row.wait?.verdict === 'before');
  const asked = rows.find((row) => row.wait)?.wait?.asked;
  return {
    summary: summaryOf(arrivals, programmed, early.length > 0),
    early:
      early.length === 0
        ? ''
        : early.length === 1
          ? $localize`1 request came before the asked wait of ${early[0].wait?.asked}:asked: s.`
          : $localize`${early.length}:count: requests came before the asked wait of ${early[0].wait?.asked}:asked: s.`,
    rows,
    caveat: asked === undefined ? '' : waitCaveat(asked),
  };
}

function summaryOf(
  arrivals: readonly Arrival[],
  programmed: readonly string[],
  early: boolean,
): string {
  const count = arrivals.length;
  const trail = arrivals.map(({ answer }) => answer).join(', ');
  const arrived =
    count === 1
      ? $localize`1 request arrived. Answers: ${trail}:trail:`
      : $localize`${count}:count: requests arrived. Answers: ${trail}:trail:`;
  // A última resposta programada fica: depois dela, toda tentativa a recebe.
  const expected = arrivals.map((_, i) => programmed[Math.min(i, programmed.length - 1)]);
  if (expected.join(', ') !== trail) {
    return $localize`${arrived}:arrived:. Programmed: ${expected.join(', ')}:expected:.`;
  }
  return !early && count >= programmed.length
    ? $localize`${arrived}:arrived:, as programmed.`
    : `${arrived}.`;
}
