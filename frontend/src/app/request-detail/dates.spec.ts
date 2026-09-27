import { fromNow, localDate, parseUtc } from './dates';

const CRIADA = '2026-09-26 00:00:00';
const base = parseUtc(CRIADA).getTime();

describe('Dado a data de uma mensagem ("Y-m-d H:i:s" em UTC)', () => {
  it('deve interpretar como UTC Quando converte para Date', () => {
    expect(parseUtc(CRIADA).toISOString()).toBe('2026-09-26T00:00:00.000Z');
  });

  it('deve formatar como o "lll" do moment Quando mostra a data local', () => {
    expect(localDate(CRIADA)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM)$/);
  });

  it.each([
    [44, 'a few seconds ago'],
    [45, 'a minute ago'],
    [89, 'a minute ago'],
    [90, '2 minutes ago'],
    [44 * 60, '44 minutes ago'],
    [45 * 60, 'an hour ago'],
    [3 * 3600, '3 hours ago'],
    [22 * 3600, 'a day ago'],
    [3 * 86400, '3 days ago'],
    [26 * 86400, 'a month ago'],
    [100 * 86400, '3 months ago'],
    [400 * 86400, 'a year ago'],
    [3 * 365 * 86400, '3 years ago'],
  ])('deve seguir os limiares do moment Quando se passaram %i segundos', (segundos, esperado) => {
    expect(fromNow(CRIADA, base + segundos * 1000)).toBe(esperado);
  });

  it('deve contar como passado Quando o relógio do servidor está poucos segundos à frente', () => {
    expect(fromNow(CRIADA, base - 5 * 1000)).toBe('a few seconds ago');
  });
});

describe('Dado a data de uma mensagem em outro idioma (Intl)', () => {
  it('deve formatar pelo Intl do idioma, sem AM/PM, Quando a tela está em pt-BR', () => {
    const text = localDate(CRIADA, 'pt-BR');

    expect(text).toMatch(/\d{1,2} de [a-zç]{3}\.? de \d{4}/);
    expect(text).not.toMatch(/\b(AM|PM)\b/);
  });

  it.each([
    [30, 'agora'],
    [3 * 60, 'há 3 minutos'],
    [3 * 86400, 'há 3 dias'],
  ])(
    'deve dizer o tempo relativo pelo Intl Quando se passaram %i segundos',
    (segundos, esperado) => {
      expect(fromNow(CRIADA, base + segundos * 1000, 'pt-BR')).toBe(esperado);
    },
  );

  it('deve dizer o futuro Quando a data ainda vai chegar (validade de um link)', () => {
    expect(fromNow(CRIADA, base - 7 * 86400 * 1000, 'en')).toBe('in 7 days');
    expect(fromNow(CRIADA, base - 7 * 86400 * 1000, 'pt-BR')).toBe('em 7 dias');
  });
});
