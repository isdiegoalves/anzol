import { tokenStats } from '../../testing/stats-fixtures';
import { localDate } from '../request-detail/dates';
import {
  Answer,
  HOURLY_FILL_MAX,
  answerRows,
  answeredParts,
  hourlyBars,
  hourlySummary,
  localHour,
  methodsText,
  keptText,
  percent,
  schemaParts,
  signatureParts,
  utcOffset,
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

  it('deve resumir o intervalo e o pico para leitor de tela, na hora local', () => {
    const from = localDate('2026-09-26 12:00:00');
    const to = localDate('2026-09-26 14:00:00');
    expect(hourlySummary(hourlyBars(tokenStats().hourly))).toBe(
      `Requests per hour, 3 hours from ${from} to ${to}, local time; peak 12 at ${to}`,
    );
  });
});

describe('Dado a hora do servidor em Métricas', () => {
  it('deve dar a hora local por extenso, com o UTC para o title e o ISO para o datetime', () => {
    expect(localHour('2026-09-26 14:00:00')).toEqual({
      text: localDate('2026-09-26 14:00:00'),
      utc: '2026-09-26 14:00:00 UTC',
      iso: '2026-09-26T14:00:00.000Z',
    });
    expect(localHour('2026-09-26 14:00:00').text).not.toMatch(/UTC|T\d{2}:|Z$/);
  });

  it.each([
    [180, '−3'],
    [-330, '+5:30'],
    [0, '+0'],
    [240, '−4'],
  ])('deve escrever o fuso de getTimezoneOffset %i como UTC%s', (minutes, text) => {
    expect(utcOffset({ getTimezoneOffset: () => minutes } as Date)).toBe(text);
  });
});

describe('Dado quantas mensagens a URL guarda e a janela (keptText, RULES-39)', () => {
  it.each([
    [16, 16, 500, 'of the 16 kept'],
    [0, 0, 500, 'of the 0 kept'],
    [500, 1291, 500, 'the newest 500 of 1291 kept'],
    [50, 128, 50, 'the newest 50 of 128 kept'],
  ])(
    'deve dizer %i avaliadas de %i guardadas na janela de %i',
    (evaluated, total, window, text) => {
      expect(keptText(evaluated, total, window)).toBe(text);
    },
  );
});

describe('Dado os agregados do stats', () => {
  it.each([
    [0, 0, '—'],
    [1, 3, '33%'],
    [128, 128, '100%'],
  ])('deve dar o percentual de %i em %i como %s', (count, total, expected) => {
    expect(percent(count, total)).toBe(expected);
  });

  it('deve separar a assinatura em válida, inválida, ausente e não verificada, com o filtro de cada uma', () => {
    expect(
      signatureParts(tokenStats()).map(({ label, count, tone, filter }) => [
        label,
        count,
        tone,
        filter,
      ]),
    ).toEqual([
      ['Valid', 110, 'ok', { signature: 'valid' }],
      ['Invalid', 9, 'bad', { signature: 'invalid' }],
      ['Absent', 3, 'near', { signature: 'absent' }],
      // A Entrada não filtra "sem verificação": o número fica sem link.
      ['Not checked', 6, 'none', undefined],
    ]);
  });

  it('deve separar o schema em válido, inválido e não verificado, com o filtro de cada um', () => {
    expect(
      schemaParts(tokenStats()).map(({ label, count, filter }) => [label, count, filter]),
    ).toEqual([
      ['Valid', 100, { schema: 'valid' }],
      ['Invalid', 20, { schema: 'invalid' }],
      ['Not checked', 8, undefined],
    ]);
  });

  it('deve listar quem respondeu da regra que mais respondeu, com a resposta padrão no fim', () => {
    expect(
      answeredParts(tokenStats()).map(({ label, count, filter }) => [label, count, filter]),
    ).toEqual([
      ['Stripe payment OK', 41, { outcome: 'rule', rule: 'b', ruleName: 'Stripe payment OK' }],
      ['Refund queued', 3, { outcome: 'rule', rule: 'a', ruleName: 'Refund queued' }],
      ['Default response', 84, { outcome: 'default' }],
    ]);
  });

  it('deve escrever os métodos do mais usado para o menos', () => {
    expect(methodsText({ GET: 2, POST: 10, PUT: 2 })).toBe('POST 10, GET 2, PUT 2');
  });
});

describe('Dado as respostas das requisições mais novas (answerRows)', () => {
  const pelaRegra = (status: number): Answer => ({ byRule: true, response: { status } });
  const peloPadrao = (status: number): Answer => ({ byRule: false, response: { status } });

  it('deve contar por status exato, do mais respondido, com a origem e o filtro do status', () => {
    const rows = answerRows([
      peloPadrao(429),
      pelaRegra(201),
      peloPadrao(429),
      pelaRegra(418),
      peloPadrao(418),
    ]);

    expect(rows.map(({ text, filter }) => [text, filter])).toEqual([
      ['418 · 2 · both', { answered: '418' }],
      ['429 Too Many Requests · 2 · default response', { answered: '429' }],
      ['201 Created · 1 · by rules', { answered: '201' }],
    ]);
  });

  it('deve pôr no fim, sem filtro, a falha de rede e a resposta sem registro', () => {
    const rows = answerRows([
      { byRule: true, response: { fault: 'connection_reset' } },
      { byRule: false, response: null },
      { byRule: false, response: null },
      peloPadrao(200),
    ]);

    expect(rows.map(({ text, filter }) => [text, filter])).toEqual([
      ['200 OK · 1 · default response', { answered: '200' }],
      ['— not recorded · 2 · default response', null],
      ['— Connection reset · 1 · by rules', null],
    ]);
  });

  it('deve dar lista vazia Quando não há requisições', () => {
    expect(answerRows([])).toEqual([]);
  });
});
