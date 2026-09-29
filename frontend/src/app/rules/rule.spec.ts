import {
  Rule,
  evaluationOrder,
  matchSummary,
  moveInOrder,
  pathWithoutToken,
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
    [
      'template',
      response({ template: true }),
      'template',
      'Template',
      'Body and header values are templates',
    ],
    ['atraso fixo', response({ delay: { fixed: 500 } }), 'delay', 'Delay', 'Delay: 500 ms'],
    [
      'atraso uniforme',
      response({ delay: { uniform: { min: 100, max: 900 } } }),
      'delay',
      'Delay',
      'Delay: 100–900 ms (uniform)',
    ],
    [
      'atraso log-normal',
      response({ delay: { lognormal: { median: 800, sigma: 0.4 } } }),
      'delay',
      'Delay',
      'Delay: ~800 ms (log-normal, sigma 0.4)',
    ],
    [
      'falha',
      response({ fault: 'connection_reset' }),
      'fault',
      'Fault',
      'Fault: connection reset (TCP RST)',
    ],
  ])(
    'deve indicar %s com o texto traduzido e o detalhe no título',
    (_caso, resposta, label, text, detail) => {
      expect(ruleFlags(rule({ response: resposta }))).toEqual([{ label, text, detail }]);
    },
  );

  it('deve indicar o cenário com a transição de estado', () => {
    const flags = ruleFlags(
      rule({ scenario: { name: 'Retry', requiredState: 'Started', newState: 'falhou-1' } }),
    );

    expect(flags).toEqual([
      { label: 'scenario', text: 'Scenario', detail: 'Scenario Retry: Started → falhou-1' },
    ]);
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

  it('deve indicar o template Quando a falha manda o corpo da regra (truncated_body)', () => {
    const flags = ruleFlags(
      rule({
        response: response({ template: true, delay: { fixed: 10 }, fault: 'truncated_body' }),
      }),
    );

    expect(flags.map((flag) => flag.label)).toEqual(['fault', 'template']);
  });

  it.each([
    [
      'a chance',
      { chance: 30 },
      { label: 'chance', text: 'Chance', detail: 'Chance: 30% of the matching requests' },
    ],
    [
      'a janela com as duas pontas',
      { active_from: '2026-09-29T12:00:00Z', active_until: '2026-09-29T12:15:00Z' },
      {
        label: 'window',
        text: 'Window',
        detail: 'Active from 2026-09-29T12:00:00Z until 2026-09-29T12:15:00Z (UTC)',
      },
    ],
    [
      'a janela só com o começo',
      { active_from: '2026-09-29T12:00:00Z' },
      { label: 'window', text: 'Window', detail: 'Active from 2026-09-29T12:00:00Z (UTC)' },
    ],
    [
      'a janela só com o fim',
      { active_until: '2026-09-29T12:15:00Z' },
      { label: 'window', text: 'Window', detail: 'Active until 2026-09-29T12:15:00Z (UTC)' },
    ],
  ])('deve indicar %s com o detalhe no título', (_caso, campos, flag) => {
    expect(ruleFlags(rule(campos))).toEqual([flag]);
  });

  it('deve indicar chance e janela junto da falha, que não as anula', () => {
    const flags = ruleFlags(
      rule({
        chance: 50,
        active_until: '2026-09-29T12:15:00Z',
        scenario: { name: 'Retry' },
        response: response({ fault: 'hang' }),
      }),
    );

    expect(flags.map((flag) => flag.label)).toEqual(['fault', 'chance', 'window', 'scenario']);
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
    expect(resumo.matches).toEqual([uuid(120)]);
    expect(resumo.matchList).toEqual([{ uuid: uuid(120), seq: 120, page: 3 }]);
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
      matches: [],
      matchList: [],
      misses: [],
      windowFull: false,
    });
  });
});

describe('Dado a reordenação da lista (moveInOrder)', () => {
  const nomes = (rules: Rule[]) => rules.map((r) => `${r.name}:${r.priority ?? 5}`);
  const SALVAS = [
    rule({ name: 'c', priority: 9 }),
    rule({ name: 'a', priority: 1 }),
    rule({ name: 'b' }),
    rule({ name: 'd', priority: 9 }),
  ];

  it.each([
    ['um passo para cima troca as prioridades das vizinhas', 1, 0, ['b:1', 'a:5', 'c:9', 'd:9']],
    [
      'um passo para baixo entre prioridades iguais mantém as prioridades',
      2,
      3,
      ['a:1', 'b:5', 'd:9', 'c:9'],
    ],
    [
      'do fim para o começo desloca as prioridades com as posições',
      3,
      0,
      ['d:1', 'a:5', 'b:9', 'c:9'],
    ],
    ['do começo para o fim', 0, 3, ['b:1', 'c:5', 'd:9', 'a:9']],
  ])('deve devolver a lista na nova ordem de avaliação Quando %s', (_caso, from, to, esperado) => {
    const lista = moveInOrder(SALVAS, from, to);

    expect(nomes(lista)).toEqual(esperado);
    expect(evaluationOrder(lista)).toEqual([0, 1, 2, 3]);
  });
});

describe('Dado um caminho de regra com o token da URL (pathWithoutToken)', () => {
  const TOKEN = '3dbd68f4-8890-4f56-affb-c7c9b297e666';

  it.each([
    [`/${TOKEN}`, '/'],
    [`/${TOKEN}/pagamentos`, '/pagamentos'],
    [`/${TOKEN.toUpperCase()}/x`, '/x'],
    ['/pagamentos', null],
    [`/${TOKEN}extra`, null],
    ['', null],
  ])('deve tirar o token Quando o caminho é %s', (path, esperado) => {
    expect(pathWithoutToken(path, TOKEN)).toBe(esperado);
  });
});
