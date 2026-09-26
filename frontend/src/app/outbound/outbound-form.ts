import { Validators } from '@angular/forms';
import { TIMEOUT_MAX_S, TIMEOUT_MIN_S, URL_MAX_LENGTH } from './outbound';

/** Destino: http(s), até 2048 caracteres, como o servidor valida. */
export const targetValidators = [
  Validators.required,
  Validators.maxLength(URL_MAX_LENGTH),
  Validators.pattern(/^https?:\/\/\S+$/i),
];

/** Timeout em segundos inteiros, de 1 a 30. */
export const timeoutValidators = [
  Validators.required,
  Validators.min(TIMEOUT_MIN_S),
  Validators.max(TIMEOUT_MAX_S),
  Validators.pattern(/^\d+$/),
];

export const TARGET_ERROR = 'An http:// or https:// URL of up to 2048 characters.';
export const TIMEOUT_ERROR = `A whole number of seconds from ${TIMEOUT_MIN_S} to ${TIMEOUT_MAX_S}.`;
