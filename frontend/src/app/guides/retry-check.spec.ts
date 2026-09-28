import { Arrival, retryCheck } from './retry-check';

describe('Dado a conferência do roteiro "Test a retry" (R1)', () => {
  const PROGRAMMED = ['429', '429', '200'];
  /** Chegadas a partir das 21:40:00, com os segundos de cada uma e o que foi respondido. */
  const arrivals = (asked: unknown, ...rows: [number, string][]): Arrival[] =>
    rows.map(([second, answer], i) => ({
      at: `2026-09-28 21:40:${String(second).padStart(2, '0')}`,
      answer,
      rule: `cobrancas ${i + 1}/3`,
      asked: answer === '200' ? null : asked,
    }));

  it('deve dizer "as programmed" Quando as respostas batem e a espera foi respeitada', () => {
    const check = retryCheck(arrivals(5, [2, '429'], [7, '429'], [13, '200']), PROGRAMMED);

    expect(check.summary).toBe('3 requests arrived. Answers: 429, 429, 200, as programmed.');
    expect(check.early).toBe('');
    expect(check.rows.map(({ attempt, gap, phrase }) => [attempt, gap, phrase])).toEqual([
      [1, null, ''],
      [
        2,
        5,
        'Came about 5 s after. Times are kept to the second, so this cannot be told apart from 5 s.',
      ],
      [3, 6, 'Waited 6 s. It asked to wait 5 s.'],
    ]);
    expect(check.caveat).toBe(
      'Wait asked: Retry-After: 5, as configured now. Times are kept to the second.',
    );
  });

  it('nunca deve dizer "as programmed" Quando alguma chegou antes da espera pedida', () => {
    const check = retryCheck(arrivals(5, [2, '429'], [2, '429'], [3, '200']), PROGRAMMED);

    expect(check.summary).toBe('3 requests arrived. Answers: 429, 429, 200.');
    expect(check.early).toBe('2 requests came before the asked wait of 5 s.');
    expect(check.rows[1].phrase).toBe('Came 0 s after the previous answer. It asked to wait 5 s.');
    expect(JSON.stringify(check)).not.toMatch(/as programmed/i);
  });

  it('deve contar no singular uma chegada só antes da espera', () => {
    const check = retryCheck(arrivals(5, [2, '429'], [3, '429'], [9, '200']), PROGRAMMED);

    expect(check.early).toBe('1 request came before the asked wait of 5 s.');
  });

  it('deve dizer a trilha até ali, sem "as programmed", enquanto a sequência não fechou', () => {
    expect(retryCheck(arrivals(5, [2, '429']), PROGRAMMED).summary).toBe(
      '1 request arrived. Answers: 429.',
    );
    expect(retryCheck(arrivals(5, [2, '429'], [9, '429']), PROGRAMMED).summary).toBe(
      '2 requests arrived. Answers: 429, 429.',
    );
  });

  it('deve contar a resposta final como a que fica, depois de fechada a sequência', () => {
    const check = retryCheck(
      arrivals(1, [2, '429'], [4, '429'], [6, '200'], [7, '200']),
      PROGRAMMED,
    );

    expect(check.summary).toBe('4 requests arrived. Answers: 429, 429, 200, 200, as programmed.');
  });

  it('deve dizer o que estava programado Quando as respostas não batem', () => {
    const check = retryCheck(arrivals(5, [2, '429'], [9, '200']), PROGRAMMED);

    expect(check.summary).toBe('2 requests arrived. Answers: 429, 200. Programmed: 429, 429.');
  });

  it('deve mostrar só o intervalo, sem veredito nem ressalva, Quando não há Retry-After fixo', () => {
    const check = retryCheck(arrivals(null, [2, '429'], [4, '429'], [9, '200']), PROGRAMMED);

    expect(check.rows.map(({ gap, phrase }) => [gap, phrase])).toEqual([
      [null, ''],
      [2, ''],
      [5, ''],
    ]);
    expect(check.caveat).toBe('');
    expect(check.summary).toBe('3 requests arrived. Answers: 429, 429, 200, as programmed.');
  });

  it('deve ficar vazia sem chegadas', () => {
    expect(retryCheck([], PROGRAMMED)).toEqual({ summary: '', early: '', rows: [], caveat: '' });
  });
});
