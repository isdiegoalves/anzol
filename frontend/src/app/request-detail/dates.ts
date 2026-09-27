import { formatDate } from '@angular/common';

/** A API grava datas como "Y-m-d H:i:s" em UTC. */
export function parseUtc(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

/** Idioma da tela, que o `loadLocale` pôs no `<html lang>` antes do bootstrap. */
function screenLanguage(): string {
  return document.documentElement.lang || 'en';
}

/**
 * Data local. Em inglês, o formato `lll` do moment usado pelo app atual ("Sep 25, 2026 9:43 PM");
 * nos outros idiomas, o `Intl` do idioma ("25 de set. de 2026, 21:43").
 */
export function localDate(value: string, language: string = screenLanguage()): string {
  const date = parseUtc(value);
  if (language === 'en') {
    return formatDate(date, 'MMM d, y h:mm a', 'en-US');
  }
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}

/**
 * Tempo relativo com os limiares do `moment().fromNow()` usado pelo app atual: em inglês, os textos
 * dele ("3 minutes ago", "in 7 days"); nos outros idiomas, o `Intl.RelativeTimeFormat`.
 */
export function fromNow(
  value: string,
  now: number = Date.now(),
  language: string = screenLanguage(),
): string {
  const difference = parseUtc(value).getTime() - now;
  const seconds = Math.round(Math.abs(difference) / 1000);
  // Poucos segundos à frente é diferença de relógio entre servidor e navegador: conta como passado.
  const future = difference > 0 && seconds >= 45;
  if (language === 'en') {
    return future ? `in ${relative(seconds)}` : `${relative(seconds)} ago`;
  }
  const [count, unit] = relativeUnit(seconds);
  return unit === 'second'
    ? new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(0, 'second')
    : new Intl.RelativeTimeFormat(language).format(future ? count : -count, unit);
}

function relativeUnit(seconds: number): [number, Intl.RelativeTimeFormatUnit] {
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const months = Math.round(days / 30.4);
  const years = Math.round(days / 365);
  if (seconds < 45) return [seconds, 'second'];
  if (minutes < 2) return [1, 'minute'];
  if (minutes < 45) return [minutes, 'minute'];
  if (hours < 2) return [1, 'hour'];
  if (hours < 22) return [hours, 'hour'];
  if (days < 2) return [1, 'day'];
  if (days < 26) return [days, 'day'];
  if (months < 2) return [1, 'month'];
  if (months < 11) return [months, 'month'];
  if (years < 2) return [1, 'year'];
  return [years, 'year'];
}

function relative(seconds: number): string {
  const [count, unit] = relativeUnit(seconds);
  if (unit === 'second') return 'a few seconds';
  if (count === 1) return unit === 'hour' ? 'an hour' : `a ${unit}`;
  return `${count} ${unit}s`;
}
