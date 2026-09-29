import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { SuggestionCheck } from '../ai/ai-client';
import { Rule } from './rule';
import { suggestionChecks, suggestionSummary } from './suggestion-checks';

const EXEMPLO = webhookRequest(1, {
  method: 'POST',
  url: `http://localhost/${TOKEN_ID}/pedidos?env=prod`,
  headers: { 'x-tenant': ['acme'], 'content-type': ['application/json'] },
  query: { env: 'prod' },
  content: '{"status":"pago","pedido":{"id":7}}',
});

const SUGERIDA: Rule = {
  name: 'Pedido pago',
  priority: 5,
  match: {
    method: ['POST'],
    path: { equals: '/pedidos' },
    body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
  },
  response: { status: 202 },
};

const CASA: SuggestionCheck = {
  example: { matches: true, failed: [], conditions: [] },
  recent: { evaluated: 34, matched: 7 },
  warnings: [],
};

const lines = (overrides: Partial<Parameters<typeof suggestionChecks>[0]> = {}) =>
  suggestionChecks({
    rule: SUGERIDA,
    check: CASA,
    example: EXEMPLO,
    rules: [rule(1, { priority: 1 }), rule(9, { name: 'Tudo o resto', priority: 9, match: {} })],
    ...overrides,
  });
const shown = (overrides: Partial<Parameters<typeof suggestionChecks>[0]> = {}) =>
  lines(overrides).map(({ verdict, text }) => [verdict, text]);

describe('Dado a conferência de uma regra sugerida', () => {
  it('deve dar OK nas quatro conferências Quando a regra casa o exemplo e o histórico', () => {
    expect(shown()).toEqual([
      ['ok', 'Matches the example request.'],
      ['ok', 'Would match 7 of the last 34 requests.'],
      ['ok', 'Every field in the conditions is in the example request.'],
      ['ok', 'Enters at position 2 of 3, before "Tudo o resto".'],
    ]);
    expect(suggestionSummary(lines(), CASA, true)).toBe(
      'Checked: matches the example and 7 of the last 34.',
    );
  });

  it('deve dizer a condição que falhou e que nada do histórico casaria', () => {
    const check: SuggestionCheck = {
      example: {
        matches: false,
        failed: ['body $.status: expected "sucedido", got "pago"'],
        conditions: ['match.body.0'],
      },
      recent: { evaluated: 34, matched: 0 },
      warnings: [{ code: 'example_not_matched', message: 'x' }],
    };

    expect(shown({ check }).slice(0, 2)).toEqual([
      [
        'problem',
        'Does not match the example request: body $.status: expected "sucedido", got "pago"',
      ],
      ['problem', 'Would match none of the last 34 requests.'],
    ]);
    expect(suggestionSummary(lines({ check }), check, true)).toBe(
      '2 problems found. Review before applying.',
    );
  });

  it('deve dizer "1 problem found" no singular', () => {
    const check = { ...CASA, recent: { evaluated: 5, matched: 0 } };

    expect(suggestionSummary(lines({ check }), check, true)).toBe(
      '1 problem found. Review before applying.',
    );
  });

  it('deve pedir atenção, e não acusar problema, Quando só uma requisição casaria', () => {
    const check = { ...CASA, recent: { evaluated: 500, matched: 1 } };

    expect(shown({ check })[1]).toEqual([
      'attention',
      'Too specific: only this request would match (of the last 500).',
    ]);
  });

  it('deve dizer que não deu para conferir o histórico Quando o servidor não mandou a conferência', () => {
    expect(shown({ check: null, example: null })).toEqual([
      ['attention', 'Could not check against the history.'],
      ['ok', 'Enters at position 2 of 3, before "Tudo o resto".'],
    ]);
  });

  it('deve pular o exemplo e os campos Quando a sugestão não usou requisição de exemplo', () => {
    const check = { ...CASA, example: null };

    expect(shown({ check, example: null }).map(([, text]) => text)).toEqual([
      'Would match 7 of the last 34 requests.',
      'Enters at position 2 of 3, before "Tudo o resto".',
    ]);
    expect(suggestionSummary(lines({ check, example: null }), check, false)).toBe(
      'Checked: matches 7 of the last 34. No example request was used.',
    );
  });

  it('deve apontar cada campo das condições que não está no exemplo, e o caminho nunca recebido', () => {
    const proposta: Rule = {
      ...SUGERIDA,
      match: {
        path: { equals: '/mensagens' },
        headers: { 'X-Tenant': { equals: 'acme' }, 'X-Outro': { present: true } },
        query: { env: { equals: 'prod' }, debug: { equals: '1' } },
        body: [
          { jsonPath: { path: '$.pedido.id', equals: 7 } },
          { jsonPath: { path: '$.cliente', equals: 'x' } },
        ],
      },
    };
    const check: SuggestionCheck = {
      ...CASA,
      warnings: [{ code: 'path_never_seen', message: 'x' }],
    };

    expect(
      shown({ rule: proposta, check })
        .filter(([verdict]) => verdict === 'problem')
        .map(([, text]) => text),
    ).toEqual([
      'header X-Outro is not in the example request.',
      'query debug is not in the example request.',
      '$.cliente is not in the example request.',
      'Path /mensagens was never received.',
    ]);
  });

  it('deve avisar do template desligado, da regra sem condição e da prioridade que passa na frente', () => {
    const proposta: Rule = {
      name: 'Eco',
      priority: 1,
      response: { status: 200, body: '{"id":"{{request.id}}"}', template: false },
    };

    expect(
      shown({
        rule: proposta,
        check: { ...CASA, example: null },
        example: null,
        rules: [rule(1, { priority: 2 }), rule(2, { priority: 5 })],
      }).slice(1),
    ).toEqual([
      ['problem', 'The body has {{…}} but Template is off: it would be sent as text.'],
      ['problem', 'No conditions: it would answer every request.'],
      ['problem', 'Priority 1: it would be checked before all 2 rules.'],
    ]);
  });

  it('deve dizer a posição sem "before" Quando não há pega-tudo', () => {
    expect(shown({ rules: [rule(1, { priority: 1 })] }).at(-1)).toEqual([
      'ok',
      'Enters at position 2 of 2.',
    ]);
  });

  it('deve oferecer o assistente de sequência Quando o pedido tem forma de sequência', () => {
    const check: SuggestionCheck = {
      ...CASA,
      warnings: [{ code: 'sequence_as_single_rule', message: 'x' }],
    };

    expect(lines({ check }).at(-1)).toEqual({
      verdict: 'problem',
      text: 'You asked for steps in sequence. One rule cannot do that.',
      action: 'sequence',
    });
  });
});
