import { FormControl } from '@angular/forms';
import { isRetryAfter, retryAfterValidator } from './token';

describe('Dado o valor do campo Retry-After (RFC 9110 §10.2.3)', () => {
  it.each([
    ['segundos', '120'],
    ['zero', '0'],
    ['zeros à esquerda', '007'],
    ['o maior segundo que o servidor guarda (Long)', '9223372036854775807'],
    ['data HTTP (IMF-fixdate)', 'Sun, 06 Nov 1994 08:49:37 GMT'],
    ['data HTTP no futuro', 'Fri, 31 Dec 2027 23:59:59 GMT'],
  ])('deve aceitar Quando o valor é %s', (_caso, valor) => {
    expect(isRetryAfter(valor)).toBe(true);
  });

  it.each([
    ['texto', 'abc'],
    ['negativo', '-1'],
    ['fracionário', '1.5'],
    ['com sinal', '+5'],
    ['com espaço', ' 120'],
    ['acima do Long do servidor', '9223372036854775808'],
    ['formato RFC 850 (obsoleto)', 'Sunday, 06-Nov-94 08:49:37 GMT'],
    ['formato asctime (obsoleto)', 'Sun Nov  6 08:49:37 1994'],
    ['fuso diferente de GMT', 'Sun, 06 Nov 1994 08:49:37 UTC'],
    ['dia sem zero à esquerda', 'Sun, 6 Nov 1994 08:49:37 GMT'],
    ['dia que não existe', 'Wed, 31 Feb 2027 10:00:00 GMT'],
    ['dia da semana que não bate com a data', 'Mon, 06 Nov 1994 08:49:37 GMT'],
    ['hora inválida', 'Sun, 06 Nov 1994 24:00:00 GMT'],
  ])('deve recusar Quando o valor é %s', (_caso, valor) => {
    expect(isRetryAfter(valor)).toBe(false);
  });
});

describe('Dado o validador do formulário', () => {
  it.each([
    ['vazio (desligado)', '', null],
    ['válido', '30', null],
    ['inválido', 'amanhã', { retryAfter: true }],
  ])('deve devolver o erro esperado Quando o campo está %s', (_caso, valor, esperado) => {
    expect(retryAfterValidator(new FormControl(valor, { nonNullable: true }))).toEqual(esperado);
  });
});
