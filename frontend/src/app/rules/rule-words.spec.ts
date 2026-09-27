import { clearTranslations, loadTranslations } from '@angular/localize';
import { translations } from '../../locale/pt-BR';
import { Rule } from './rule';
import { ruleInWords } from './rule-words';

describe('Dado uma regra (ruleInWords)', () => {
  it.each<[string, Rule, string]>([
    ['sem condições', { name: 'Tudo' }, 'When any request, answer 200.'],
    [
      'a do readme',
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
});
