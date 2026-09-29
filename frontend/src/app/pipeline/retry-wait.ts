import { parseUtc } from '../request-detail/dates';

/** `limit` existe porque a hora é guardada por segundo: o intervalo medido erra até 1 s. */
export type WaitVerdict = 'before' | 'limit' | 'waited';

export interface RetryWait {
  verdict: WaitVerdict;
  seconds: number;
  /** O `Retry-After` pedido, em segundos. */
  asked: number;
}

/** `null` com template, data HTTP, fração ou vazio: aí não há veredito. */
export function fixedRetryAfter(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  return typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : null;
}

export function secondsBetween(previousAt: string, at: string): number | null {
  const seconds = (parseUtc(at).getTime() - parseUtc(previousAt).getTime()) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : null;
}

/** `retryAfter` é o da configuração de agora: o cabeçalho respondido não é gravado. */
export function retryWait(previousAt: string, at: string, retryAfter: unknown): RetryWait | null {
  const asked = fixedRetryAfter(retryAfter);
  const seconds = secondsBetween(previousAt, at);
  if (asked === null || seconds === null) {
    return null;
  }
  const verdict = seconds < asked ? 'before' : seconds === asked ? 'limit' : 'waited';
  return { verdict, seconds, asked };
}

export function waitPhrase({ verdict, seconds, asked }: RetryWait): string {
  switch (verdict) {
    case 'before':
      return $localize`Came ${seconds}:seconds: s after the previous answer. It asked to wait ${asked}:asked: s.`;
    case 'limit':
      return $localize`Came about ${asked}:asked: s after. Times are kept to the second, so this cannot be told apart from ${asked}:asked: s.`;
    case 'waited':
      return $localize`Waited ${seconds}:seconds: s. It asked to wait ${asked}:asked: s.`;
  }
}

export function waitCaveat(asked: number): string {
  return $localize`Wait asked: Retry-After: ${asked}:asked:, as configured now. Times are kept to the second.`;
}
