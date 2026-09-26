import {
  Rule,
  evaluationOrder,
  matchSummary,
  ruleFlags,
  scenarioNames,
  scenarioStates,
  summarizeHistoryTest,
} from './rule';

const rule = (fields: Partial<Rule>): Rule => ({ name: 'r', ...fields });

describe('Dado o resumo do match na lista de regras', () => {
  it.each([
    [
      'método e caminho igual',
      { method: ['POST'], path: { equals: '/pagamentos' } },
      'POST /pagamentos',
    ],
    [
      'dois métodos e prefixo',
      { method: ['GET', 'HEAD'], path: { prefix: '/api' } },
      'GET, HEAD /api*',
    ],
    ['sem método e regex', { path: { regex: '^/v\\d+' } }, 'ANY ~ ^/v\\d+'],
    ['lista de métodos vazia e sem caminho', { method: [] }, 'ANY (any path)'],
  ])('deve resumir %s', (_caso, match, esperado) => {
    expect(matchSummary(rule({ match }))).toBe(esperado);
  });

  it('deve resumir como qualquer método e caminho Quando a regra não tem match', () => {
    expect(matchSummary(rule({}))).toBe('ANY (any path)');
  });
});

describe('Dado a ordem em que o servidor avalia as regras', () => {
  it('deve pôr a menor prioridade primeiro e manter a ordem da lista no empate', () => {
    const rules = [
      rule({ priority: 5 }),
      rule({ priority: 1 }),
      rule({}), // sem prioridade vale 5
      rule({ priority: 1 }),
    ];

    expect(evaluationOrder(rules)).toEqual([1, 3, 0, 2]);
  });

  it('deve devolver lista vazia Quando não há regras', () => {
    expect(evaluationOrder([])).toEqual([]);
  });
});

describe('Dado os indicadores da regra na lista', () => {
  const response = (fields: Record<string, unknown>) => ({ status: 200, ...fields });

  it('não deve mostrar indicador Quando a regra só tem status, headers e corpo', () => {
    expect(ruleFlags(rule({ response: response({ template: false, delay: null }) }))).toEqual([]);
  });

  it.each([
    ['template', response({ template: true }), 'template', 'Body and header values are templates'],
    ['atraso fixo', response({ delay: { fixed: 500 } }), 'delay', 'Delay: 500 ms'],
    [
      'atraso uniforme',
      response({ delay: { uniform: { min: 100, max: 900 } } }),
      'delay',
      'Delay: 100–900 ms (uniform)',
    ],
    [
      'atraso log-normal',
      response({ delay: { lognormal: { median: 800, sigma: 0.4 } } }),
      'delay',
      'Delay: ~800 ms (log-normal, sigma 0.4)',
    ],
    [
      'falha',
      response({ fault: 'connection_reset' }),
      'fault',
      'Fault: connection reset (TCP RST)',
    ],
  ])('deve indicar %s com o detalhe no título', (_caso, resposta, label, detail) => {
    expect(ruleFlags(rule({ response: resposta }))).toEqual([{ label, detail }]);
  });

  it('deve indicar o cenário com a transição de estado', () => {
    const flags = ruleFlags(
      rule({ scenario: { name: 'Retry', requiredState: 'Started', newState: 'falhou-1' } }),
    );

    expect(flags).toEqual([{ label: 'scenario', detail: 'Scenario Retry: Started → falhou-1' }]);
  });

  it('deve dizer "any state" e "keeps the state" Quando o cenário não exige nem muda o estado', () => {
    expect(ruleFlags(rule({ scenario: { name: 'Retry', newState: null } }))[0].detail).toBe(
      'Scenario Retry: any state → keeps the state',
    );
  });

  it('não deve indicar template nem atraso Quando a regra tem falha (o servidor os ignora)', () => {
    const flags = ruleFlags(
      rule({
        scenario: { name: 'Retry' },
        response: response({ template: true, delay: { fixed: 10 }, fault: 'empty_response' }),
      }),
    );

    expect(flags.map((flag) => flag.label)).toEqual(['fault', 'scenario']);
  });
});

describe('Dado as sugestões de cenário do editor', () => {
  const regras = [
    rule({ scenario: { name: 'Retry', requiredState: 'Started', newState: 'falhou-1' } }),
    rule({ scenario: { name: 'Retry', requiredState: 'falhou-1', newState: 'ok' } }),
    rule({ scenario: { name: 'Login' } }),
    rule({ scenario: null }),
    rule({}),
  ];

  it('deve listar os nomes dos cenários citados, sem repetir', () => {
    expect(scenarioNames(regras)).toEqual(['Retry', 'Login']);
  });

  it('deve listar Started e os estados citados pelas regras do mesmo cenário', () => {
    expect(scenarioStates(regras, 'Retry')).toEqual(['Started', 'falhou-1', 'ok']);
  });

  it('deve sugerir só Started Quando o cenário ainda não existe', () => {
    expect(scenarioStates(regras, 'Novo')).toEqual(['Started']);
  });
});

describe('Dado a resposta do teste da regra contra o histórico', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('deve contar as que casam e pôr em cada falha a página da lista onde ela está', () => {
    // 120 mensagens na URL, 50 por página, da mais antiga para a mais nova; as quatro testadas são
    // as mais novas (posições 117 a 120), todas na página 3.
    const resumo = summarizeHistoryTest(
      {
        matches: [{ uuid: uuid(120), seq: 120 }],
        misses: [
          { uuid: uuid(119), seq: 119, failed: ['method: expected POST, got GET'] },
          { uuid: uuid(71), seq: 71, failed: ['path: expected "/a", got "/b"'] },
          { uuid: uuid(51), seq: 51, failed: ['body: body is not JSON'] },
        ],
      },
      120,
    );

    expect(resumo.tested).toBe(4);
    expect(resumo.matched).toBe(1);
    expect(resumo.windowFull).toBe(false);
    expect(resumo.misses).toEqual([
      { uuid: uuid(119), seq: 119, failed: ['method: expected POST, got GET'], page: 3 },
      { uuid: uuid(71), seq: 71, failed: ['path: expected "/a", got "/b"'], page: 3 },
      { uuid: uuid(51), seq: 51, failed: ['body: body is not JSON'], page: 3 },
    ]);
  });

  it('deve contar a posição pela ordem das mensagens, não pelo seq (mensagens apagadas)', () => {
    // 60 mensagens na URL; as quatro testadas são as mais novas, com buracos no seq.
    const resumo = summarizeHistoryTest(
      {
        matches: [{ uuid: uuid(1), seq: 900 }],
        misses: [
          { uuid: uuid(2), seq: 500, failed: ['x'] },
          { uuid: uuid(3), seq: 30, failed: ['x'] },
          { uuid: uuid(4), seq: 20, failed: ['x'] },
        ],
      },
      53,
    );

    // Da mais antiga, contando de 0: posições 52, 51, 50 e 49 → páginas 2, 2, 2 e 1.
    expect(resumo.misses.map(({ seq, page }) => [seq, page])).toEqual([
      [500, 2],
      [30, 2],
      [20, 1],
    ]);
  });

  it('deve avisar que só as 500 mais recentes entram Quando o teste cobriu 500 mensagens', () => {
    const matches = Array.from({ length: 500 }, (_, i) => ({ uuid: uuid(i), seq: i }));

    expect(summarizeHistoryTest({ matches, misses: [] }, 800).windowFull).toBe(true);
  });

  it('deve dar zero testadas Quando a URL não tem mensagens', () => {
    expect(summarizeHistoryTest({ matches: [], misses: [] }, 0)).toEqual({
      tested: 0,
      matched: 0,
      misses: [],
      windowFull: false,
    });
  });
});
