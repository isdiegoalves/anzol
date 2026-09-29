import { clearTranslations, loadTranslations } from '@angular/localize';
import { translations } from '../../locale/pt-BR';
import { Rule } from './rule';
import { matchLine, ruleInWords, ruleWordSegments, scenarioTransition } from './rule-words';

describe('Dado a regra em palavras com destaque (ruleWordSegments, RULES-15)', () => {
  it('deve marcar o método e o status em negrito e o caminho como código, com o mesmo texto de ruleInWords', () => {
    const regra: Rule = {
      name: 'Pix',
      match: { method: ['POST', 'PUT'], path: { prefix: '/api' }, signature: 'valid' },
      response: { status: 201 },
    };

    const segments = ruleWordSegments(regra);

    expect(segments.map(({ text }) => text).join('')).toBe(ruleInWords(regra));
    expect(segments.filter(({ kind }) => kind !== 'text')).toEqual([
      { kind: 'strong', text: 'POST' },
      { kind: 'strong', text: 'PUT' },
      { kind: 'code', text: '/api' },
      { kind: 'strong', text: '201' },
    ]);
  });
});

describe('Dado uma regra na linha 2 da lista (matchLine, RULES-02)', () => {
  it.each<[string, Rule, string]>([
    ['sem condições', { name: 'Tudo' }, 'any request'],
    [
      'a do docs/api.md, com todas as condições',
      {
        name: 'pagamento aprovado',
        match: {
          method: ['POST'],
          path: { equals: '/pagamentos' },
          query: { tipo: { equals: 'pix' } },
          headers: { 'X-Signature': { present: true } },
          body: [{ jsonPath: { path: '$.status', equals: 'pago' } }, { contains: 'pedido' }],
          signature: 'valid',
          schema: 'invalid',
        },
      },
      'POST /pagamentos · query tipo = "pix" · header X-Signature present · $.status = "pago" · ' +
        'body contains "pedido" · signature valid · schema invalid',
    ],
    [
      'só o prefixo e a assinatura',
      { name: 'x', match: { path: { prefix: '/webhooks' }, signature: 'invalid' } },
      'path starts with /webhooks · signature invalid',
    ],
    [
      'métodos, regex e condições negativas',
      {
        name: 'x',
        match: {
          method: ['GET', 'HEAD'],
          path: { regex: '/v[0-9]+' },
          headers: { 'X-Id': { present: false }, Accept: { regex: '.*json' } },
          body: [{ jsonPath: { path: '$.id' } }, { equalToJson: { a: 1 } }, { regex: 'a.*' }],
        },
      },
      'GET, HEAD · path matches /v[0-9]+ · no header X-Id · header Accept ~ .*json · $.id present · ' +
        'body = JSON · body ~ a.*',
    ],
    [
      'com atraso log-normal e sem condição',
      { name: 'x', response: { delay: { lognormal: { median: 800, sigma: 0.5 } } } },
      'any request · lognormal delay, median 800 ms',
    ],
    [
      'com atraso e falha (a falha manda)',
      {
        name: 'x',
        match: { method: ['POST'] },
        response: { delay: { fixed: 300 }, fault: 'connection_reset' },
      },
      'POST · fault: connection reset (TCP RST)',
    ],
    [
      'com atraso uniforme',
      {
        name: 'x',
        match: { schema: 'valid' },
        response: { delay: { uniform: { min: 1, max: 9 } } },
      },
      'schema valid · delay 1–9 ms',
    ],
  ])('deve listar as condições Quando a regra é %s', (_caso, rule, line) => {
    expect(matchLine(rule)).toBe(line);
  });

  it.each<[Rule['match'], string]>([
    [{ signature: 'valid', schema: 'invalid' }, 'assinatura válida · schema inválido'],
    [{ signature: 'invalid', schema: 'valid' }, 'assinatura inválida · schema válido'],
    [{ signature: 'absent' }, 'sem assinatura'],
  ])('deve traduzir o estado da assinatura e do schema em pt-BR (%o)', (match, line) => {
    loadTranslations(translations);
    try {
      expect(matchLine({ name: 'x', match, response: {} })).toBe(line);
    } finally {
      clearTranslations();
    }
  });
});

describe('Dado uma regra de cenário na linha 3 da lista (scenarioTransition, RULES-07)', () => {
  it.each<[string, Rule['scenario'], string | null]>([
    ['sem cenário', null, null],
    [
      'com estado exigido e novo',
      { name: 'e', requiredState: 'Started', newState: 'falhou 1' },
      'Started → falhou 1',
    ],
    ['sem estado exigido', { name: 'e', newState: 'x' }, 'any state → x'],
    ['sem estado novo', { name: 'e', requiredState: 'entregue' }, 'entregue'],
    ['sem nenhum estado', { name: 'e' }, 'any state'],
  ])('deve dizer a transição Quando %s', (_caso, scenario, transition) => {
    expect(scenarioTransition({ name: 'r', scenario })).toBe(transition);
  });
});

describe('Dado uma regra (ruleInWords)', () => {
  it.each<[string, Rule, string]>([
    ['sem condições', { name: 'Tudo' }, 'When any request, answer 200.'],
    [
      'a do docs/api.md',
      {
        name: 'pagamento aprovado',
        match: {
          method: ['POST'],
          path: { equals: '/pagamentos' },
          query: { tipo: { equals: 'pix' } },
          headers: { 'X-Signature': { present: true } },
          body: [{ jsonPath: { path: '$.status', equals: 'pago' } }, { contains: 'pedido' }],
        },
        response: { status: 201, body: '{"ok":true}' },
      },
      'When a POST to /pagamentos has query tipo equal to "pix", header X-Signature present, ' +
        '$.status equal to "pago" and a body containing "pedido", answer 201.',
    ],
    [
      'com vários métodos, prefixo, assinatura e schema',
      {
        name: 'x',
        match: {
          method: ['POST', 'PUT', 'PATCH'],
          path: { prefix: '/api' },
          signature: 'invalid',
          schema: 'valid',
        },
        response: { status: 401 },
      },
      'When a POST, PUT or PATCH to a path starting with /api has an invalid signature and a body ' +
        'valid against the schema, answer 401.',
    ],
    [
      'com cenário, template e atraso',
      {
        name: 'falha 1',
        match: { path: { regex: '/v[0-9]+' }, headers: { 'X-Id': { present: false } } },
        scenario: { name: 'entrega', requiredState: 'Started', newState: 'falhou 1' },
        response: { status: 503, body: '{{seq}}', template: true, delay: { fixed: 200 } },
      },
      'When any request to a path matching /v[0-9]+ has no header X-Id, while scenario entrega ' +
        'is in "Started", answer 503 with a templated body after 200 ms and moves scenario ' +
        'entrega to "falhou 1".',
    ],
    [
      'com falha de rede',
      {
        name: 'x',
        match: { method: ['GET'] },
        response: { status: 500, fault: 'connection_reset' },
      },
      'When a GET, fail with connection reset (TCP RST).',
    ],
    [
      'com chance',
      {
        name: 'instável',
        chance: 30,
        match: { method: ['POST'], path: { equals: '/pagamentos' } },
        response: { status: 503 },
      },
      'When a POST to /pagamentos, in 30% of the matching requests, answer 503.',
    ],
    [
      'com cenário, janela e chance',
      {
        name: 'manutenção',
        chance: 50,
        active_from: '2026-09-29T12:00:00Z',
        active_until: '2026-09-29T13:00:00Z',
        scenario: { name: 'entrega', requiredState: 'Started', newState: 'falhou 1' },
        response: { status: 503 },
      },
      'When any request, while scenario entrega is in "Started", from 2026-09-29T12:00:00Z ' +
        'until 2026-09-29T13:00:00Z, in 50% of the matching requests, answer 503 and moves ' +
        'scenario entrega to "falhou 1".',
    ],
    [
      'com a janela aberta no fim',
      { name: 'x', active_from: '2026-09-29T12:00:00Z', response: { status: 503 } },
      'When any request, starting at 2026-09-29T12:00:00Z, answer 503.',
    ],
    [
      'com a janela aberta no começo',
      { name: 'x', active_until: '2026-09-29T13:00:00Z', response: { status: 503 } },
      'When any request, until 2026-09-29T13:00:00Z, answer 503.',
    ],
  ])('deve descrever em palavras a regra %s', (_caso, rule, words) => {
    expect(ruleInWords(rule)).toBe(words);
  });

  it('deve cortar o texto citado longo', () => {
    const words = ruleInWords({ name: 'x', match: { body: [{ equals: 'a'.repeat(80) }] } });

    expect(words).toBe(`When any request has a body equal to "${'a'.repeat(38)}…, answer 200.`);
  });

  it('deve montar a frase em pt-BR Quando a tradução está carregada', () => {
    loadTranslations(translations);
    try {
      const words = ruleInWords({
        name: 'Pix',
        match: { method: ['POST'], path: { equals: '/pagamentos' }, signature: 'valid' },
        response: { status: 201 },
      });

      expect(words).toBe(
        'Quando um POST para /pagamentos tiver uma assinatura válida, responder 201.',
      );
    } finally {
      clearTranslations();
    }
  });

  it.each<[string, Partial<Rule>, string]>([
    [
      'janela e chance',
      { chance: 30, active_from: '2026-09-29T12:00:00Z', active_until: '2026-09-29T13:00:00Z' },
      'Quando um POST para /pagamentos, de 2026-09-29T12:00:00Z até 2026-09-29T13:00:00Z, ' +
        'em 30% das requisições que casam, responder 503.',
    ],
    [
      'a janela aberta no fim',
      { active_from: '2026-09-29T12:00:00Z' },
      'Quando um POST para /pagamentos, a partir de 2026-09-29T12:00:00Z, responder 503.',
    ],
    [
      'a janela aberta no começo',
      { active_until: '2026-09-29T13:00:00Z' },
      'Quando um POST para /pagamentos, até 2026-09-29T13:00:00Z, responder 503.',
    ],
  ])('deve dizer em pt-BR %s da regra', (_caso, extra, words) => {
    loadTranslations(translations);
    try {
      expect(
        ruleInWords({
          name: 'x',
          match: { method: ['POST'], path: { equals: '/pagamentos' } },
          response: { status: 503 },
          ...extra,
        }),
      ).toBe(words);
    } finally {
      clearTranslations();
    }
  });
});
