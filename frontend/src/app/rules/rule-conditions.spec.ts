import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { conditionOfPhrase, failedConditions, tallyConditions } from './rule-conditions';

/** Regra com uma condição de cada tipo, como o servidor devolve. */
const REGRA: Rule = rule(1, {
  match: {
    method: ['POST'],
    path: { equals: '/pagamentos' },
    query: { tipo: { equals: 'pix' }, Lote: { present: true } },
    headers: { 'X-Signature': { present: true }, 'Content-Type': { contains: 'json' } },
    body: [
      { jsonPath: { path: '$.status', equals: 'pago' } },
      { contains: 'pedido' },
      { regex: '.*id.*' },
      { equals: 'ok' },
      { equalToJson: { a: 1 } },
      { jsonPath: { path: "$['a: b']" } },
      { contains: 'outro' },
    ],
    signature: 'valid',
    schema: 'valid',
  },
  scenario: { name: 'entrega', requiredState: 'entregue' },
});

describe('Dado uma frase de near miss sem "conditions" (mensagem antiga)', () => {
  // Todas as frases do docs/api.md ("Regras de resposta" e "Cenários") e as demais que o
  // `RuleMatching.kt` escreve, cada uma com a condição que a produziu.
  it.each([
    ['method: expected POST, got GET', 'match.method'],
    ['method: expected one of POST, PUT, got GET', 'match.method'],
    ['path: expected "/pagamentos", got "/x"', 'match.path'],
    ['path: expected prefix "/api", got "/x"', 'match.path'],
    ['path: expected to match "/v[0-9]+", got "/x"', 'match.path'],
    ['query tipo: expected "pix", got "boleto"', 'match.query.tipo'],
    ['query tipo: absent', 'match.query.tipo'],
    ['query Lote: absent', 'match.query.Lote'],
    ['query tipo: expected to contain "p", got "x"', 'match.query.tipo'],
    ['header x-signature: absent', 'match.headers.X-Signature'],
    ['header x-signature: present', 'match.headers.X-Signature'],
    [
      'header content-type: expected to contain "json", got "text/plain"',
      'match.headers.Content-Type',
    ],
    ['header x-nao-esta-na-regra: absent', 'match.headers.x-nao-esta-na-regra'],
    ['body $.status: expected "pago", got "pendente"', 'match.body.0'],
    ['body $.status: absent', 'match.body.0'],
    ['body $.status: body is not JSON', 'match.body.0'],
    ["body $['a: b']: absent", 'match.body.5'],
    ['body: expected to contain "pedido"', 'match.body.1'],
    ['body: expected to contain "outro"', 'match.body.6'],
    ['body: expected to match ".*id.*"', 'match.body.2'],
    ['body: expected "ok", got "nok"', 'match.body.3'],
    ['body: not equal to the expected JSON', 'match.body.4'],
    ['body: body is not JSON', 'match.body.4'],
    ['signature: expected valid, got invalid (signature mismatch)', 'match.signature'],
    ['signature: expected valid, got not configured', 'match.signature'],
    ['schema: expected valid, got invalid (3 errors)', 'match.schema'],
    ['schema: expected invalid, got valid', 'match.schema'],
    ['schema: expected valid, got not configured', 'match.schema'],
    ['scenario entrega: expected state "entregue", got "Started"', 'scenario'],
    ['chance 30%: rolled 57, not applied', 'chance'],
    ['window: opens at 2026-09-29T12:00:00Z, received at 2026-09-29T11:59:30Z', 'active_from'],
    ['window: closed at 2026-09-29T13:00:00Z, received at 2026-09-29T13:00:05Z', 'active_until'],
  ])('deve achar a condição Quando a frase é %s', (phrase, key) => {
    expect(conditionOfPhrase(phrase, REGRA)).toBe(key);
  });

  it.each([
    ['o corpo JSONPath de caminho que a regra não tem mais', 'body $.outro: absent', 'match.body'],
    [
      'o corpo "contains" de valor que a regra não tem mais',
      'body: expected to contain "x"',
      'match.body',
    ],
    ['uma frase desconhecida', 'algo: expected x', null],
  ])('deve cair na chave sem índice ou em null Quando é %s', (_caso, phrase, key) => {
    expect(conditionOfPhrase(phrase, REGRA)).toBe(key);
  });

  it('deve achar o cabeçalho pelo nome em minúsculas Quando não há regra para comparar', () => {
    expect(conditionOfPhrase('header x-signature: absent', undefined)).toBe(
      'match.headers.x-signature',
    );
  });
});

describe('Dado "failed" com e sem "conditions" (failedConditions)', () => {
  const FAILED = ['method: expected POST, got GET', 'header x-signature: absent'];

  it('deve usar as chaves do servidor Quando "conditions" vem alinhada', () => {
    expect(failedConditions(FAILED, ['match.method', 'match.headers.X-Signature'], REGRA)).toEqual({
      keys: ['match.method', 'match.headers.X-Signature'],
      inferred: false,
    });
  });

  it.each([
    ['nula (gravada antes do campo)', null],
    ['ausente (servidor anterior)', undefined],
    ['de outro tamanho', ['match.method']],
  ])('deve ler pela frase e marcar como inferido Quando "conditions" é %s', (_caso, conditions) => {
    expect(failedConditions(FAILED, conditions, REGRA)).toEqual({
      keys: ['match.method', 'match.headers.X-Signature'],
      inferred: true,
    });
  });
});

describe('Dado as falhas de várias mensagens (tallyConditions)', () => {
  it('deve contar cada condição uma vez por mensagem, misturando mensagens novas e antigas', () => {
    const tally = tallyConditions(
      [
        { failed: ['method: expected POST, got GET'], conditions: ['match.method'] },
        {
          failed: ['method: expected POST, got GET', 'body $.status: absent'],
          conditions: null,
        },
        { failed: ['body $.status: absent', 'body $.status: absent'], conditions: undefined },
      ],
      REGRA,
    );

    expect([...tally.counts]).toEqual([
      ['match.method', 2],
      ['match.body.0', 2],
    ]);
    expect(tally.inferred).toBe(true);
  });

  it('não deve marcar como inferido Quando todas trazem "conditions"', () => {
    const tally = tallyConditions(
      [{ failed: ['schema: expected invalid, got valid'], conditions: ['match.schema'] }],
      REGRA,
    );

    expect(tally.inferred).toBe(false);
  });
});
