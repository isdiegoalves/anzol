import { clearTranslations, loadTranslations } from '@angular/localize';
import { translations } from '../../locale/pt-BR';
import { token, webhookRequest } from '../../testing/fixtures';
import { CapturedRequest, DecryptionResult } from '../requests/webhook-request';
import { OutcomeReport, bodyDifferences, explainOutcome } from './outcome';

/** Duas entregas do mesmo evento; cada caso muda só o que interessa. */
const pair = (
  a: Partial<CapturedRequest>,
  b: Partial<CapturedRequest>,
): [CapturedRequest, CapturedRequest] => [
  webhookRequest(1, { content: '{}', ...a }),
  webhookRequest(2, { content: '{}', ...b }),
];

const decryption = (
  state: DecryptionResult['state'],
  reason: string | null = null,
): DecryptionResult => ({
  state,
  kid: 'enc-1',
  signature_kid: 'sig-1',
  reason,
  jti: 'n-1',
  duplicate_of: null,
});

const github = (valid: boolean) => ({
  provider: 'github' as const,
  valid,
  reason: valid ? null : 'signature mismatch',
});

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
        causes: [
          {
            check: 'signature',
            where: 'signature',
            a: 'valid',
            b: 'does not match (signature mismatch)',
          },
        ],
        noise: [],
        other: [],
      },
    ],
    [
      'a assinatura que a URL não conferia em A e faltou em B',
      pair(
        { signature: null },
        {
          signature: {
            provider: 'github',
            valid: false,
            reason: 'header X-Hub-Signature-256 absent',
          },
        },
      ),
      {
        causes: [
          {
            check: 'signature',
            where: 'signature',
            a: 'not checked',
            b: 'header X-Hub-Signature-256 absent',
          },
        ],
        noise: [],
        other: [],
      },
    ],
    [
      'a assinatura com resultados diferentes e o cabeçalho dela diferente (sobe com a causa)',
      pair(
        {
          headers: { 'x-hub-signature-256': ['sha256=a'], 'x-a': ['1'] },
          signature: github(true),
        },
        {
          headers: { 'x-hub-signature-256': ['sha256=b'], 'x-a': ['2'] },
          signature: github(false),
        },
      ),
      {
        causes: [
          {
            check: 'signature',
            where: 'signature',
            a: 'valid',
            b: 'does not match (signature mismatch)',
            header: 'x-hub-signature-256',
          },
        ],
        noise: [],
        other: ['header x-a'],
      },
    ],
    [
      'a assinatura da Stripe com resultados diferentes (o cabeçalho sai do ruído)',
      pair(
        {
          headers: { 'stripe-signature': ['t=1,v1=a'] },
          signature: { provider: 'stripe', valid: true, reason: null },
        },
        {
          headers: { 'stripe-signature': ['t=2,v1=b'] },
          signature: { provider: 'stripe', valid: false, reason: 'signature mismatch' },
        },
      ),
      {
        causes: [
          {
            check: 'signature',
            where: 'signature',
            a: 'valid',
            b: 'does not match (signature mismatch)',
            header: 'stripe-signature',
          },
        ],
        noise: [],
        other: [],
      },
    ],
    [
      'a assinatura do Slack com resultados diferentes (o timestamp continua ruído)',
      pair(
        {
          headers: { 'x-slack-signature': ['v0=a'], 'x-slack-request-timestamp': ['1'] },
          signature: { provider: 'slack', valid: true, reason: null },
        },
        {
          headers: { 'x-slack-signature': ['v0=b'], 'x-slack-request-timestamp': ['2'] },
          signature: { provider: 'slack', valid: false, reason: 'signature mismatch' },
        },
      ),
      {
        causes: [
          {
            check: 'signature',
            where: 'signature',
            a: 'valid',
            b: 'does not match (signature mismatch)',
            header: 'x-slack-signature',
          },
        ],
        noise: ['header x-slack-request-timestamp'],
        other: [],
      },
    ],
    [
      'a assinatura com o mesmo resultado e o cabeçalho dela diferente (não sobe)',
      pair(
        { headers: { 'x-hub-signature-256': ['sha256=a'] }, signature: github(true) },
        { headers: { 'x-hub-signature-256': ['sha256=b'] }, signature: github(true) },
      ),
      { causes: [], noise: [], other: ['header x-hub-signature-256'] },
    ],
    [
      'a assinatura com resultados diferentes e o cabeçalho dela igual (não sobe)',
      pair(
        {
          headers: { 'x-hub-signature-256': ['sha256=a'] },
          content: '{"a":1}',
          signature: github(true),
        },
        {
          headers: { 'x-hub-signature-256': ['sha256=a'] },
          content: '{"a":2}',
          signature: github(false),
        },
      ),
      {
        causes: [
          {
            check: 'signature',
            where: 'signature',
            a: 'valid',
            b: 'does not match (signature mismatch)',
          },
        ],
        noise: [],
        other: ['body /a'],
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
      'o erro de schema que a tela conhece (a frase da tela, com a do validador entre parênteses)',
      pair(
        { schema: { valid: true, errors: [] } },
        {
          schema: {
            valid: false,
            errors: [{ path: '/valor', message: 'string found, number expected' }],
          },
        },
      ),
      {
        causes: [
          {
            check: 'schema',
            where: '/valor',
            a: 'valid here',
            b: 'got a string, expected a number (string found, number expected)',
          },
        ],
        noise: [],
        other: [],
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
      'a decifra válida em A e inválida em B (a frase do motivo)',
      pair(
        { decryption: decryption('valid') },
        { decryption: decryption('invalid', 'aud_mismatch') },
      ),
      {
        causes: [
          {
            check: 'decryption',
            where: 'decryption',
            a: 'valid',
            b: "the JWS aud does not include this URL's audience (aud_mismatch)",
          },
        ],
        noise: [],
        other: [],
      },
    ],
    [
      'a decifra que a URL não fazia em A e com chave desconhecida em B',
      pair({}, { decryption: decryption('unknown_kid') }),
      {
        causes: [
          {
            check: 'decryption',
            where: 'decryption',
            a: 'not decrypted',
            b: 'with an unknown key',
          },
        ],
        noise: [],
        other: [],
      },
    ],
    [
      'o atributo em claro em A e decifrado em B',
      pair({ decryption: decryption('absent') }, { decryption: decryption('valid') }),
      {
        causes: [{ check: 'decryption', where: 'decryption', a: 'in plaintext', b: 'valid' }],
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

  it('deve subir com a causa o cabeçalho configurado na URL Quando a assinatura é a genérica', () => {
    const generic = (valid: boolean) => ({
      provider: 'generic' as const,
      valid,
      reason: valid ? null : 'signature mismatch',
    });
    const [a, b] = pair(
      { headers: { 'x-loja-signature': ['a'] }, signature: generic(true) },
      { headers: { 'x-loja-signature': ['b'] }, signature: generic(false) },
    );
    const url = token({
      signature: { provider: 'generic', header: 'X-Loja-Signature', algorithm: 'sha256' },
    });

    expect(explainOutcome(a, b, url).causes[0].header).toBe('x-loja-signature');
    expect(explainOutcome(a, b, url).other).toEqual([]);
    expect(explainOutcome(a, b).causes[0].header).toBeUndefined();
    expect(explainOutcome(a, b).other).toEqual(['header x-loja-signature']);
  });

  describe('Com a tela em pt-BR', () => {
    beforeEach(() => loadTranslations(translations));
    afterEach(() => clearTranslations());

    it.each<[string, [CapturedRequest, CapturedRequest], OutcomeReport]>([
      [
        'a assinatura confere em A e não confere em B',
        pair({ signature: github(true) }, { signature: github(false) }),
        {
          causes: [
            {
              check: 'signature',
              where: 'signature',
              a: 'confere',
              b: 'não confere (signature mismatch)',
            },
          ],
          noise: [],
          other: [],
        },
      ],
      [
        'a assinatura não conferida em A e sem o cabeçalho em B',
        pair(
          { signature: null },
          {
            signature: {
              provider: 'generic',
              valid: false,
              reason: 'header x-loja-signature absent',
            },
          },
        ),
        {
          causes: [
            {
              check: 'signature',
              where: 'signature',
              a: 'não conferida',
              b: 'faltou o cabeçalho x-loja-signature (header x-loja-signature absent)',
            },
          ],
          noise: [],
          other: [],
        },
      ],
      [
        'o erro de schema num caminho que em B passou',
        pair(
          {
            schema: {
              valid: false,
              errors: [{ path: '/valor', message: 'string found, number expected' }],
            },
          },
          { schema: { valid: true, errors: [] } },
        ),
        {
          causes: [
            {
              check: 'schema',
              where: '/valor',
              a: 'veio texto, esperava número (string found, number expected)',
              b: 'válido aqui',
            },
          ],
          noise: [],
          other: [],
        },
      ],
      [
        'o schema inválido em A e não conferido em B',
        pair({ schema: { valid: false, errors: [{ path: '', message: 'x' }] } }, { schema: null }),
        {
          causes: [{ check: 'schema', where: 'schema', a: 'inválido', b: 'não conferido' }],
          noise: [],
          other: [],
        },
      ],
      [
        'o schema válido em A e não conferido em B',
        pair({ schema: { valid: true, errors: [] } }, { schema: null }),
        {
          causes: [{ check: 'schema', where: 'schema', a: 'válido', b: 'não conferido' }],
          noise: [],
          other: [],
        },
      ],
      [
        'a decifra válida em A e inválida em B',
        pair(
          { decryption: decryption('valid') },
          { decryption: decryption('invalid', 'aud_mismatch') },
        ),
        {
          causes: [
            {
              check: 'decryption',
              where: 'decryption',
              a: 'válida',
              b: 'o aud do JWS não inclui a audiência desta URL (aud_mismatch)',
            },
          ],
          noise: [],
          other: [],
        },
      ],
      [
        'a decifra que a URL não fazia em A e válida em B',
        pair({}, { decryption: decryption('valid') }),
        {
          causes: [{ check: 'decryption', where: 'decryption', a: 'não decifrada', b: 'válida' }],
          noise: [],
          other: [],
        },
      ],
      [
        'a condição da regra que passou em A e falhou em B',
        pair(
          { rule: { id: 'r1', name: 'Pix' } },
          {
            rule: null,
            near_miss: {
              id: 'r1',
              name: 'Pix',
              failed: ['signature: expected valid, got invalid (signature mismatch)'],
              conditions: ['match.signature'],
            },
          },
        ),
        {
          causes: [
            {
              check: 'rule',
              where: 'match.signature',
              a: 'passou',
              b: 'pede assinatura válida; esta veio inválida (signature: expected valid, got invalid (signature mismatch))',
            },
          ],
          noise: [],
          other: [],
        },
      ],
      [
        'o método, a URL, um cabeçalho, a query e campos do corpo',
        pair(
          {
            method: 'POST',
            url: 'http://h/t/a',
            headers: { 'x-a': ['1'], 'x-github-delivery': ['1'] },
            query: { p: '1' },
            content: '{"id":1}',
          },
          {
            method: 'PUT',
            url: 'http://h/t/b',
            headers: { 'x-a': ['2'], 'x-github-delivery': ['2'] },
            query: { p: '2' },
            content: '{"id":2}',
          },
        ),
        {
          causes: [],
          noise: ['cabeçalho x-github-delivery'],
          other: ['método', 'URL', 'cabeçalho x-a', 'query p', 'corpo /id'],
        },
      ],
      [
        'os corpos que não são JSON',
        pair({ content: 'a=1' }, { content: 'a=2' }),
        { causes: [], noise: [], other: ['corpo'] },
      ],
    ])('deve dizer na língua da tela Quando %s', (_caso, [a, b], esperado) => {
      expect(explainOutcome(a, b)).toEqual(esperado);
    });
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
