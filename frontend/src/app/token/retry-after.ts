import { AbstractControl, ValidationErrors } from '@angular/forms';

const SECONDS = /^\d+$/;
/** O servidor guarda os segundos num `Long`: acima disso, 422. */
const MAX_SECONDS = 9223372036854775807n;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IMF_FIXDATE = new RegExp(
  `^(${DAYS.join('|')}), (\\d{2}) (${MONTHS.join('|')}) (\\d{4}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$`,
);

/**
 * `Retry-After = HTTP-date / delay-seconds` (RFC 9110 §10.2.3), como o servidor valida:
 * segundos (só dígitos, até o `Long`) ou data no formato IMF-fixdate, que precisa existir e ter
 * o dia da semana certo. Formatos obsoletos (RFC 850, asctime) e espaço em volta são recusados.
 */
export function isRetryAfter(value: string): boolean {
  if (SECONDS.test(value)) {
    return BigInt(value) <= MAX_SECONDS;
  }
  const match = IMF_FIXDATE.exec(value);
  if (!match) {
    return false;
  }
  const [, day, date, month, year, hour, minute, second] = match;
  const parsed = new Date(Date.UTC(+year, MONTHS.indexOf(month), +date, +hour, +minute, +second));
  return (
    parsed.getUTCFullYear() === +year &&
    parsed.getUTCMonth() === MONTHS.indexOf(month) &&
    parsed.getUTCDate() === +date &&
    parsed.getUTCHours() === +hour &&
    parsed.getUTCMinutes() === +minute &&
    parsed.getUTCSeconds() === +second &&
    parsed.getUTCDay() === DAYS.indexOf(day)
  );
}

/** Campo vazio desliga o header; preenchido, precisa ser um `Retry-After` válido. */
export function retryAfterValidator(control: AbstractControl<string>): ValidationErrors | null {
  return control.value === '' || isRetryAfter(control.value) ? null : { retryAfter: true };
}
