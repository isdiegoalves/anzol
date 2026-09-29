import { fixedRetryAfter, retryWait, waitCaveat, waitPhrase } from './retry-wait';

describe('Dado a conferência contra o Retry-After', () => {
  const at = (seconds: number) => `2026-09-28 21:40:${String(seconds).padStart(2, '0')}`;

  it.each([
    [0, 5, 'before', 'Came 0 s after the previous answer. It asked to wait 5 s.'],
    [4, 5, 'before', 'Came 4 s after the previous answer. It asked to wait 5 s.'],
    [
      5,
      5,
      'limit',
      'Came about 5 s after. Times are kept to the second, so this cannot be told apart from 5 s.',
    ],
    [6, 5, 'waited', 'Waited 6 s. It asked to wait 5 s.'],
    [0, 0, 'limit', null],
    [1, 0, 'waited', null],
  ])('deve dar, para %i s medidos e %i s pedidos, o veredito %s', (d, r, verdict, phrase) => {
    const wait = retryWait(at(2), at(2 + d), r);

    expect(wait).toEqual({ verdict, seconds: d, asked: r });
    if (wait && phrase) {
      expect(waitPhrase(wait)).toBe(phrase);
    }
  });

  it('deve medir pelos instantes gravados, atravessando o minuto', () => {
    expect(retryWait('2026-09-28 21:40:58', '2026-09-28 21:41:03', '5')).toEqual({
      verdict: 'limit',
      seconds: 5,
      asked: 5,
    });
  });

  it.each([
    ['{{request.body.wait}}'],
    ['Wed, 21 Oct 2026 07:28:00 GMT'],
    ['5.5'],
    ['-1'],
    [''],
    [null],
    [undefined],
    [2.5],
  ])('não deve dar veredito Quando o Retry-After é %s (não é inteiro fixo)', (value) => {
    expect(fixedRetryAfter(value)).toBeNull();
    expect(retryWait(at(1), at(9), value)).toBeNull();
  });

  it.each([
    ['5', 5],
    [' 12 ', 12],
    [7, 7],
    ['0', 0],
  ])('deve ler o inteiro fixo %s', (value, seconds) => {
    expect(fixedRetryAfter(value)).toBe(seconds);
  });

  it('não deve dar veredito Quando um dos instantes não é uma data', () => {
    expect(retryWait('', at(3), 5)).toBeNull();
  });

  it('deve dizer sempre que a espera é a da configuração de agora', () => {
    expect(waitCaveat(5)).toBe(
      'Wait asked: Retry-After: 5, as configured now. Times are kept to the second.',
    );
  });
});
