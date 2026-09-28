import { parseUtc } from '../request-detail/dates';

/**
 * Os três vereditos da conferência contra o `Retry-After` (guia da combinação, §3.5), e nenhum
 * outro: a hora é guardada por segundo, então o intervalo medido erra até 1 s para cada lado.
 * Não há certo nem errado: a tela relata, e quem julga o remetente é quem testa.
 */
export type WaitVerdict = 'before' | 'limit' | 'waited';

export interface RetryWait {
  verdict: WaitVerdict;
  /** Segundos entre a resposta anterior e esta tentativa. */
  seconds: number;
  /** Segundos que a resposta anterior pedia para esperar. */
  asked: number;
}

/**
 * O `Retry-After` configurado, quando é um inteiro fixo de segundos; `null` com template, data
 * HTTP, fração ou vazio (sem veredito, só o intervalo).
 */
export function fixedRetryAfter(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  return typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : null;
}

/** Segundos entre dois `created_at`; `null` se algum não é data. Nunca usa a `seq`. */
export function secondsBetween(previousAt: string, at: string): number | null {
  const seconds = (parseUtc(at).getTime() - parseUtc(previousAt).getTime()) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : null;
}

/**
 * A tentativa contra a espera pedida pela resposta anterior: os instantes gravados das duas
 * (`created_at`) e o `Retry-After` da configuração de agora. `null` é "sem veredito".
 */
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

/** A ressalva: o cabeçalho respondido não é gravado, o valor é o da configuração de agora. */
export function waitCaveat(asked: number): string {
  return $localize`Wait asked: Retry-After: ${asked}:asked:, as configured now. Times are kept to the second.`;
}
