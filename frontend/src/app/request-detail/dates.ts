import { formatDate } from '@angular/common';

/** A API grava datas como "Y-m-d H:i:s" em UTC. */
export function parseUtc(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

/** Data local no formato `lll` do moment usado pelo app atual: "Sep 25, 2026 9:43 PM". */
export function localDate(value: string): string {
  return formatDate(parseUtc(value), 'MMM d, y h:mm a', 'en-US');
}

/** Tempo relativo com os limiares e textos do `moment().fromNow()` usado pelo app atual. */
export function fromNow(value: string, now: number = Date.now()): string {
  return `${relative(Math.round(Math.abs(now - parseUtc(value).getTime()) / 1000))} ago`;
}

function relative(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const months = Math.round(days / 30.4);
  const years = Math.round(days / 365);
  if (seconds < 45) return 'a few seconds';
  if (minutes < 2) return 'a minute';
  if (minutes < 45) return `${minutes} minutes`;
  if (hours < 2) return 'an hour';
  if (hours < 22) return `${hours} hours`;
  if (days < 2) return 'a day';
  if (days < 26) return `${days} days`;
  if (months < 2) return 'a month';
  if (months < 11) return `${months} months`;
  if (years < 2) return 'a year';
  return `${years} years`;
}
