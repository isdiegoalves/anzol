import { webhookRequest } from '../../testing/fixtures';
import { CapturedRequest } from '../requests/webhook-request';
import { OutcomeReport, bodyDifferences, explainOutcome } from './outcome';

/** Duas entregas do mesmo evento; cada caso muda só o que interessa. */
const pair = (
  a: Partial<CapturedRequest>,
  b: Partial<CapturedRequest>,
): [CapturedRequest, CapturedRequest] => [
  webhookRequest(1, { content: '{}', ...a }),
  webhookRequest(2, { content: '{}', ...b }),
];

describe('Dado duas mensagens comparadas (S9: o que explica o desfecho e o que é ruído)', () => {
  it.each<[string, [CapturedRequest, CapturedRequest], OutcomeReport]>([
    ['iguais', pair({}, {}), { causes: [], noise: [], other: [] }],
    [
      'a assinatura válida em A e com HMAC diferente em B',
      pair(
        { signature: { provider: 'github', valid: true, reason: null } },
        { signature: { provider: 'github', valid: false, reason: 'signature mismatch' } },
      ),
      {
        causes: [{ check: 'signature', where: 'signature', a: 'valid', b: 'signature mismatch' }],
        noise: [],
        other: [],
      },
    ],
    [
      'o mesmo motivo de assinatura nos dois (não explica nada)',
      pair(
        { signature: { provider: 'github', valid: false, reason: 'signature mismatch' } },
        { signature: { provider: 'github', valid: false, reason: 'signature mismatch' } },
      ),
      { causes: [], noise: [], other: [] },
    ],
    [
      'o campo que quebrou o schema em B (o diff do campo não vai para "other")',
      pair(
        { content: '{"amount":10,"note":"a"}', schema: { valid: true, errors: [] } },
        {
          content: '{"amount":"10","note":"b"}',
          schema: { valid: false, errors: [{ path: '/amount', message: 'must be integer' }] },
        },
      ),
      {
        causes: [{ check: 'schema', where: '/amount', a: 'valid here', b: 'must be integer' }],
        noise: [],
        other: ['body /note'],
      },
    ],
    [
      'o schema verificado só em B',
      pair({ schema: null }, { schema: { valid: false, errors: [{ path: '', message: 'x' }] } }),
      {
        causes: [{ check: 'schema', where: 'schema', a: 'not checked', b: 'invalid' }],
        noise: [],
        other: [],
      },
    ],
    [
      'a regra que respondeu A e chegou perto em B, pela condição estruturada',
      pair(
        { rule: { id: 'r1', name: 'Pix' } },
        {
          rule: null,
          near_miss: {
            id: 'r1',
            name: 'Pix',
            failed: ['method: expected POST, got GET'],
            conditions: ['match.method'],
          },
        },
      ),
      {
        causes: [
          {
            check: 'rule',
            where: 'match.method',
            a: 'passed',
            b: 'method: expected POST, got GET',
          },
        ],
        noise: [],
        other: [],
      },
    ],
    [
      'near miss antigo (sem conditions), pela frase',
      pair(
        { near_miss: { id: 'r1', name: 'Pix', failed: ['header x-a: absent'] } },
        { near_miss: { id: 'r1', name: 'Pix', failed: ['header x-a: absent', 'body $.s: x'] } },
      ),
      {
        causes: [{ check: 'rule', where: 'body $.s: x', a: 'passed', b: 'body $.s: x' }],
        noise: [],
        other: [],
      },
    ],
    [
      'near miss de regras diferentes (não se comparam)',
      pair(
        { near_miss: { id: 'r1', name: 'Pix', failed: ['a'] } },
        { near_miss: { id: 'r2', name: 'Boleto', failed: ['b'] } },
      ),
      { causes: [], noise: [], other: [] },
    ],
    [
      'o ruído da Stripe: assinatura, content-length, id e created do evento',
      pair(
        {
          headers: { 'stripe-signature': ['t=1,v1=a'], 'content-length': ['10'], 'x-a': ['1'] },
          content: '{"id":"evt_1","created":1,"type":"x"}',
        },
        {
          headers: { 'stripe-signature': ['t=2,v1=b'], 'content-length': ['11'], 'x-a': ['2'] },
          content: '{"id":"evt_2","created":2,"type":"x"}',
        },
      ),
      {
        causes: [],
        noise: ['header content-length', 'header stripe-signature', 'body /created', 'body /id'],
        other: ['header x-a'],
      },
    ],
    [
      'o id do corpo fora da Stripe (não é ruído)',
      pair({ content: '{"id":1}' }, { content: '{"id":2}' }),
      { causes: [], noise: [], other: ['body /id'] },
    ],
    [
      'o ruído do GitHub e do Slack, método, URL e query',
      pair(
        {
          method: 'POST',
          url: 'http://h/t/a',
          headers: { 'x-github-delivery': ['1'], 'x-slack-request-timestamp': ['1'] },
          query: { p: '1' },
        },
        {
          method: 'PUT',
          url: 'http://h/t/b',
          headers: { 'x-github-delivery': ['2'], 'x-slack-request-timestamp': ['2'] },
          query: { p: '2' },
        },
      ),
      {
        causes: [],
        noise: ['header x-github-delivery', 'header x-slack-request-timestamp'],
        other: ['method', 'URL', 'query p'],
      },
    ],
  ])('deve classificar Quando %s', (_caso, [a, b], esperado) => {
    expect(explainOutcome(a, b)).toEqual(esperado);
  });
});

describe('Dado os campos do corpo que mudaram', () => {
  it.each([
    ['iguais', '{"a":1}', '{"a":1}', []],
    [
      'JSON com um campo aninhado diferente',
      '{"a":{"b":1,"c":[1]}}',
      '{"a":{"b":2,"c":[1]}}',
      ['/a/b'],
    ],
    ['JSON com campo só de um lado', '{"a":1}', '{"a":1,"b/c":2}', ['/b~1c']],
    ['texto', 'a=1', 'a=2', ['']],
    ['um vazio', null, '{"a":1}', ['']],
  ])('deve dar os JSON Pointers Quando os corpos são %s', (_caso, a, b, esperado) => {
    expect(bodyDifferences(a, b)).toEqual(esperado);
  });
});
