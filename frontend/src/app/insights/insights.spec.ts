import { tokenStats } from '../../testing/stats-fixtures';
import {
  HOURLY_FILL_MAX,
  answeredParts,
  hourlyBars,
  hourlySummary,
  methodsText,
  percent,
  schemaParts,
  signatureParts,
} from './insights';

describe('Dado as horas com mensagem do stats (hourlyBars)', () => {
  it('deve preencher com zero as horas vazias entre a mais antiga e a mais nova', () => {
    expect(hourlyBars(tokenStats().hourly)).toEqual([
      { hour: '2026-09-26 12:00:00', count: 5, methods: { POST: 5 } },
      { hour: '2026-09-26 13:00:00', count: 0, methods: {} },
      { hour: '2026-09-26 14:00:00', count: 12, methods: { POST: 10, GET: 2 } },
    ]);
  });

  it('deve ficar só com as horas que têm mensagem Quando o intervalo passa do teto', () => {
    const hourly = [
      { hour: '2026-09-01 00:00:00', count: 1, methods: { GET: 1 } },
      { hour: '2026-09-26 14:00:00', count: 2, methods: { GET: 2 } },
    ];

    expect(hourlyBars(hourly)).toEqual(hourly);
    expect(HOURLY_FILL_MAX).toBe(72);
  });

  it('deve dar lista vazia e dizer que não há mensagens Quando a URL está vazia', () => {
    expect(hourlyBars([])).toEqual([]);
    expect(hourlySummary([])).toBe('Requests per hour: no requests');
  });

  it('deve resumir o intervalo e o pico para leitor de tela', () => {
    expect(hourlySummary(hourlyBars(tokenStats().hourly))).toBe(
      'Requests per hour, 3 hours from 2026-09-26 12:00:00 to 2026-09-26 14:00:00 UTC; ' +
        'peak 12 at 2026-09-26 14:00:00 UTC',
    );
  });
});

describe('Dado os agregados do stats', () => {
  it.each([
    [0, 0, '—'],
    [1, 3, '33%'],
    [128, 128, '100%'],
  ])('deve dar o percentual de %i em %i como %s', (count, total, expected) => {
    expect(percent(count, total)).toBe(expected);
  });

  it('deve separar a assinatura em válida, inválida, ausente e não verificada', () => {
    expect(
      signatureParts(tokenStats()).map(({ label, count, tone }) => [label, count, tone]),
    ).toEqual([
      ['Valid', 110, 'ok'],
      ['Invalid', 9, 'bad'],
      ['Absent', 3, 'near'],
      ['Not checked', 6, 'none'],
    ]);
  });

  it('deve separar o schema em válido, inválido e não verificado', () => {
    expect(schemaParts(tokenStats()).map(({ label, count }) => [label, count])).toEqual([
      ['Valid', 100],
      ['Invalid', 20],
      ['Not checked', 8],
    ]);
  });

  it('deve listar quem respondeu da regra que mais respondeu, com a resposta padrão no fim', () => {
    expect(answeredParts(tokenStats()).map(({ label, count }) => [label, count])).toEqual([
      ['Stripe payment OK', 41],
      ['Refund queued', 3],
      ['Default response', 84],
    ]);
  });

  it('deve escrever os métodos do mais usado para o menos', () => {
    expect(methodsText({ GET: 2, POST: 10, PUT: 2 })).toBe('POST 10, GET 2, PUT 2');
  });
});
